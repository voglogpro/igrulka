import { uavEngineMix } from './engines.js';
import { FootstepScheduler } from './footsteps.js';
import { recordedJetMix } from './ordnance.js';
import { audioBufferBank, warmAudioPCM, audioBankDiagnostics } from './sample-bank.js';

// How loud each weapon is and how often the same class may start a new sound.
const WEAPON_SOUND = {
  rifle: { gain: 0.42, gap: 0.04 },
  mg: { gain: 0.5, gap: 0.035 },
  sniper: { gain: 0.65, gap: 0.05 },
  hmg: { gain: 0.72, gap: 0.04 },
  shilka: { gain: 0.78, gap: 0.04 },
  autocannon: { gain: 0.95, gap: 0.05 },
  tank: { gain: 1.25, gap: 0.08 },
  artillery: { gain: 1.4, gap: 0.08 },
};
const AIR_GUNS = { gepard: 'autocannon', shilka: 'shilka', mog: 'hmg', gun: 'hmg' };
const GROUND_GUNS = {
  leopard: 'tank',
  heavytank: 'tank',
  lighttank: 'autocannon',
  ifv: 'autocannon',
  armoredcar: 'hmg',
  tankdestroyer: 'tank',
  howitzer: 'artillery',
  machinegunner: 'mg',
  apc: 'mg',
  mog: 'hmg',
  gun: 'hmg',
  sniper: 'sniper',
};
const VEHICLES = new Set([
  'leopard',
  'gepard',
  'shilka',
  'apc',
  'tankdestroyer',
  'howitzer',
  'armoredcar',
  'lighttank',
  'ifv',
  'heavytank',
  'mlrs',
  'supplytruck',
]);
const WHEELED = new Set(['apc', 'armoredcar', 'mlrs']);
const SPEED_OF_SOUND = 343;
const ORDNANCE = new Set([
  'rocketLaunch',
  'cruiseLaunch',
  'ballisticLaunch',
  'artillery',
  'missileDive',
  'whistle',
  'atgm',
]);

export function soundClass(e) {
  if (e.key === 'sam') return 'sam';
  if (e.shooter === 'mlrs') return 'rocket';
  if (e.key === 'cannon' && e.shooter === 'atgm') return 'atgm';
  if (e.ground) return GROUND_GUNS[e.shooter] || (e.key === 'cannon' ? 'tank' : 'rifle');
  return AIR_GUNS[e.shooter] || (e.key === 'cannon' ? 'autocannon' : 'rifle');
}

// Distance shaping: close shots are dry and bright, far ones are muffled, late and echoing.
export function distanceMix(distance, loudness = 1) {
  const d = Math.max(0, distance);
  return {
    dry: loudness * (70 / (70 + d)),
    wet: loudness * (0.1 + 0.45 * Math.min(1, d / 650)) * (110 / (110 + d * 0.35)),
    echo: loudness * 0.55 * Math.min(1, Math.max(0, (d - 180) / 520)) * (200 / (200 + d * 0.3)),
    cutoff: Math.max(650, Math.min(16000, 16000 * Math.exp(-d / 330))),
    delay: Math.min(1.1, (d / SPEED_OF_SOUND) * 0.55),
  };
}

// A heavy launch has a larger acoustic footprint than a rifle. Keep the existing
// rifle/engine/ambience mix while allowing the recorded low end to reach a high
// strategy camera and remain audible behind ordinary gunfire.
export function ordnanceMix(distance, loudness = 1) {
  const d = Math.max(0, distance),
    mix = distanceMix(d, loudness);
  return {
    ...mix,
    dry: loudness * (260 / (260 + d)),
    wet: mix.wet * 1.12,
    echo: mix.echo * 1.2,
    cutoff: Math.max(900, Math.min(7000, 10000 * Math.exp(-d / 1100))),
  };
}

