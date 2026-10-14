// Every surface is painted here with canvas2D at boot. No image files, no
// network requests -- the whole town is generated on the fly.

const cache = new Map();
function memo(key, fn) { if (!cache.has(key)) cache.set(key, fn()); return cache.get(key); }

function cv(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h || w;
  return c;
}
function shift(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `rgb(${r},${g},${b})`;
}
function speckle(x, S, n, color, alpha, size = 2) {
  for (let i = 0; i < n; i++) {
    x.fillStyle = `rgba(${color},${alpha * Math.random()})`;
    x.fillRect(Math.random() * S, Math.random() * S, size, size);
  }
}

// --------------------------------------------------------------- facades ---
// One tile = 4m x 4m of wall carrying a single window, so a building only has
// to scale its UVs by size/4 for the window grid to line up.
export const FACADES = {
  adobeTan:   { base: '#c6a074', kind: 'stucco', trim: '#efe6d2' },
  adobeWhite: { base: '#ded5c0', kind: 'stucco', trim: '#8c7f6a' },
  adobePink:  { base: '#c99a86', kind: 'stucco', trim: '#f0e6d8' },
  terracotta: { base: '#b06a4c', kind: 'stucco', trim: '#e8dcc8' },
  desertMint: { base: '#a9c2b0', kind: 'siding',  trim: '#f2f0e4', lit: true },
  turquoise:  { base: '#79b0ac', kind: 'siding',  trim: '#f4f2e6' },
  cinder:     { base: '#b0a894', kind: 'cinder', trim: '#7d7768' },
  brickTan:   { base: '#a5825d', kind: 'brick',  trim: '#efe9dc' },
  panelGrey:  { base: '#a8a49a', kind: 'panel',  trim: '#6d6a62' },
  sunBleach:  { base: '#d8c9a4', kind: 'panel',  trim: '#9c8f74', lit: true },
};

export function facade(key) {
  return memo('fac:' + key, () => {
    const S = 256, c = cv(S), x = c.getContext('2d');
    const spec = FACADES[key] || FACADES.brickRed;
    x.fillStyle = spec.base; x.fillRect(0, 0, S, S);

    if (spec.kind === 'brick') {
      for (let row = 0; row * 13 < S; row++) {
        const off = (row & 1) ? 16 : 0;
        for (let col = -1; col * 32 < S + 32; col++) {
          x.fillStyle = shift(spec.base, (Math.random() * 24 - 12) | 0);
          x.fillRect(col * 32 + off + 1, row * 13 + 1, 30, 11);
        }
      }
    } else if (spec.kind === 'cinder') {
      for (let row = 0; row * 32 < S; row++) {
        const off = (row & 1) ? 32 : 0;
        for (let col = -1; col * 64 < S + 64; col++) {
          x.fillStyle = shift(spec.base, (Math.random() * 16 - 8) | 0);
          x.fillRect(col * 64 + off + 2, row * 32 + 2, 60, 28);
        }
      }
    } else if (spec.kind === 'siding') {
      for (let y = 0; y < S; y += 12) {
        x.fillStyle = shift(spec.base, 12); x.fillRect(0, y, S, 10);
        x.fillStyle = shift(spec.base, -30); x.fillRect(0, y + 10, S, 2);
      }
    } else if (spec.kind === 'panel') {
      for (let y = 0; y < S; y += 64) for (let px = 0; px < S; px += 64) {
        x.fillStyle = shift(spec.base, (Math.random() * 14 - 7) | 0);
        x.fillRect(px + 1, y + 1, 62, 62);
        x.strokeStyle = shift(spec.base, -34); x.lineWidth = 2;
        x.strokeRect(px + 2, y + 2, 60, 60);
      }
    } else {
      speckle(x, S, 1400, '255,255,255', 0.10, 3);
      speckle(x, S, 1400, '0,0,0', 0.10, 3);
    }

    // the window
    const wx = 66, wy = 60, ww = 124, wh = 114;
    x.fillStyle = spec.trim; x.fillRect(wx - 9, wy - 9, ww + 18, wh + 18);
    const g = x.createLinearGradient(wx, wy, wx + ww * 0.6, wy + wh);
    if (spec.lit) { g.addColorStop(0, '#ffe9b0'); g.addColorStop(0.6, '#e3ae59'); g.addColorStop(1, '#9c6f2c'); }
    else { g.addColorStop(0, '#40627f'); g.addColorStop(0.45, '#22333f'); g.addColorStop(0.47, '#4a6d8b'); g.addColorStop(1, '#141f29'); }
    x.fillStyle = g; x.fillRect(wx, wy, ww, wh);
    x.save(); x.globalAlpha = 0.15; x.fillStyle = '#fff';
    x.beginPath(); x.moveTo(wx + 8, wy + wh); x.lineTo(wx + ww * 0.5, wy);
    x.lineTo(wx + ww * 0.72, wy); x.lineTo(wx + 32, wy + wh); x.fill(); x.restore();
    x.fillStyle = spec.trim;
    x.fillRect(wx + ww / 2 - 3, wy, 6, wh);
    x.fillRect(wx, wy + wh / 2 - 3, ww, 6);
    x.fillStyle = shift(spec.base, 40);
    x.fillRect(wx - 15, wy + wh + 9, ww + 30, 8);
    speckle(x, S, 900, '0,0,0', 0.06, 2);
    return c;
  });
}

