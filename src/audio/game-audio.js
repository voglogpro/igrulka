export class GameAudio {
  constructor() {
    this.enabled = true;
    this.volume = 0.35;
    this.last = {};
    this.voices = 0;
    this.engines = [];
    this.activeEngines = 0;
  }
  unlock() {
    if (!this.context) {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return;
      this.context = new Audio();
      this.master = this.context.createGain();
      this.master.gain.value = this.enabled ? this.volume : 0;
      this.compressor = this.context.createDynamicsCompressor();
      this.compressor.threshold.value = -16;
      this.compressor.knee.value = 18;
      this.compressor.ratio.value = 7;
      this.compressor.attack.value = 0.003;
      this.compressor.release.value = 0.24;
      this.master.connect(this.compressor);
      this.compressor.connect(this.context.destination);
      this.noiseBuffer = this.context.createBuffer(
        1,
        this.context.sampleRate * 2,
        this.context.sampleRate,
      );
      const channel = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < channel.length; i++) channel[i] = Math.random() * 2 - 1;
      this.createEngines();
    }
    this.context.resume().catch(() => {});
  }
  set(enabled, volume = this.volume) {
    this.enabled = enabled;
    this.volume = volume;
    if (this.master)
      this.master.gain.setTargetAtTime(enabled ? volume : 0, this.context.currentTime, 0.05);
  }
  tone(freq, end, length, gain = 0.1, type = 'sine') {
    if (!this.context || !this.enabled || this.voices > 24) return;
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
    const stereo = c.createStereoPanner();
    stereo.pan.value = this.pan || 0;
    g.connect(stereo);
    stereo.connect(this.master);
    o.start(t);
    o.stop(t + length + 0.01);
    this.voices++;
    o.onended = () => {
      this.voices--;
      o.disconnect();
      g.disconnect();
      stereo.disconnect();
    };
  }
  noise(length, gain, cutoff) {
    if (!this.context || !this.enabled || this.voices > 24) return;
    const c = this.context,
      t = c.currentTime,
      n = c.createBufferSource(),
      filter = c.createBiquadFilter(),
      g = c.createGain();
    n.buffer = this.noiseBuffer;
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + length);
    n.connect(filter);
    filter.connect(g);
    const stereo = c.createStereoPanner();
    stereo.pan.value = this.pan || 0;
    g.connect(stereo);
    stereo.connect(this.master);
    n.start(t, Math.random());
    n.stop(t + length);
    this.voices++;
    n.onended = () => {
      this.voices--;
      n.disconnect();
      filter.disconnect();
      g.disconnect();
      stereo.disconnect();
    };
  }
  play(e, distance = 0, pan = 0) {
    if (!this.context || !this.enabled) return;
    const t = this.context.currentTime,
      key = e.type === 'shot' ? e.key : e.type;
    if (t - (this.last[key] ?? -10) < (e.type === 'shot' ? 0.09 : 0.08)) return;
    this.last[key] = t;
    const gain = Math.max(0.035, 1 - distance / 1100);
    this.pan = Math.max(-1, Math.min(1, pan));
    if (e.type === 'shot') {
      if (e.key === 'sam') {
        this.noise(0.6, 0.26 * gain, 2200);
        this.tone(130, 45, 0.5, 0.07 * gain, 'sawtooth');
      } else {
        this.noise(e.key === 'gun' ? 0.07 : 0.17, 0.22 * gain, e.key === 'gun' ? 4500 : 1900);
        this.tone(e.key === 'gun' ? 110 : 75, 35, 0.09, 0.12 * gain, 'triangle');
      }
    }
    if (e.type === 'intercept' && e.mode === 'fall') {
      this.noise(0.18, 0.2 * gain, 4300);
      this.tone(680, 90, 1.05, 0.09 * gain, 'triangle');
    }
    if (
      ['impact', 'destroy', 'crash', 'groundDestroyed'].includes(e.type) ||
      (e.type === 'intercept' && e.mode !== 'fall')
    ) {
      this.noise(e.type === 'intercept' ? 0.5 : 1.3, 0.5 * gain, 1200);
      this.tone(75, 25, 0.6, 0.4 * gain, 'sine');
    }
    if (e.type === 'build') {
      this.tone(210, 160, 0.09, 0.045, 'triangle');
      this.noise(0.08, 0.05, 1300);
    }
    if (
      e.type === 'complete' ||
      e.type === 'research' ||
      e.type === 'produced' ||
      e.type === 'recruited'
    ) {
      if (e.side === 0) {
        this.tone(550, 750, 0.12, 0.055);
        setTimeout(() => this.tone(820, 900, 0.18, 0.045), 110);
      }
    }
    if (e.type === 'reload' && e.side === 0) {
      this.noise(0.16, 0.04 * gain, 2600);
      this.tone(150, 100, 0.12, 0.025 * gain, 'triangle');
    }
    if (e.type === 'launch') {
      this.noise(0.45, 0.15 * gain, 1800);
      this.tone(65, 100, 0.3, 0.08 * gain, 'triangle');
    }
  }
  createEngines() {
    const c = this.context;
    for (let i = 0; i < 6; i++) {
      const base = c.createOscillator(),
        harmonic = c.createOscillator(),
        filter = c.createBiquadFilter(),
        level = c.createGain(),
        pan = c.createStereoPanner(),
        rotor = c.createOscillator(),
        mod = c.createGain(),
        tremolo = c.createGain();
      base.type = 'sawtooth';
      base.frequency.value = 85;
      harmonic.type = 'triangle';
      harmonic.frequency.value = 170;
      filter.type = 'lowpass';
      filter.frequency.value = 900;
      tremolo.gain.value = 0.7;
      rotor.frequency.value = 28;
      mod.gain.value = 0.22;
      rotor.connect(mod);
      mod.connect(tremolo.gain);
      base.connect(filter);
      harmonic.connect(filter);
      filter.connect(tremolo);
      tremolo.connect(level);
      level.gain.value = 0;
      level.connect(pan);
      pan.connect(this.master);
      base.start();
      harmonic.start();
      rotor.start();
      this.engines.push({ base, harmonic, filter, level, pan, rotor });
    }
  }
  update(state, camera, paused, target) {
    if (!this.context) return;
    const c = this.context,
      t = c.currentTime,
      units = paused
        ? []
        : [
            ...state.units.filter((u) => u.hp > 0 && u.delay <= 0 && u.status !== 'falling'),
            ...(state.groundUnits || []).filter(
              (u) => u.hp > 0 && u.key !== 'infantry' && u.moving,
            ),
          ]
            .map((u) => ({ u, d: Math.hypot(u.x - target.x, u.z - target.z) }))
            .filter((o) => o.d < 900)
            .sort((a, b) => a.d - b.d)
            .slice(0, 6);
    this.activeEngines = units.length;
    const rightX = camera.matrixWorld.elements[0],
      rightZ = camera.matrixWorld.elements[2];
    for (let i = 0; i < this.engines.length; i++) {
      const voice = this.engines[i],
        item = units[i];
      let gain = 0;
      if (item) {
        const { u, d } = item,
          ground = ['leopard', 'gepard', 'shilka'].includes(u.key),
          freq = ground
            ? 42
            : u.key === 'heavy'
              ? 58
              : u.key === 'drone'
                ? 92
                : u.key === 'cruise'
                  ? 155
                  : 185,
          sway = 1 + Math.sin(state.time * 6 + (u.phase || 0)) * 0.016;
        voice.base.frequency.setTargetAtTime(freq * sway, t, 0.08);
        voice.harmonic.frequency.setTargetAtTime(freq * 2.01 * sway, t, 0.08);
        voice.rotor.frequency.setTargetAtTime(ground ? 12 : u.key === 'heavy' ? 19 : 31, t, 0.1);
        voice.filter.frequency.setTargetAtTime(
          ground ? 340 : u.key === 'drone' || u.key === 'heavy' ? 800 : 1450,
          t,
          0.1,
        );
        gain = 0.065 / (1 + (d * d) / 50000);
        voice.pan.pan.setTargetAtTime(
          Math.max(-1, Math.min(1, ((u.x - target.x) * rightX + (u.z - target.z) * rightZ) / 400)),
          t,
          0.1,
        );
      }
      voice.level.gain.setTargetAtTime(this.enabled ? gain : 0, t, 0.08);
    }
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
    };
  }
}
