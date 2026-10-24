import {
  GUNS,
  gunshot,
  explosion,
  whoosh,
  whistle,
  clicks,
  dieselLoop,
  rotorLoop,
  jetLoop,
  impulseResponse,
  sirenLoop,
  mopedLoop,
  rainLoop,
} from './synth.js';

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

export class GameAudio {
  constructor() {
    this.enabled = true;
    this.volume = 0.35;
    this.last = {};
    this.voices = 0;
    this.engines = [];
    this.activeEngines = 0;
    this.whistled = new Set();
    this.listener = null;
  }
  // An OfflineAudioContext may be passed to render the mix to a file for listening tests.
  unlock(context = null) {
    if (!this.context) {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!context && !Audio) return;
      const c = (this.context = context || new Audio());
      this.master = c.createGain();
      this.master.gain.value = this.enabled ? this.volume : 0;
      this.compressor = c.createDynamicsCompressor();
      this.compressor.threshold.value = -14;
      this.compressor.knee.value = 12;
      this.compressor.ratio.value = 5;
      this.compressor.attack.value = 0.002;
      this.compressor.release.value = 0.3;
      this.master.connect(this.compressor);
      this.compressor.connect(c.destination);
      this.dry = c.createGain();
      this.dry.connect(this.master);
      // Shared outdoor reverb and a slap-back echo from the valley sides.
      this.reverb = c.createConvolver();
      const ir = impulseResponse(c.sampleRate),
        irBuffer = c.createBuffer(2, ir[0].length, c.sampleRate);
      irBuffer.copyToChannel(ir[0], 0);
      irBuffer.copyToChannel(ir[1], 1);
      this.reverb.buffer = irBuffer;
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
      this.createEngines();
    }
    if (!context) this.context.resume().catch(() => {});
  }
  buffer(data) {
    const b = this.context.createBuffer(1, data.length, this.context.sampleRate);
    b.copyToChannel(data, 0);
    return b;
  }
  // Engine loops are needed at once; weapon sounds are rendered one per task so starting
  // the game never stalls a frame. A sound that is not ready yet is simply skipped.
  renderBuffers() {
    const rate = this.context.sampleRate,
      out = {
        diesel: this.buffer(dieselLoop(rate)),
        rotor: this.buffer(rotorLoop(rate)),
        jet: this.buffer(jetLoop(rate)),
        moped: this.buffer(mopedLoop(rate)),
        siren: this.buffer(sirenLoop(rate)),
        rain: this.buffer(rainLoop(rate)),
      },
      jobs = [];
    const add = (name, make) => jobs.push(() => (out[name] ||= []).push(this.buffer(make())));
    for (const key of ['rifle', 'mg', 'hmg', 'shilka', 'autocannon', 'blast', 'tank'])
      if (GUNS[key]) add(key, () => gunshot(rate, GUNS[key]));
    add('blast', () => explosion(rate, 1.2));
    add('blastSmall', () => explosion(rate, 0.75));
    add('whoosh', () => whoosh(rate, 1.4));
    for (const key of Object.keys(GUNS)) add(key, () => gunshot(rate, GUNS[key]));
    for (const key of ['rifle', 'mg', 'hmg', 'shilka']) add(key, () => gunshot(rate, GUNS[key]));
    add('blastLarge', () => explosion(rate, 2.2));
    add('blastSmall', () => explosion(rate, 0.85));
    add('blast', () => explosion(rate, 1.35));
    add('atgm', () => whoosh(rate, 0.9));
    add('whistle', () => whistle(rate, 1.3));
    add('reload', () => clicks(rate));
    const next = () => {
      const job = jobs.shift();
      if (!job) return;
      job();
      setTimeout(next, 0);
    };
    setTimeout(next, 0);
    return out;
  }
  set(enabled, volume = this.volume) {
    this.enabled = enabled;
    this.volume = volume;
    if (this.master)
      this.master.gain.setTargetAtTime(enabled ? volume : 0, this.context.currentTime, 0.05);
  }
  // Interface blips stay synthetic and centred; they are not part of the battlefield.
  tone(freq, end, length, gain = 0.1, type = 'sine') {
    if (!this.context || !this.enabled || this.voices > 40) return;
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
    const list = this.buffers?.[name];
    if (!list || !this.enabled || this.voices > 44) return;
    const mix = distanceMix(distance, loudness);
    if (mix.dry < 0.012 && !options.force) return;
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
    source.onended = () => {
      this.voices--;
      for (const node of [source, filter, dry, wet, echo, stereo]) node.disconnect();
    };
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
    if (!this.context || !this.enabled) return;
    const where = this.locate(e, distance, pan);
    if (e.type === 'shot') {
      const kind = soundClass(e);
      if (kind === 'sam') {
        if (this.throttle('sam', 0.12)) this.sample('whoosh', where.distance, where.pan, 1.1);
        return;
      }
      if (kind === 'rocket') {
        if (this.throttle('rocket', 0.07)) this.sample('whoosh', where.distance, where.pan, 1.2);
        return;
      }
      if (kind === 'atgm') {
        if (this.throttle('atgm', 0.1)) {
          this.sample('rifle', where.distance, where.pan, 0.6, { rate: 0.6 });
          this.sample('atgm', where.distance, where.pan, 0.9);
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
      this.sample('whoosh', where.distance, where.pan, 0.8);
  }
  createEngines() {
    const c = this.context,
      kinds = [
        ['diesel', 3],
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
        if (kind === 'moped') {
          const send = c.createGain();
          send.gain.value = 0.35;
          level.connect(send);
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
    sirenTone.frequency.value = 2600;
    sirenLevel.gain.value = 0;
    sirenWet.gain.value = 0.8;
    siren.connect(sirenTone);
    sirenTone.connect(sirenLevel);
    sirenLevel.connect(this.dry);
    sirenLevel.connect(sirenWet);
    sirenWet.connect(this.reverbIn);
    siren.start();
    this.siren = { source: siren, level: sirenLevel, filter: sirenTone, on: false };
    const rain = c.createBufferSource(),
      rainLevel = c.createGain();
    rain.buffer = this.buffers.rain;
    rain.loop = true;
    rainLevel.gain.value = 0;
    rain.connect(rainLevel);
    rainLevel.connect(this.dry);
    rain.start();
    this.rain = { level: rainLevel };
  }
  // Raid warning: enemy aircraft in the air close to any of the listener's buildings.
  raidThreat(state, side) {
    const own = state.buildings.filter((b) => b.side === side && b.hp > 0 && !b.demolished);
    for (const u of state.units) {
      if (u.side === side || u.hp <= 0 || u.delay > 0 || u.status === 'falling') continue;
      for (const b of own) if ((b.x - u.x) ** 2 + (b.z - u.z) ** 2 < 420 * 420) return b;
    }
    return null;
  }
  // Incoming artillery shells whistle during the last second before impact.
  incoming(state) {
    for (const p of state.projectiles || []) {
      if (p.shooterKey !== 'howitzer' || this.whistled.has(p.id)) continue;
      const left = (p.flight ?? 0) - p.life;
      if (left > 1.3 || left < 0.2) continue;
      this.whistled.add(p.id);
      const where = this.locate({ x: p.tx, y: 2, z: p.tz }, 0, 0);
      // Skip into the whistle so it ends together with the shell.
      this.sample('whistle', where.distance, where.pan, 0.55, { delay: 0, offset: 1.3 - left });
    }
    if (this.whistled.size > 200) this.whistled.clear();
  }
  update(state, camera, paused, side = 0) {
    if (!this.context) return;
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
    if (this.rain) {
      const wx = state.weather,
        wet = wx && (wx.kind === 'rain' || wx.kind === 'storm') ? wx.amount : 0;
      // Rain is quieter from high above the valley.
      const height = Math.max(0.35, Math.min(1, 380 / Math.max(120, camera.position.y)));
      this.rain.level.gain.setTargetAtTime(
        this.enabled && !paused ? wet * 0.14 * height : 0,
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
    const wanted = { diesel: [], rotor: [], moped: [], jet: [] };
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
      // Only machines have engines; soldiers on foot are silent while walking.
      for (const u of state.groundUnits || [])
        if (u.hp > 0 && u.moving && VEHICLES.has(u.key)) wanted.diesel.push(u);
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
          .filter((o) => o.d < 1000)
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
            heavy = u.key === 'heavy',
            fpv = u.subtype === 'fpv';
          gain =
            kind === 'diesel'
              ? 0.32 * mix.dry * (['leopard', 'howitzer', 'heavytank'].includes(u.key) ? 1.25 : 1)
              : kind === 'rotor'
                ? 0.1 * mix.dry
                : kind === 'moped'
                  ? 0.24 * Math.min(1, mix.dry * 1.6) * (heavy ? 1.25 : 1)
                  : 0.3 * mix.dry;
          voice.source.playbackRate.setTargetAtTime(
            kind === 'diesel'
              ? WHEELED.has(u.key)
                ? 1.15
                : 0.9
              : kind === 'rotor'
                ? fpv
                  ? 1.5
                  : 1
                : kind === 'moped'
                  ? heavy
                    ? 0.82
                    : 1.04
                  : 1,
            t,
            0.2,
          );
          voice.filter.frequency.setTargetAtTime(
            Math.min(kind === 'diesel' ? 600 : 3000, mix.cutoff),
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
    if (!this.context) return;
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
      rain: this.rain?.level.gain.value ?? 0,
    };
  }
}