// Ground-floor shopfront: big glass, awning, kick plate.
export function storefront(color = '#b03a34') {
  return memo('sf:' + color, () => {
    const S = 256, c = cv(S), x = c.getContext('2d');
    x.fillStyle = '#7d7a74'; x.fillRect(0, 0, S, S);
    x.fillStyle = color; x.fillRect(0, 0, S, 46);              // fascia band
    x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(0, 42, S, 6);
    const g = x.createLinearGradient(0, 60, S * 0.7, S);
    g.addColorStop(0, '#4e7089'); g.addColorStop(0.4, '#22333f');
    g.addColorStop(0.42, '#5a7e97'); g.addColorStop(1, '#1a2730');
    x.fillStyle = g; x.fillRect(10, 58, S - 20, S - 92);
    x.save(); x.globalAlpha = 0.18; x.fillStyle = '#fff';
    x.beginPath(); x.moveTo(24, S - 34); x.lineTo(S * 0.55, 58); x.lineTo(S * 0.72, 58); x.lineTo(52, S - 34); x.fill();
    x.restore();
    x.fillStyle = '#5c5a56';
    x.fillRect(S / 2 - 4, 58, 8, S - 92);
    x.fillRect(10, 58, S - 20, 6);
    x.fillRect(0, S - 34, S, 34);                              // kick plate
    x.fillStyle = 'rgba(0,0,0,0.3)'; x.fillRect(0, S - 34, S, 4);
    speckle(x, S, 700, '0,0,0', 0.07, 2);
    return c;
  });
}

export function roofTex() {
  return memo('roof', () => {
    const S = 256, c = cv(S), x = c.getContext('2d');
    x.fillStyle = '#4b4a48'; x.fillRect(0, 0, S, S);
    speckle(x, S, 6000, '255,255,255', 0.18, 2);
    speckle(x, S, 4000, '0,0,0', 0.25, 3);
    x.strokeStyle = 'rgba(30,30,30,0.5)'; x.lineWidth = 3;
    for (let i = 0; i < S; i += 64) { x.beginPath(); x.moveTo(0, i); x.lineTo(S, i); x.stroke(); }
    return c;
  });
}

// ---------------------------------------------------------------- ground ---
export function asphalt() {
  return memo('asphalt', () => {
    const S = 256, c = cv(S), x = c.getContext('2d');
    x.fillStyle = '#3b3c40'; x.fillRect(0, 0, S, S);
    speckle(x, S, 5000, '150,150,152', 0.16, 2);
    speckle(x, S, 3000, '10,10,12', 0.35, 3);
    x.strokeStyle = 'rgba(22,22,24,0.55)'; x.lineWidth = 1.5;
    for (let i = 0; i < 6; i++) {
      x.beginPath();
      let px = Math.random() * S, py = Math.random() * S;
      x.moveTo(px, py);
      for (let s = 0; s < 6; s++) { px += Math.random() * 50 - 25; py += Math.random() * 50 - 25; x.lineTo(px, py); }
      x.stroke();
    }
    return c;
  });
}

