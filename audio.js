// All sound is synthesised at runtime: noise bursts, filtered oscillators and
// envelopes. NPC dialogue rides on the browser's speech synthesiser.
import { rngFrom, rand, clamp } from './math.js';
import { VoiceBank } from './voicebank.js';

const rng = rngFrom(0x5AFE);

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.voice = true;
    this.lx = 0; this.lz = 0; this.lyaw = 0;
    this.speakCd = 0;
    this.lastSpeak = 0;
    this.voices = [];
    this.sirenNodes = null;
    // Pre-rendered dialogue, baked from the system voices. The browser's
    // speech API is only a fallback now.
    this.bank = new VoiceBank();
    this.bank.load();
    if ('speechSynthesis' in window) {
      const load = () => { this.voices = window.speechSynthesis.getVoices() || []; };
      load();
      window.speechSynthesis.onvoiceschanged = load;
    }
  }

  ensure() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume === undefined ? 0.55 : this.volume;
    this.master.connect(this.ctx.destination);
    // one second of white noise, reused by everything
    const sr = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, sr, sr);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.startAmbience();
    if (this.bank.ready && !this._preloaded) { this._preloaded = true; this.bank.preload(this.ctx); }
    return this.ctx;
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }
  setListener(x, z, yaw) { this.lx = x; this.lz = z; this.lyaw = yaw; }

  // Distance gain + stereo pan for a world position.
  place(x, z, reach = 45) {
    const dx = x - this.lx, dz = z - this.lz;
    const d = Math.hypot(dx, dz);
    const gain = clamp(1 - d / reach, 0, 1) ** 1.6;
    // right vector of the listener
    const rx = Math.cos(this.lyaw), rz = -Math.sin(this.lyaw);
    const pan = d < 0.4 ? 0 : clamp((dx * rx + dz * rz) / d, -1, 1) * 0.85;
    return { gain, pan, d };
  }

  chain(x, z, reach) {
    const ctx = this.ensure();
    const g = ctx.createGain();
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const at = (x === undefined) ? { gain: 1, pan: 0, d: 0 } : this.place(x, z, reach);
    g.gain.value = at.gain;
    if (p) { p.pan.value = at.pan; g.connect(p); p.connect(this.master); }
    else g.connect(this.master);
    return { ctx, node: g, at };
  }

  noise(dest, dur, { type = 'lowpass', freq = 1200, q = 1, gain = 1, sweep = 0 } = {}) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * sweep), ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0008, ctx.currentTime + dur);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start();
    src.stop(ctx.currentTime + dur + 0.02);
    return g;
  }

  tone(dest, freq, dur, { type = 'sine', gain = 0.3, slideTo = 0, delay = 0 } = {}) {
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.02);
    return g;
  }

  // ------------------------------------------------------------ effects ---
  gunshot(x, z, kind = 'pistol') {
    if (!this.enabled) return;
    const { node } = this.chain(x, z, 120);
    if (kind === 'shotgun') {
      this.noise(node, 0.42, { type: 'lowpass', freq: 2600, gain: 1.0, sweep: 0.08 });
      this.noise(node, 0.10, { type: 'highpass', freq: 1800, gain: 0.7 });
      this.tone(node, 92, 0.28, { type: 'triangle', gain: 0.5, slideTo: 40 });
    } else if (kind === 'smg') {
      this.noise(node, 0.14, { type: 'bandpass', freq: 1700, q: 0.8, gain: 0.7, sweep: 0.3 });
      this.tone(node, 180, 0.10, { type: 'square', gain: 0.22, slideTo: 70 });
    } else {
      this.noise(node, 0.20, { type: 'lowpass', freq: 3400, gain: 0.85, sweep: 0.12 });
      this.tone(node, 150, 0.14, { type: 'triangle', gain: 0.3, slideTo: 60 });
    }
    // slap-back off the buildings
    setTimeout(() => {
      if (!this.ctx) return;
      const { node: n2 } = this.chain(x, z, 120);
      n2.gain.value *= 0.22;
      this.noise(n2, 0.3, { type: 'lowpass', freq: 900, gain: 0.5, sweep: 0.3 });
    }, 95);
  }

  dryFire(x, z) { if (!this.enabled) return; const { node } = this.chain(x, z, 30); this.noise(node, 0.05, { type: 'highpass', freq: 2600, gain: 0.5 }); }

  reload(x, z) {
    if (!this.enabled) return;
    const { node } = this.chain(x, z, 30);
    this.noise(node, 0.06, { type: 'bandpass', freq: 1400, q: 2, gain: 0.5 });
    setTimeout(() => { if (this.ctx) this.noise(this.chain(x, z, 30).node, 0.08, { type: 'bandpass', freq: 900, q: 2, gain: 0.6 }); }, 180);
  }

  swing(x, z) {
    if (!this.enabled) return;
    const { node } = this.chain(x, z, 30);
    this.noise(node, 0.22, { type: 'bandpass', freq: 700, q: 0.7, gain: 0.5, sweep: 2.4 });
  }

  punch(x, z) {
    if (!this.enabled) return;
    const { node } = this.chain(x, z, 40);
    this.noise(node, 0.09, { type: 'lowpass', freq: 700, gain: 0.9 });
    this.tone(node, 110, 0.1, { type: 'sine', gain: 0.35, slideTo: 55 });
  }

  meat(x, z) {
    if (!this.enabled) return;
    const { node } = this.chain(x, z, 40);
    this.noise(node, 0.14, { type: 'lowpass', freq: 520, gain: 1.0, sweep: 0.4 });
    this.tone(node, 80, 0.12, { type: 'sine', gain: 0.3, slideTo: 45 });
  }

  // Something coming apart.
  gib(x, z) {
    if (!this.enabled) return;
    const { node } = this.chain(x, z, 60);
    this.noise(node, 0.3, { type: 'lowpass', freq: 1100, gain: 1.0, sweep: 0.18 });
    this.noise(node, 0.14, { type: 'bandpass', freq: 420, q: 0.7, gain: 0.9 });
    this.tone(node, 70, 0.3, { type: 'sine', gain: 0.45, slideTo: 32 });
    setTimeout(() => {
      if (!this.ctx) return;
      const { node: n2 } = this.chain(x, z, 50);
      this.noise(n2, 0.22, { type: 'lowpass', freq: 600, gain: 0.5, sweep: 0.4 });
    }, 70);
  }

  thud(x, z) {
    if (!this.enabled) return;
    const { node } = this.chain(x, z, 60);
    this.noise(node, 0.25, { type: 'lowpass', freq: 260, gain: 1.0 });
    this.tone(node, 60, 0.3, { type: 'sine', gain: 0.5, slideTo: 30 });
  }

  ricochet(x, z) {
    if (!this.enabled) return;
    const { node } = this.chain(x, z, 45);
    this.tone(node, 2200 + rng() * 1600, 0.13, { type: 'square', gain: 0.10, slideTo: 500 });
  }

  scream(x, z) {
    if (!this.enabled) return;
    const { node } = this.chain(x, z, 55);
    const f = 420 + rng() * 320;
    this.tone(node, f, 0.5, { type: 'sawtooth', gain: 0.14, slideTo: f * 1.7 });
    this.tone(node, f * 1.5, 0.45, { type: 'triangle', gain: 0.07, slideTo: f * 0.8 });
  }

  death(x, z) {
    if (!this.enabled) return;
    const { node } = this.chain(x, z, 50);
    const f = 300 + rng() * 200;
    this.tone(node, f, 0.7, { type: 'sawtooth', gain: 0.12, slideTo: f * 0.35 });
    this.noise(node, 0.5, { type: 'lowpass', freq: 900, gain: 0.2, sweep: 0.2 });
  }

  hurt() {
    if (!this.enabled) return;
    const { node } = this.chain();
    this.tone(node, 180, 0.3, { type: 'sawtooth', gain: 0.16, slideTo: 90 });
    this.noise(node, 0.2, { type: 'lowpass', freq: 500, gain: 0.35 });
  }

  // Somebody pointing and laughing at you across the street.
  laugh(x, z) {
    if (!this.enabled) return;
    const { node } = this.chain(x, z, 40);
    const base = 220 + rng() * 180;
    for (let i = 0; i < 4; i++) {
      this.tone(node, base * (1 - i * 0.06), 0.11, {
        type: 'sawtooth', gain: 0.09, slideTo: base * 0.72, delay: i * 0.14,
      });
    }
  }

  // Gagging.
  retch(x, z) {
    if (!this.enabled) return;
    const { node } = this.chain(x, z, 40);
    this.tone(node, 150, 0.35, { type: 'sawtooth', gain: 0.11, slideTo: 78 });
    this.noise(node, 0.3, { type: 'lowpass', freq: 700, gain: 0.3, sweep: 0.3 });
  }

  honk(x, z) {
    if (!this.enabled) return;
    const { node } = this.chain(x, z, 70);
    this.tone(node, 330, 0.35, { type: 'square', gain: 0.10 });
    this.tone(node, 262, 0.35, { type: 'square', gain: 0.08 });
  }

  pickup(kind) {
    if (!this.enabled) return;
    const { node } = this.chain();
    if (kind === 'cash') {
      this.tone(node, 880, 0.09, { type: 'square', gain: 0.12 });
      this.tone(node, 1320, 0.12, { type: 'square', gain: 0.10, delay: 0.07 });
    } else {
      this.tone(node, 620, 0.1, { type: 'triangle', gain: 0.16 });
      this.tone(node, 930, 0.14, { type: 'triangle', gain: 0.12, delay: 0.06 });
    }
  }

  ding() {
    if (!this.enabled) return;
    const { node } = this.chain();
    this.tone(node, 1244, 0.5, { type: 'sine', gain: 0.14 });
    this.tone(node, 1661, 0.5, { type: 'sine', gain: 0.09, delay: 0.05 });
  }

  errandDone() {
    if (!this.enabled) return;
    const { node } = this.chain();
    [523, 659, 784, 1047].forEach((f, i) =>
      this.tone(node, f, 0.28, { type: 'triangle', gain: 0.13, delay: i * 0.075 }));
  }

  dayDone() {
    if (!this.enabled) return;
    const { node } = this.chain();
    [392, 523, 659, 784, 1047, 1319].forEach((f, i) =>
      this.tone(node, f, 0.5, { type: 'triangle', gain: 0.12, delay: i * 0.1 }));
  }

  fail() {
    if (!this.enabled) return;
    const { node } = this.chain();
    [330, 262, 196].forEach((f, i) => this.tone(node, f, 0.5, { type: 'sawtooth', gain: 0.14, delay: i * 0.14 }));
  }

  step(x, z, hard) {
    if (!this.enabled) return;
    const { node } = this.chain(x, z, 14);
    this.noise(node, 0.07, { type: hard ? 'bandpass' : 'lowpass', freq: hard ? 1500 : 480, q: 1.2, gain: 0.22 });
  }

  // Rolling police siren while the heat is on.
  siren(on) {
    if (!this.enabled) { on = false; }
    if (on && !this.sirenNodes) {
      const ctx = this.ensure();
      const g = ctx.createGain();
      g.gain.value = 0.0;
      g.connect(this.master);
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      const lfo = ctx.createOscillator();
      lfo.type = 'sine'; lfo.frequency.value = 0.55;
      const lg = ctx.createGain(); lg.gain.value = 240;
      lfo.connect(lg); lg.connect(o.frequency);
      o.frequency.value = 700;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 3;
      o.connect(f); f.connect(g);
      o.start(); lfo.start();
      this.sirenNodes = { g, o, lfo };
    }
    if (this.sirenNodes) {
      const target = on ? 0.05 : 0;
      this.sirenNodes.g.gain.setTargetAtTime(target, this.ctx.currentTime, 0.6);
    }
  }

  // Looping trickle while the relief button is held.
  stream(on) {
    if (!this.enabled) on = false;
    if (on && !this.streamNodes) {
      const ctx = this.ensure();
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf; src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = 1500; f.Q.value = 1.6;
      const f2 = ctx.createBiquadFilter();
      f2.type = 'lowpass'; f2.frequency.value = 2600;
      const g = ctx.createGain(); g.gain.value = 0;
      const lfo = ctx.createOscillator();
      lfo.type = 'sine'; lfo.frequency.value = 5.5;
      const lg = ctx.createGain(); lg.gain.value = 420;
      lfo.connect(lg); lg.connect(f.frequency);
      src.connect(f); f.connect(f2); f2.connect(g); g.connect(this.master);
      src.start(); lfo.start();
      this.streamNodes = { g };
    }
    if (this.streamNodes) {
      this.streamNodes.g.gain.setTargetAtTime(on ? 0.16 : 0, this.ctx.currentTime, 0.05);
    }
  }

  ambience(level) {
    if (this.amb) this.amb.gain.setTargetAtTime(level, this.ctx.currentTime, 1.5);
  }

  startAmbience() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 340; f.Q.value = 0.4;
    const g = ctx.createGain(); g.gain.value = 0.018;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start();
    this.amb = g;
  }

  // ------------------------------------------------------------- dialogue ---
  // Straightforward browser speech, the way it was to begin with.
  pickVoice(person) {
    if (!this.voices.length) return null;
    const en = this.voices.filter(v => /^en/i.test(v.lang));
    const list = en.length ? en : this.voices;
    if (!list.length) return null;
    if (person._voiceIdx === undefined) person._voiceIdx = (Math.random() * list.length) | 0;
    return list[person._voiceIdx % list.length];
  }

  bark(text, person, game, urgency = 1) {
    if (!this.voice) return;
    const now = performance.now();
    if (now - this.lastSpeak < 1400 / urgency) return;
    const d = Math.hypot(person.x - this.lx, person.z - this.lz);
    if (d > 26) return;

    // recorded line, placed in the world
    if (this.bank.ready && this.bank.has(text, true)) {
      if (this.busyUntil && now < this.busyUntil && urgency < 1.2) return;
      if (this.dudeUntil && now < this.dudeUntil) return;        // he has the mic
      this.lastSpeak = now;
      if (person._voiceIdx === undefined) person._voiceIdx = (Math.random() * 997) | 0;
      if (person._rateVar === undefined) person._rateVar = rand(rng, 0.94, 1.18);
      const at = this.place(person.x, person.z, 30);
      const ms = this.bank.play(this.ensure(), this.master, text, {
        npc: true,
        variant: person._voiceIdx,
        volume: clamp(1 - d / 30, 0.05, 1),
        pan: at.pan,
        rate: person._rateVar * (urgency > 1.2 ? 1.12 : 1),
      });
      this.busyUntil = now + ms * 0.75;
      return;
    }

    if (!('speechSynthesis' in window)) return;
    if (window.speechSynthesis.speaking && urgency < 1.2) return;
    this.lastSpeak = now;
    const u = new SpeechSynthesisUtterance(text);
    const v = this.pickVoice(person);
    if (v) u.voice = v;
    u.rate = clamp(0.95 * urgency + rand(rng, -0.08, 0.12), 0.6, 1.9);
    if (person.pitch === undefined) person.pitch = rand(rng, 0.6, 1.5);
    u.pitch = clamp(person.pitch * (urgency > 1.2 ? 1.25 : 1), 0.1, 2);
    u.volume = clamp(1 - d / 30, 0.05, 1);
    try { window.speechSynthesis.speak(u); } catch (e) { }
  }

  // The Dude talks to himself, and he gets the mic.
  dude(text) {
    if (!this.voice) return;
    const now = performance.now();
    if (now - this.lastSpeak < 900) return;

    if (this.bank.ready && this.bank.has(text, false)) {
      this.lastSpeak = now;
      if (this.dudeNode) { try { this.dudeNode.stop(); } catch (e) { } }   // cuts himself off
      const ms = this.bank.play(this.ensure(), this.master, text, {
        npc: false, volume: 1, pan: 0, rate: 1,
        onNode: n => { this.dudeNode = n; },
      });
      this.dudeUntil = now + ms;
      return;
    }

    if (!('speechSynthesis' in window)) return;
    this.lastSpeak = now;
    // only cuts off a line that is genuinely still playing
    if (window.speechSynthesis.speaking) {
      try { window.speechSynthesis.cancel(); } catch (e) { }
    }
    const u = new SpeechSynthesisUtterance(text);
    const en = this.voices.filter(v => /^en/i.test(v.lang));
    if (en.length) u.voice = en[0];
    u.rate = 0.92;
    u.pitch = 0.62;
    u.volume = 0.95;
    try { window.speechSynthesis.speak(u); } catch (e) { }
  }

  diagnose() {
    const s = window.speechSynthesis;
    return {
      voicesEnabled: this.voice,
      voicesLoaded: this.voices.length,
      bankReady: this.bank.ready,
      bankLines: this.bank.ready
        ? Object.keys(this.bank.manifest.dude).length + Object.keys(this.bank.manifest.npc).length : 0,
      speaking: !!(s && s.speaking),
      paused: !!(s && s.paused),
    };
  }

  shutUp() { if ('speechSynthesis' in window) { try { window.speechSynthesis.cancel(); } catch (e) { } } }
}