export class GameAudio {
  constructor() {
    this.enabled = true;
    this.activated = false;
    this.volume = 0.35;
    this.last = {};
    this.voices = 0;
    this.activeSamples = new Set();
    this.engines = [];
    this.activeEngines = 0;
    this.whistled = new Set();
    this.listener = null;
    this.footsteps = new FootstepScheduler();
    if (typeof window !== 'undefined') warmAudioPCM();
  }
  // Build the existing graph behind the loading screen, without user activation.
  // Injected/offline contexts remain under their caller's transport control.
  prepare(context = null) {
    if (this.context) return this.preparation || this.ready;
    const Audio =
      typeof window === 'undefined' ? null : window.AudioContext || window.webkitAudioContext;
    if (!context && !Audio) return Promise.resolve();
    let c;
    try {
      c = this.context = context || new Audio();
      this.master = c.createGain();
      this.master.gain.value = 0;
      this.compressor = c.createDynamicsCompressor();
      this.compressor.threshold.value = -14;
      this.compressor.knee.value = 12;
      this.compressor.ratio.value = 5;
      this.compressor.attack.value = 0.002;
      this.compressor.release.value = 0.3;
      // Remove inaudible subsonic energy before dynamics; preserve the audible boom.
      const subsonic = c.createBiquadFilter();
      subsonic.type = 'highpass';
      subsonic.frequency.value = 22;
      subsonic.Q.value = 0.5;
      const ceiling = c.createWaveShaper(),
        curve = new Float32Array(4097);
      for (let i = 0; i < curve.length; i++) {
        const x = (i / (curve.length - 1)) * 2 - 1,
          a = Math.abs(x);
        curve[i] = Math.sign(x) * (a <= 0.7 ? a : 0.7 + 0.25 * Math.tanh((a - 0.7) / 0.25));
      }
      ceiling.curve = curve;
      this.master.connect(subsonic);
      subsonic.connect(this.compressor);
      this.compressor.connect(ceiling);
      ceiling.connect(c.destination);
      this.dry = c.createGain();
      this.dry.connect(this.master);
      // Shared outdoor reverb and a slap-back echo from the valley sides.
      this.reverb = c.createConvolver();
      this.reverbIn = c.createGain();
      this.reverbIn.gain.value = 0.9;
      this.reverbIn.connect(this.reverb);
      this.reverb.connect(this.master);
      this.echoIn = c.createGain();
      const delay = c.createDelay(2),
        feedback = c.createGain(),
        tone = c.createBiquadFilter();
      delay.delayTime.value = 0.46;
      feedback.gain.value = 0.32;
      tone.type = 'lowpass';
      tone.frequency.value = 1300;
      this.echoIn.connect(delay);
      delay.connect(tone);
      tone.connect(feedback);
      feedback.connect(delay);
      tone.connect(this.master);
      tone.connect(this.reverbIn);
      this.buffers = this.renderBuffers();
      const suspended = !context && c.suspend ? c.suspend().catch(() => {}) : Promise.resolve();
      this.preparation = Promise.all([this.ready, suspended]);
      return this.preparation;
    } catch (error) {
      this.master?.disconnect();
      if (!context) c?.close?.().catch(() => {});
      this.context = this.master = this.buffers = this.preparation = this.ready = null;
      this.activated = false;
      throw error;
    }
  }
  // An OfflineAudioContext may be passed to render the unchanged mix for listening tests.
  unlock(context = null) {
    try {
      this.prepare(context)?.catch(() => {});
    } catch {
      // Audio is optional. A denied device must not block starting a campaign;
      // the next trusted gesture can retry the original lazy initialization.
      return;
    }
    if (!this.context) return;
    if (!this.activated) {
      this.activated = true;
      if (this.master) this.master.gain.value = this.enabled ? this.volume : 0;
    }
    if (!context) this.context.resume().catch(() => {});
  }
  renderBuffers() {
    const context = this.context,
      bank = audioBufferBank(context);
    const enginesReady = bank.loopsReady.then(() => {
      if (this.context !== context || context.state === 'closed') return;
      this.reverb.buffer = bank.buffers.impulse;
      this.createEngines();
    });
    this.ready = Promise.all([bank.ready, enginesReady]);
    return bank.buffers;
  }
  set(enabled, volume = this.volume) {
    this.enabled = enabled;
    this.volume = volume;
    if (this.master) {
      if (!this.activated) this.master.gain.value = 0;
      else this.master.gain.setTargetAtTime(enabled ? volume : 0, this.context.currentTime, 0.05);
    }
  }
  // Interface blips stay synthetic and centred; they are not part of the battlefield.
  tone(freq, end, length, gain = 0.1, type = 'sine') {
    if (!this.activated || !this.context || !this.enabled || this.voices >= 40) return;
    const c = this.context,
      t = c.currentTime,
      o = c.createOscillator(),
      g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, end), t + length);
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t + length);
    o.connect(g);
    g.connect(this.dry);
    o.start(t);
    o.stop(t + length + 0.01);
    this.voices++;
    o.onended = () => {
      this.voices--;
      o.disconnect();
      g.disconnect();
    };
  }
  // One positioned battlefield sound: buffer → distance filter → dry/pan + reverb + echo sends.
  sample(name, distance, pan, loudness, options = {}) {
    if (!this.activated) return;
    const list = this.buffers?.[name];
    if (!list || !this.enabled) return;
    const priority = options.priority || ORDNANCE.has(name);
    const mix = ORDNANCE.has(name)
      ? ordnanceMix(distance, loudness)
      : distanceMix(distance, loudness);
    if (mix.dry < 0.012 && !options.force) return;
    if (this.voices >= 44 && priority) {
      const ordinary = [...this.activeSamples].find((voice) => !voice.priority);
      if (ordinary) {
        ordinary.source.stop(this.context.currentTime);
        ordinary.finish();
      }
    }
    if (this.voices >= 44) return;
    const c = this.context,
      at = c.currentTime + (options.delay ?? mix.delay),
      source = c.createBufferSource(),
      filter = c.createBiquadFilter(),
      dry = c.createGain(),
      wet = c.createGain(),
      echo = c.createGain(),
      stereo = c.createStereoPanner();
    source.buffer = list[Math.floor(Math.random() * list.length)];
    source.playbackRate.value = (options.rate ?? 1) * (0.94 + Math.random() * 0.12);
    filter.type = 'lowpass';
    filter.frequency.value = mix.cutoff;
    filter.Q.value = 0.4;
    dry.gain.value = mix.dry;
    wet.gain.value = mix.wet;
    echo.gain.value = mix.echo;
    stereo.pan.value = Math.max(-1, Math.min(1, pan)) * 0.85;
    source.connect(filter);
    filter.connect(dry);
    dry.connect(stereo);
    stereo.connect(this.dry);
    filter.connect(wet);
    wet.connect(this.reverbIn);
    filter.connect(echo);
    echo.connect(this.echoIn);
    source.start(at, options.offset ?? 0);
    this.voices++;
    const voice = { name, source, priority, finished: false, finish: null };
    voice.finish = () => {
      if (voice.finished) return;
      voice.finished = true;
      this.voices--;
      this.activeSamples.delete(voice);
      for (const node of [source, filter, dry, wet, echo, stereo]) node.disconnect();
    };
    this.activeSamples.add(voice);
    source.onended = voice.finish;
  }
  // Distance from the camera itself: zooming out moves the listener away from the battle.
  locate(e, fallbackDistance, fallbackPan) {
    const l = this.listener;
    if (!l || !Number.isFinite(e.x) || !Number.isFinite(e.z))
      return { distance: fallbackDistance, pan: fallbackPan };
    const dx = e.x - l.x,
      dy = (e.y ?? 2) - l.y,
      dz = e.z - l.z,
      distance = Math.hypot(dx, dy, dz);
    return { distance, pan: (dx * l.rightX + dz * l.rightZ) / Math.max(120, distance) };
  }
  throttle(key, gap) {
    const t = this.context.currentTime;
    if (t - (this.last[key] ?? -10) < gap) return false;
    this.last[key] = t;
    return true;
  }
  play(e, distance = 0, pan = 0) {
    if (!this.activated || !this.context || !this.enabled) return;
    const where = this.locate(e, distance, pan);
    if (e.type === 'shot') {
      const kind = soundClass(e);
      if (kind === 'sam') {
        if (this.throttle('sam', 0.12))
          this.sample('rocketLaunch', where.distance, where.pan, 0.8, { rate: 1.16 });
        return;
      }
      if (kind === 'rocket') {
        if (this.throttle('rocket', 0.09))
          this.sample('rocketLaunch', where.distance, where.pan, 0.85);
        return;
      }
      if (kind === 'atgm') {
        if (this.throttle('atgm', 0.1)) {
          this.sample('atgm', where.distance, where.pan, 0.7, { rate: 1.12 });
        }
        return;
      }
      const weapon = WEAPON_SOUND[kind] || WEAPON_SOUND.rifle;
      if (this.throttle('shot:' + kind, weapon.gap))
        this.sample(kind, where.distance, where.pan, weapon.gain);
      return;
    }
    if (e.type === 'intercept' && e.mode === 'fall') {
      if (this.throttle('fall', 0.1)) this.sample('blastSmall', where.distance, where.pan, 0.7);
      return;
    }
    if (
      ['impact', 'destroy', 'crash', 'groundDestroyed'].includes(e.type) ||
      (e.type === 'intercept' && e.mode !== 'fall')
    ) {
      const large = e.key === 'ballistic' || e.key === 'heavy' || e.type === 'destroy',
        small = e.key === 'tank' || e.key === 'fpv' || e.type === 'intercept',
        name = large ? 'blastLarge' : small ? 'blastSmall' : 'blast';
      if (this.throttle('blast:' + name, 0.06))
        this.sample(name, where.distance, where.pan, large ? 1.6 : small ? 1.05 : 1.3, {
          force: true,
        });
      return;
    }
    if (e.type === 'oilfire') {
      // A tank farm going up: a deep fireball and a slow rolling second boom.
      this.sample('blastLarge', where.distance, where.pan, 1.9, { force: true, rate: 0.7 });
      this.sample('blastLarge', where.distance, where.pan, 1.2, {
        force: true,
        rate: 0.5,
        delay: 0.6,
      });
      return;
    }
    if (e.type === 'lightning') {
      // Light arrives at once, the thunder after the distance has been covered.
      this.sample('blastLarge', where.distance, where.pan, 1.6, {
        rate: 0.45,
        force: true,
        delay: 0.25 + where.distance / 300,
      });
      return;
    }
    if (e.type === 'build') {
      this.tone(210, 160, 0.09, 0.045, 'triangle');
      return;
    }
    if (['complete', 'research', 'produced', 'recruited'].includes(e.type)) {
      if (e.side === 0 && this.throttle('ui', 0.08)) {
        this.tone(550, 750, 0.12, 0.05);
        setTimeout(() => this.tone(820, 900, 0.18, 0.04), 110);
      }
      return;
    }
    if (e.type === 'reload' && e.side === 0) {
      if (this.throttle('reload', 0.1)) this.sample('reload', where.distance, where.pan, 0.35);
      return;
    }
    if (e.type === 'launch' && this.throttle('launch', 0.1))
      this.sample(
        e.key === 'ballistic' ? 'ballisticLaunch' : e.key === 'cruise' ? 'cruiseLaunch' : 'whoosh',
        where.distance,
        where.pan,
        e.key === 'ballistic' ? 1.05 : 0.8,
      );
  }
  createEngines() {
    const c = this.context,
      kinds = [
        ['diesel', 3],
        ['truck', 2],
        ['rotor', 2],
        ['moped', 3],
        ['jet', 2],
      ];
    for (const [kind, count] of kinds)
      for (let i = 0; i < count; i++) {
        const source = c.createBufferSource(),
          filter = c.createBiquadFilter(),
          level = c.createGain(),
          pan = c.createStereoPanner();
        source.buffer = this.buffers[kind];
        source.loop = true;
        filter.type = 'lowpass';
        filter.frequency.value = kind === 'diesel' ? 500 : 2200;
        // Strike drones are heard across the valley: part of their sound feeds the reverb.
        if (kind === 'moped' || kind === 'rotor') {
          const send = c.createGain();
          send.gain.value = kind === 'moped' ? 0.2 : 0.16;
          pan.connect(send);
          send.connect(this.reverbIn);
        }
        level.gain.value = 0;
        source.connect(filter);
        filter.connect(level);
        level.connect(pan);
        pan.connect(this.dry);
        source.start(c.currentTime, Math.random() * source.buffer.duration);
        this.engines.push({ kind, source, filter, level, pan });
      }
    // Air-raid siren over the city: mostly reverberant, so it sounds distant and huge.
    const siren = c.createBufferSource(),
      sirenTone = c.createBiquadFilter(),
      sirenLevel = c.createGain(),
      sirenWet = c.createGain();
    siren.buffer = this.buffers.siren;
    siren.loop = true;
    sirenTone.type = 'lowpass';
    sirenTone.frequency.value = 2100;
    sirenLevel.gain.value = 0;
    sirenWet.gain.value = 0.8;
    siren.connect(sirenTone);
    sirenTone.connect(sirenLevel);
    sirenLevel.connect(this.dry);
    sirenLevel.connect(sirenWet);
    sirenWet.connect(this.reverbIn);
    siren.start();
    this.siren = { source: siren, level: sirenLevel, filter: sirenTone, on: false };
    if (!this.buffers.rain) return;
    const rain = c.createBufferSource(),
      rainLevel = c.createGain();
    rain.buffer = this.buffers.rain;
    rain.loop = true;
    rainLevel.gain.value = 0;
    rain.connect(rainLevel);
    rainLevel.connect(this.dry);
    rain.start();
    this.rain = { source: rain, level: rainLevel };
  }
  // Raid warning: enemy aircraft in the air close to any of the listener's buildings.
  raidThreat(state, side) {
    const own = state.buildings.filter((b) => b.side === side && b.hp > 0 && !b.demolished);
    for (const u of state.units) {
      if (!hostile(state, side, u.side) || u.hp <= 0 || u.delay > 0 || u.status === 'falling')
        continue;
      for (const b of own) if ((b.x - u.x) ** 2 + (b.z - u.z) ** 2 < 420 * 420) return b;
    }
    return null;
  }
  // Incoming artillery shells whistle during the last second before impact.
  incoming(state) {
    for (const u of state.units || []) {
      if (
        u.key !== 'ballistic' ||
        u.hp <= 0 ||
        u.delay > 0 ||
        u.status === 'falling' ||
        this.whistled.has(u.id)
      )
        continue;
      const left = (u.total - u.travelled) / Math.max(1, u.speed || 90);
      if (left > 1.5 || left < 0.2) continue;
      this.whistled.add(u.id);
      const where = this.locate({ x: u.tx, y: 2, z: u.tz }, 0, 0);
      this.sample('missileDive', where.distance, where.pan, 0.5, { delay: 0, offset: 1.5 - left });
    }
    for (const p of state.projectiles || []) {
      if (!['howitzer', 'mlrs'].includes(p.shooterKey) || this.whistled.has(p.id)) continue;
      const left = (p.flight ?? 0) - p.life;
      if (left > 1.5 || left < 0.2) continue;
      this.whistled.add(p.id);
      const where = this.locate({ x: p.tx, y: 2, z: p.tz }, 0, 0);
      // Recorded rocket air-rush is an approach cue, not a synthesized whistle
      // or a claim that the source recorded a ballistic re-entry.
      this.sample(
        p.shooterKey === 'mlrs' ? 'missileDive' : 'whistle',
        where.distance,
        where.pan,
        0.55,
        {
          delay: 0,
          offset: 1.5 - left,
        },
      );
    }
    if (this.whistled.size > 200) this.whistled.clear();
  }
  update(state, camera, paused, side = 0) {
    if (!this.activated || !this.context) return;
    const c = this.context,
      t = c.currentTime,
      m = camera.matrixWorld.elements;
    this.listener = {
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
      rightX: m[0],
      rightZ: m[2],
    };
    if (!paused) this.incoming(state);
    const walker = this.footsteps.take(
      state.groundUnits || [],
      this.listener,
      state.time ?? t,
      paused || !this.enabled || this.voices >= 36,
    );
    if (walker) {
      const where = this.locate(walker, 0, 0);
      this.sample('footstep', where.distance, where.pan, 0.17, { delay: 0 });
    }
    if (this.rain) {
      const wx = state.weather,
        wet = wx && (wx.kind === 'rain' || wx.kind === 'storm') ? wx.amount : 0;
      // Rain is quieter from high above the valley.
      const height = Math.max(0.35, Math.min(1, 380 / Math.max(120, camera.position.y)));
      this.rain.level.gain.setTargetAtTime(
        this.enabled && !paused ? wet * 0.55 * height : 0,
        t,
        0.8,
      );
    }
    if (this.siren) {
      const city = paused ? null : this.raidThreat(state, side);
      const near = city
        ? distanceMix(
            Math.hypot(city.x - this.listener.x, this.listener.y, city.z - this.listener.z),
          )
        : null;
      this.siren.on = !!city;
      this.siren.level.gain.setTargetAtTime(
        this.enabled && city ? 0.07 * Math.max(0.35, Math.min(1, near.dry * 4)) : 0,
        t,
        city ? 1.2 : 2.5,
      );
    }
    const wanted = { diesel: [], truck: [], rotor: [], moped: [], jet: [] };
    if (!paused) {
      for (const u of state.units)
        if (u.hp > 0 && u.delay <= 0 && u.status !== 'falling')
          wanted[
            ['cruise', 'ballistic'].includes(u.key)
              ? 'jet'
              : u.subtype === 'fpv'
                ? 'rotor'
                : 'moped'
          ].push(u);
      for (const p of state.projectiles || [])
        if (!p.dead && (p.shooterKey === 'mlrs' || p.kind === 'interceptor')) wanted.jet.push(p);
      // Nearby foot soldiers use the bounded one-shot scheduler above.
      for (const u of state.groundUnits || [])
        if (u.hp > 0 && u.moving && VEHICLES.has(u.key))
          wanted[WHEELED.has(u.key) || u.key === 'supplytruck' ? 'truck' : 'diesel'].push(u);
    }
    let active = 0;
    for (const kind of Object.keys(wanted)) {
      const voices = this.engines.filter((v) => v.kind === kind),
        nearest = wanted[kind]
          .map((u) => ({
            u,
            d: Math.hypot(
              u.x - this.listener.x,
              (u.y ?? 2) - this.listener.y,
              u.z - this.listener.z,
            ),
          }))
          .filter((o) => o.d < (kind === 'jet' ? 1500 : 1000))
          .sort((a, b) => a.d - b.d)
          .slice(0, voices.length);
      for (let i = 0; i < voices.length; i++) {
        const voice = voices[i],
          item = nearest[i];
        let gain = 0;
        if (item) {
          active++;
          const { u, d } = item,
            mix = distanceMix(d, 1),
            uav = kind === 'rotor' || kind === 'moped' ? uavEngineMix(u, d, this.listener) : null,
            missile = kind === 'jet' ? recordedJetMix(u, d, this.listener) : null;
          gain =
            kind === 'truck'
              ? 0.24 * mix.dry
              : kind === 'diesel'
                ? 0.32 * mix.dry * (['leopard', 'howitzer', 'heavytank'].includes(u.key) ? 1.25 : 1)
                : uav
                  ? uav.gain
                  : missile.gain;
          voice.source.playbackRate.setTargetAtTime(
            kind === 'diesel'
              ? WHEELED.has(u.key)
                ? 1.15
                : 0.9
              : uav
                ? uav.rate
                : missile
                  ? missile.rate
                  : 1,
            t,
            0.2,
          );
          voice.filter.frequency.setTargetAtTime(
            uav
              ? uav.cutoff
              : missile
                ? missile.cutoff
                : Math.min(kind === 'diesel' ? 600 : 3000, mix.cutoff),
            t,
            0.15,
          );
          voice.pan.pan.setTargetAtTime(
            Math.max(
              -1,
              Math.min(
                1,
                ((u.x - this.listener.x) * m[0] + (u.z - this.listener.z) * m[2]) /
                  Math.max(150, d),
              ),
            ),
            t,
            0.1,
          );
        }
        voice.level.gain.setTargetAtTime(this.enabled ? gain : 0, t, 0.12);
      }
    }
    this.activeEngines = active;
  }
  focus(visible) {
    if (!this.activated || !this.context) return;
    if (visible) this.context.resume().catch(() => {});
    else this.context.suspend().catch(() => {});
  }
  diagnostics() {
    return {
      state: this.context?.state || 'locked',
      enabled: this.enabled,
      voices: this.voices,
      enginePool: this.engines.length,
      activeEngines: this.activeEngines,
      siren: !!this.siren?.on,
      bank: audioBankDiagnostics(),
      rain: this.rain?.level.gain.value ?? 0,
    };
  }
}
import { hostile } from '../game/factions.js';