export function sidewalkTex() {
  return memo('sidewalk', () => {
    const S = 256, c = cv(S), x = c.getContext('2d');
    x.fillStyle = '#9b988f'; x.fillRect(0, 0, S, S);
    speckle(x, S, 4000, '255,255,255', 0.18, 2);
    speckle(x, S, 2500, '0,0,0', 0.12, 2);
    x.strokeStyle = 'rgba(88,86,82,0.85)'; x.lineWidth = 4;
    x.strokeRect(0, 0, S, S);
    x.lineWidth = 3;
    x.beginPath(); x.moveTo(S / 2, 0); x.lineTo(S / 2, S); x.moveTo(0, S / 2); x.lineTo(S, S / 2); x.stroke();
    return c;
  });
}

export function grassTex() {
  return memo('grass', () => {
    const S = 256, c = cv(S), x = c.getContext('2d');
    x.fillStyle = '#4d7539'; x.fillRect(0, 0, S, S);
    for (let i = 0; i < 11000; i++) {
      const v = (Math.random() * 70 - 35) | 0;
      x.strokeStyle = `rgba(${78 + v},${124 + v},${54 + v},0.8)`;
      x.lineWidth = 1;
      const px = Math.random() * S, py = Math.random() * S;
      x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.random() * 3 - 1.5, py - 2 - Math.random() * 4); x.stroke();
    }
    for (let i = 0; i < 60; i++) {
      x.fillStyle = `rgba(190,190,110,${0.2 + Math.random() * 0.4})`;
      x.fillRect(Math.random() * S, Math.random() * S, 2, 2);
    }
    return c;
  });
}

export function dirtTex() {
  return memo('dirt', () => {
    const S = 256, c = cv(S), x = c.getContext('2d');
    x.fillStyle = '#7a6446'; x.fillRect(0, 0, S, S);
    speckle(x, S, 6000, '160,132,92', 0.35, 3);
    speckle(x, S, 3000, '52,40,26', 0.3, 3);
    return c;
  });
}

// Road markings live on their own thin strips laid over the asphalt.
export function roadDash() {
  return memo('dash', () => {
    const c = cv(64, 256), x = c.getContext('2d');
    x.clearRect(0, 0, 64, 256);
    x.fillStyle = '#e0c552';
    x.fillRect(14, 30, 36, 196);
    return c;
  });
}
export function roadLine() {
  return memo('line', () => {
    const c = cv(64, 64), x = c.getContext('2d');
    x.fillStyle = '#dcdcd4'; x.fillRect(16, 0, 32, 64);
    return c;
  });
}
export function crosswalkTex() {
  return memo('xwalk', () => {
    const S = 256, c = cv(S), x = c.getContext('2d');
    x.clearRect(0, 0, S, S);
    x.fillStyle = 'rgba(226,226,220,0.92)';
    for (let i = 0; i < 4; i++) x.fillRect(i * 64 + 12, 0, 40, S);
    return c;
  });
}

