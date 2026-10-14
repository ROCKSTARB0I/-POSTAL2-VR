// Pre-rendered dialogue. The lines are baked to audio by tools/render-voices.py
// using the system speech voices, then played back through WebAudio here --
// which means real voices with proper 3D placement, and nothing that depends on
// the browser's speech API being in a good mood.
export class VoiceBank {
  constructor() {
    this.manifest = null;
    this.buffers = new Map();     // filename -> AudioBuffer
    this.pending = new Map();     // filename -> Promise
    this.ready = false;
    this.failed = false;
  }

  async load(base = 'voices/') {
    this.base = base;
    try {
      const res = await fetch(base + 'manifest.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('no manifest');
      this.manifest = await res.json();
      this.ready = true;
    } catch (e) {
      this.failed = true;        // fall back to the browser's speech engine
    }
    return this.ready;
  }

  // Which file, if any, covers this line.
  fileFor(text, npc, variant) {
    if (!this.ready) return null;
    const t = String(text).trim();
    if (npc) {
      const list = this.manifest.npc[t];
      if (!list || !list.length) return null;
      return list[Math.abs(variant | 0) % list.length];
    }
    return this.manifest.dude[t] || null;
  }

  has(text, npc) {
    return !!this.fileFor(text, npc, 0);
  }

  async buffer(ctx, file) {
    if (this.buffers.has(file)) return this.buffers.get(file);
    if (this.pending.has(file)) return this.pending.get(file);
    const job = (async () => {
      const res = await fetch(this.base + file);
      const raw = await res.arrayBuffer();
      const buf = await new Promise((ok, no) => {
        const r = ctx.decodeAudioData(raw, ok, no);
        if (r && r.then) r.then(ok, no);
      });
      this.buffers.set(file, buf);
      this.pending.delete(file);
      return buf;
    })();
    this.pending.set(file, job);
    return job;
  }

  // Returns the clip length in ms (0 if we have nothing for this line).
  play(ctx, dest, text, opts = {}) {
    const file = this.fileFor(text, opts.npc, opts.variant || 0);
    if (!file) return 0;
    const est = this.buffers.has(file) ? this.buffers.get(file).duration * 1000 : 300 + text.length * 55;
    this.buffer(ctx, file).then(buf => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      // playback rate doubles as a pitch shift, so one recording can cover
      // several characters without sounding like the same person
      src.playbackRate.value = opts.rate || 1;
      const g = ctx.createGain();
      g.gain.value = opts.volume === undefined ? 1 : opts.volume;
      src.connect(g);
      if (ctx.createStereoPanner) {
        const p = ctx.createStereoPanner();
        p.pan.value = opts.pan || 0;
        g.connect(p); p.connect(dest);
      } else g.connect(dest);
      src.start();
      if (opts.onNode) opts.onNode(src);
    }).catch(() => { });
    return est;
  }

  // Warm the cache for the lines the player hears most.
  preload(ctx, limit = 40) {
    if (!this.ready) return;
    const files = Object.values(this.manifest.dude).slice(0, limit);
    let i = 0;
    const next = () => {
      if (i >= files.length) return;
      this.buffer(ctx, files[i++]).then(() => setTimeout(next, 60), () => setTimeout(next, 60));
    };
    next();
  }
}