// -------------------------------------------------------------- interiors ---
export function interiorFloor(kind) {
  return memo('ifl:' + kind, () => {
    const S = 256, c = cv(S), x = c.getContext('2d');
    if (kind === 'carpet') {
      x.fillStyle = '#6c383a'; x.fillRect(0, 0, S, S);
      speckle(x, S, 14000, '150,80,82', 0.35, 2);
      speckle(x, S, 4000, '40,20,22', 0.3, 2);
    } else if (kind === 'wood') {
      x.fillStyle = '#875c34'; x.fillRect(0, 0, S, S);
      for (let row = 0; row < 8; row++) {
        x.fillStyle = shift('#875c34', (Math.random() * 30 - 15) | 0);
        x.fillRect(0, row * 32, S, 30);
        x.fillStyle = 'rgba(46,30,14,0.85)'; x.fillRect(0, row * 32 + 30, S, 2);
        for (let i = 0; i < 50; i++) {
          x.fillStyle = `rgba(92,60,28,${Math.random() * 0.22})`;
          x.fillRect(Math.random() * S, row * 32 + Math.random() * 30, 24, 1);
        }
      }
    } else if (kind === 'concrete') {
      x.fillStyle = '#8d8b86'; x.fillRect(0, 0, S, S);
      speckle(x, S, 5000, '255,255,255', 0.12, 2);
      speckle(x, S, 3000, '0,0,0', 0.14, 3);
    } else {
      for (let ty = 0; ty < 4; ty++) for (let tx = 0; tx < 4; tx++) {
        x.fillStyle = ((tx + ty) & 1) ? '#c6c5bf' : '#96988f';
        x.fillRect(tx * 64, ty * 64, 64, 64);
        x.strokeStyle = 'rgba(68,68,66,0.55)'; x.lineWidth = 2;
        x.strokeRect(tx * 64 + 1, ty * 64 + 1, 62, 62);
      }
      speckle(x, S, 1200, '0,0,0', 0.05, 2);
    }
    return c;
  });
}

export function interiorWall(tone = '#cdc6b6') {
  return memo('iw:' + tone, () => {
    const S = 256, c = cv(S), x = c.getContext('2d');
    x.fillStyle = tone; x.fillRect(0, 0, S, S);
    speckle(x, S, 2200, '255,255,255', 0.12, 3);
    speckle(x, S, 2200, '0,0,0', 0.07, 3);
    x.fillStyle = 'rgba(105,99,88,0.9)'; x.fillRect(0, S - 16, S, 16);
    x.fillStyle = 'rgba(160,152,138,0.5)'; x.fillRect(0, S - 20, S, 4);
    return c;
  });
}

export function shelfTex() {
  return memo('shelf', () => {
    const S = 256, c = cv(S), x = c.getContext('2d');
    x.fillStyle = '#56565a'; x.fillRect(0, 0, S, S);
    const cols = ['#bc3f39', '#d2a33b', '#3e7cb0', '#4c9550', '#b0aca0', '#864b9a', '#e2e0d6'];
    for (let s = 0; s < 4; s++) {
      const sy = s * 64;
      for (let i = 0; i < 11; i++) {
        const bw = 14 + Math.random() * 9, bh = 24 + Math.random() * 24;
        x.fillStyle = cols[(Math.random() * cols.length) | 0];
        x.fillRect(i * 24 + 2, sy + 56 - bh, bw, bh);
        x.fillStyle = 'rgba(255,255,255,0.7)';
        x.fillRect(i * 24 + 2, sy + 56 - bh + 7, bw, 4);
        x.fillStyle = 'rgba(0,0,0,0.25)';
        x.fillRect(i * 24 + 2, sy + 56 - bh, 2, bh);
      }
      x.fillStyle = '#9d9da1'; x.fillRect(0, sy + 56, S, 8);
      x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(0, sy + 62, S, 3);
    }
    return c;
  });
}

export function ceilingTex() {
  return memo('ceil', () => {
    const S = 256, c = cv(S), x = c.getContext('2d');
    x.fillStyle = '#d4d1c8'; x.fillRect(0, 0, S, S);
    speckle(x, S, 3000, '150,148,142', 0.35, 2);
    x.strokeStyle = 'rgba(120,118,112,0.8)'; x.lineWidth = 3;
    x.strokeRect(1, 1, S - 2, S - 2);
    x.beginPath(); x.moveTo(S / 2, 0); x.lineTo(S / 2, S); x.moveTo(0, S / 2); x.lineTo(S, S / 2); x.stroke();
    return c;
  });
}

export function glassDoorTex() {
  return memo('gdoor', () => {
    const S = 256, c = cv(S), x = c.getContext('2d');
    x.fillStyle = '#4b4e53'; x.fillRect(0, 0, S, S);
    const g = x.createLinearGradient(0, 0, S * 0.7, S);
    g.addColorStop(0, '#4a6580'); g.addColorStop(0.5, '#1f2f3b'); g.addColorStop(1, '#3a5266');
    x.fillStyle = g; x.fillRect(14, 14, S - 28, S - 28);
    x.save(); x.globalAlpha = 0.2; x.fillStyle = '#fff';
    x.beginPath(); x.moveTo(28, S - 18); x.lineTo(S * 0.58, 18); x.lineTo(S * 0.76, 18); x.lineTo(58, S - 18); x.fill();
    x.restore();
    x.fillStyle = '#b7bac0';
    x.fillRect(S / 2 - 4, 14, 8, S - 28);
    x.fillRect(S * 0.26, S * 0.48, 9, 48);
    x.fillRect(S * 0.68, S * 0.48, 9, 48);
    x.fillStyle = 'rgba(255,255,255,0.8)';
    x.font = 'bold 26px Arial'; x.textAlign = 'center';
    x.fillText('OPEN', S / 2, 40);
    return c;
  });
}

// ------------------------------------------------------------------ props ---
export function metalTex(tone = '#8f9296') {
  return memo('metal:' + tone, () => {
    const S = 128, c = cv(S), x = c.getContext('2d');
    x.fillStyle = tone; x.fillRect(0, 0, S, S);
    for (let i = 0; i < 900; i++) {
      x.strokeStyle = `rgba(255,255,255,${Math.random() * 0.10})`;
      x.beginPath();
      const py = Math.random() * S;
      x.moveTo(0, py); x.lineTo(S, py + Math.random() * 4 - 2); x.stroke();
    }
    speckle(x, S, 400, '60,50,40', 0.25, 2);
    return c;
  });
}

export function woodTex() {
  return memo('wood', () => {
    const S = 128, c = cv(S), x = c.getContext('2d');
    x.fillStyle = '#8a6136'; x.fillRect(0, 0, S, S);
    for (let i = 0; i < 300; i++) {
      x.strokeStyle = `rgba(70,44,20,${Math.random() * 0.3})`;
      x.beginPath();
      const py = Math.random() * S;
      x.moveTo(0, py); x.bezierCurveTo(S / 3, py + 3, S / 2, py - 3, S, py + 1); x.stroke();
    }
    return c;
  });
}

export function foliageTex() {
  return memo('leaf', () => {
    const S = 128, c = cv(S), x = c.getContext('2d');
    x.clearRect(0, 0, S, S);
    for (let i = 0; i < 500; i++) {
      const px = Math.random() * S, py = Math.random() * S;
      const d = Math.hypot(px - S / 2, py - S / 2) / (S / 2);
      if (d > 0.95 || Math.random() < d * 0.7) continue;
      const g = 90 + Math.random() * 70;
      x.fillStyle = `rgba(${(g * 0.45) | 0},${g | 0},${(g * 0.35) | 0},0.95)`;
      x.beginPath(); x.ellipse(px, py, 5 + Math.random() * 6, 4 + Math.random() * 4, Math.random() * 3, 0, 7); x.fill();
    }
    return c;
  });
}

// --------------------------------------------------------------- signage ---
export function sign(text, bg = '#15161c', fg = '#ffd24a', sub = '') {
  return memo('sign:' + text + '|' + sub + bg + fg, () => {
    const W = 512, H = 128, c = cv(W, H), x = c.getContext('2d');
    x.fillStyle = bg; x.fillRect(0, 0, W, H);
    x.strokeStyle = fg; x.lineWidth = 5; x.strokeRect(9, 9, W - 18, H - 18);
    x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle';
    let size = 64;
    const font = s => `bold ${s}px "Arial Black", Impact, "Helvetica Neue", sans-serif`;
    x.font = font(size);
    while (x.measureText(text).width > W - 56 && size > 16) { size -= 2; x.font = font(size); }
    x.shadowColor = fg; x.shadowBlur = 16;
    x.fillText(text, W / 2, sub ? H / 2 - 13 : H / 2);
    x.shadowBlur = 0;
    if (sub) {
      x.font = 'bold 21px Arial, sans-serif';
      x.fillStyle = 'rgba(255,255,255,0.8)';
      x.fillText(sub, W / 2, H / 2 + 33);
    }
    return c;
  });
}

export function posterTex(kind) {
  return memo('poster:' + kind, () => {
    const W = 256, H = 320, c = cv(W, H), x = c.getContext('2d');
    const palettes = {
      sale: ['#e03a2f', '#fff45a', 'BLOWOUT', 'EVERYTHING', 'MUST GO'],
      vote: ['#22467e', '#ffffff', 'RE-ELECT', 'MAYOR', 'HANK'],
      milk: ['#f2f2ee', '#2f5aa8', 'GOT', 'MILK', 'PROBABLY'],
      wanted: ['#c8b98e', '#2a2019', 'WANTED', 'THE DUDE', '$0 REWARD'],
    };
    const p = palettes[kind] || palettes.sale;
    x.fillStyle = p[0]; x.fillRect(0, 0, W, H);
    x.strokeStyle = p[1]; x.lineWidth = 6; x.strokeRect(8, 8, W - 16, H - 16);
    x.fillStyle = p[1]; x.textAlign = 'center';
    x.font = 'bold 40px "Arial Black", Impact, sans-serif';
    x.fillText(p[2], W / 2, 90);
    x.font = 'bold 52px "Arial Black", Impact, sans-serif';
    x.fillText(p[3], W / 2, 165);
    x.font = 'bold 26px Arial, sans-serif';
    x.fillText(p[4], W / 2, 230);
    x.globalAlpha = 0.25;
    speckle(x, W, 600, '0,0,0', 0.3, 2);
    return c;
  });
}

// Soft radial blob: fake contact shadows, blood pools, muzzle flash.
export function blob(color = '0,0,0', hard = 0.3) {
  return memo('blob:' + color + hard, () => {
    const S = 128, c = cv(S), x = c.getContext('2d');
    const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, `rgba(${color},0.92)`);
    g.addColorStop(hard, `rgba(${color},0.55)`);
    g.addColorStop(1, `rgba(${color},0)`);
    x.fillStyle = g; x.fillRect(0, 0, S, S);
    return c;
  });
}

// Blood thrown across the lens when something dies close enough.
export function screenSpatter() {
  return memo('screenSpatter', () => {
    const W = 1024, H = 640, c = cv(W, H), x = c.getContext('2d');
    x.clearRect(0, 0, W, H);
    const drop = (px, py, r, a) => {
      const g = x.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, `rgba(122,6,8,${a})`);
      g.addColorStop(0.55, `rgba(96,4,6,${a * 0.75})`);
      g.addColorStop(1, 'rgba(70,2,4,0)');
      x.fillStyle = g;
      x.beginPath();
      x.ellipse(px, py, r, r * (0.6 + Math.random() * 0.7), Math.random() * 3, 0, 7);
      x.fill();
    };
    // heavier round the edges, so the middle stays playable
    for (let i = 0; i < 54; i++) {
      const edge = Math.random();
      let px, py;
      if (edge < 0.3) { px = Math.random() * W; py = Math.random() * H * 0.22; }
      else if (edge < 0.6) { px = Math.random() * W; py = H - Math.random() * H * 0.3; }
      else if (edge < 0.8) { px = Math.random() * W * 0.22; py = Math.random() * H; }
      else { px = W - Math.random() * W * 0.22; py = Math.random() * H; }
      drop(px, py, 12 + Math.random() * 60, 0.45 + Math.random() * 0.45);
    }
    for (let i = 0; i < 150; i++) {
      drop(Math.random() * W, Math.random() * H, 2 + Math.random() * 9, 0.3 + Math.random() * 0.5);
    }
    // a few runs dribbling down
    for (let i = 0; i < 14; i++) {
      const px = Math.random() * W, py = Math.random() * H * 0.5;
      const len = 30 + Math.random() * 120;
      const g = x.createLinearGradient(px, py, px, py + len);
      g.addColorStop(0, 'rgba(110,5,7,0.7)');
      g.addColorStop(1, 'rgba(110,5,7,0)');
      x.fillStyle = g;
      x.fillRect(px, py, 3 + Math.random() * 5, len);
    }
    return c;
  });
}

export function splatTex() {
  return memo('splat', () => {
    const S = 128, c = cv(S), x = c.getContext('2d');
    x.clearRect(0, 0, S, S);
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 34;
      const px = S / 2 + Math.cos(a) * r, py = S / 2 + Math.sin(a) * r;
      x.fillStyle = `rgba(${110 + Math.random() * 40 | 0},8,10,${0.55 + Math.random() * 0.4})`;
      x.beginPath(); x.ellipse(px, py, 6 + Math.random() * 18, 5 + Math.random() * 16, Math.random() * 3, 0, 7); x.fill();
    }
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2, r = 30 + Math.random() * 28;
      x.fillStyle = 'rgba(120,10,12,0.6)';
      x.beginPath(); x.arc(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r, 1 + Math.random() * 4, 0, 7); x.fill();
    }
    return c;
  });
}

// Face texture for NPC heads -- keeps the low-poly people readable up close.
export function faceTex(skin, hair, opts = {}) {
  return memo('face:' + skin + hair + JSON.stringify(opts), () => {
    const S = 128, c = cv(S), x = c.getContext('2d');
    x.fillStyle = skin; x.fillRect(0, 0, S, S);
    // hairline across the top
    x.fillStyle = hair; x.fillRect(0, 0, S, opts.bald ? 10 : 30);
    if (!opts.bald) {
      x.beginPath(); x.moveTo(0, 30); x.quadraticCurveTo(S / 2, 46, S, 30); x.lineTo(S, 30); x.fill();
    }
    // eyes
    const ey = 58;
    for (const ex of [38, 90]) {
      x.fillStyle = '#f2f0ea'; x.beginPath(); x.ellipse(ex, ey, 13, 9, 0, 0, 7); x.fill();
      x.fillStyle = opts.eye || '#38302a';
      x.beginPath(); x.arc(ex + (opts.look || 0), ey, 5.5, 0, 7); x.fill();
      x.fillStyle = hair; x.fillRect(ex - 15, ey - 18, 30, 5);
    }
    if (opts.shades) { x.fillStyle = '#17181c'; x.fillRect(18, ey - 14, 92, 26); x.fillRect(60, ey - 4, 8, 6); }
    // nose + mouth
    x.strokeStyle = `rgba(0,0,0,0.28)`; x.lineWidth = 3;
    x.beginPath(); x.moveTo(64, 62); x.lineTo(60, 82); x.lineTo(70, 84); x.stroke();
    x.strokeStyle = opts.angry ? '#5c2020' : 'rgba(90,40,40,0.75)';
    x.lineWidth = 4; x.beginPath();
    if (opts.angry) { x.moveTo(44, 106); x.quadraticCurveTo(64, 94, 84, 106); }
    else { x.moveTo(46, 100); x.quadraticCurveTo(64, 110, 82, 100); }
    x.stroke();
    if (opts.stubble) { speckle(x, S, 700, '40,30,25', 0.35, 2); }
    speckle(x, S, 300, '0,0,0', 0.05, 2);
    return c;
  });
}

// ------------------------------------------------------------- Paradise ---
// Everything below is the desert dressing: sand, dry scrub, palms, saguaros
// and the mesas out past the town line.
export function sandTex() {
  return memo('sand', () => {
    const S = 256, c = cv(S), x = c.getContext('2d');
    x.fillStyle = '#c2a878'; x.fillRect(0, 0, S, S);
    speckle(x, S, 7000, '236,216,178', 0.3, 3);
    speckle(x, S, 4000, '128,104,70', 0.25, 2);
    // pebbles
    for (let i = 0; i < 220; i++) {
      const px = Math.random() * S, py = Math.random() * S, r = 1 + Math.random() * 2.6;
      x.fillStyle = `rgba(${120 + Math.random() * 60 | 0},${104 + Math.random() * 44 | 0},78,0.55)`;
      x.beginPath(); x.arc(px, py, r, 0, 7); x.fill();
    }
    // wind ripples
    x.strokeStyle = 'rgba(150,128,92,0.18)'; x.lineWidth = 2;
    for (let i = 0; i < 26; i++) {
      x.beginPath();
      const y0 = Math.random() * S;
      x.moveTo(0, y0);
      x.bezierCurveTo(S / 3, y0 + 10, S / 2, y0 - 12, S, y0 + 4);
      x.stroke();
    }
    return c;
  });
}

export function dryGrassTex() {
  return memo('drygrass', () => {
    const S = 256, c = cv(S), x = c.getContext('2d');
    x.fillStyle = '#b9a473'; x.fillRect(0, 0, S, S);
    for (let i = 0; i < 7000; i++) {
      const v = (Math.random() * 60 - 30) | 0;
      x.strokeStyle = `rgba(${152 + v},${138 + v},${74 + v},0.7)`;
      const px = Math.random() * S, py = Math.random() * S;
      x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.random() * 4 - 2, py - 3 - Math.random() * 5); x.stroke();
    }
    for (let i = 0; i < 1200; i++) {
      x.fillStyle = `rgba(96,116,58,${0.25 + Math.random() * 0.4})`;
      x.fillRect(Math.random() * S, Math.random() * S, 2, 3);
    }
    return c;
  });
}

export function rockTex() {
  return memo('rock', () => {
    const S = 256, c = cv(S), x = c.getContext('2d');
    x.fillStyle = '#a2775a'; x.fillRect(0, 0, S, S);
    // strata
    for (let y = 0; y < S; y += 14) {
      const v = (Math.random() * 40 - 20) | 0;
      x.fillStyle = shift('#a2775a', v);
      x.fillRect(0, y, S, 13);
    }
    speckle(x, S, 5000, '60,40,28', 0.22, 3);
    speckle(x, S, 3000, '224,196,160', 0.2, 2);
    return c;
  });
}

export function frondTex() {
  return memo('frond', () => {
    const W = 128, H = 128, c = cv(W, H), x = c.getContext('2d');
    x.clearRect(0, 0, W, H);
    // a single palm frond running left to right, spine down the middle
    x.strokeStyle = '#6f7a34'; x.lineWidth = 4;
    x.beginPath(); x.moveTo(4, H / 2); x.lineTo(W - 6, H / 2); x.stroke();
    for (let i = 0; i < 26; i++) {
      const t = i / 25;
      const px = 6 + t * (W - 14);
      const len = Math.sin(t * Math.PI) * (H / 2 - 6) + 4;
      const g = 108 + Math.random() * 50;
      x.strokeStyle = `rgba(${(g * 0.52) | 0},${g | 0},${(g * 0.32) | 0},0.95)`;
      x.lineWidth = 3.4;
      x.beginPath(); x.moveTo(px, H / 2); x.lineTo(px + 8, H / 2 - len); x.stroke();
      x.beginPath(); x.moveTo(px, H / 2); x.lineTo(px + 8, H / 2 + len); x.stroke();
    }
    return c;
  });
}

export function scrubTex() {
  return memo('scrub', () => {
    const S = 128, c = cv(S), x = c.getContext('2d');
    x.clearRect(0, 0, S, S);
    for (let i = 0; i < 260; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 34;
      const px = S / 2 + Math.cos(a) * r, py = S - 6 - Math.abs(Math.sin(a)) * 44;
      const g = 96 + Math.random() * 60;
      x.strokeStyle = `rgba(${(g * 0.78) | 0},${g | 0},${(g * 0.42) | 0},0.9)`;
      x.lineWidth = 1.6;
      x.beginPath(); x.moveTo(S / 2, S - 4); x.lineTo(px, py); x.stroke();
    }
    return c;
  });
}

export function cactusTex() {
  return memo('cactus', () => {
    const S = 128, c = cv(S), x = c.getContext('2d');
    x.fillStyle = '#4e7a48'; x.fillRect(0, 0, S, S);
    for (let i = 0; i < 7; i++) {
      x.fillStyle = 'rgba(30,58,30,0.55)';
      x.fillRect(i * 18 + 6, 0, 3, S);
      x.fillStyle = 'rgba(150,190,130,0.35)';
      x.fillRect(i * 18 + 12, 0, 5, S);
    }
    for (let i = 0; i < 700; i++) {
      x.fillStyle = `rgba(226,222,180,${0.3 + Math.random() * 0.5})`;
      x.fillRect(Math.random() * S, Math.random() * S, 1.6, 1.6);
    }
    return c;
  });
}
