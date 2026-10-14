// Hand-rolled vector / matrix math. Column-major mat4, same layout WebGL wants.

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = t => t * t * (3 - 2 * t);

// Deterministic PRNG -- the town is the same town every load.
export function rngFrom(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const pick = (r, arr) => arr[(r() * arr.length) | 0];
export const rand = (r, a, b) => a + r() * (b - a);
export const randI = (r, a, b) => a + ((r() * (b - a + 1)) | 0);

export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
export function dist2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }

// ---------------------------------------------------------------- mat4 ----
export const mat4 = {
  create() {
    const m = new Float32Array(16);
    m[0] = m[5] = m[10] = m[15] = 1;
    return m;
  },
  identity(m) {
    m.fill(0); m[0] = m[5] = m[10] = m[15] = 1; return m;
  },
  perspective(out, fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    out.fill(0);
    out[0] = f / aspect; out[5] = f;
    out[10] = (far + near) * nf; out[11] = -1;
    out[14] = 2 * far * near * nf;
    return out;
  },
  ortho(out, l, r, b, t, n, f) {
    out.fill(0);
    out[0] = 2 / (r - l); out[5] = 2 / (t - b); out[10] = -2 / (f - n);
    out[12] = -(r + l) / (r - l); out[13] = -(t + b) / (t - b); out[14] = -(f + n) / (f - n);
    out[15] = 1;
    return out;
  },
  multiply(out, a, b) {
    for (let c = 0; c < 4; c++) {
      const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
      out[c * 4 + 0] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
      out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
      out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
      out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
    }
    return out;
  },
  // First-person view matrix straight from position + yaw/pitch (no lookAt needed).
  fpsView(out, px, py, pz, yaw, pitch, roll = 0) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cr = Math.cos(roll), sr = Math.sin(roll);
    // camera basis in world space (looking down -Z when yaw=pitch=0)
    let rx = cy, ry = 0, rz = -sy;                  // right
    let ux = sy * sp, uy = cp, uz = cy * sp;        // up
    let fx = -sy * cp, fy = sp, fz = -cy * cp;      // forward
    if (roll) {
      const nrx = rx * cr + ux * sr, nry = ry * cr + uy * sr, nrz = rz * cr + uz * sr;
      const nux = ux * cr - rx * sr, nuy = uy * cr - ry * sr, nuz = uz * cr - rz * sr;
      rx = nrx; ry = nry; rz = nrz; ux = nux; uy = nuy; uz = nuz;
    }
    // view = transpose(rotation) * translate(-eye)
    out[0] = rx; out[4] = ry; out[8] = rz; out[12] = -(rx * px + ry * py + rz * pz);
    out[1] = ux; out[5] = uy; out[9] = uz; out[13] = -(ux * px + uy * py + uz * pz);
    out[2] = -fx; out[6] = -fy; out[10] = -fz; out[14] = (fx * px + fy * py + fz * pz);
    out[3] = 0; out[7] = 0; out[11] = 0; out[15] = 1;
    return out;
  },
  // model = translate * rotY * rotX * rotZ * scale  (the only compose we need)
  compose(out, tx, ty, tz, ry, sx, sy, sz, rx = 0, rz = 0) {
    const cy = Math.cos(ry), syn = Math.sin(ry);
    const cx = Math.cos(rx), sxn = Math.sin(rx);
    const cz = Math.cos(rz), szn = Math.sin(rz);
    // R = Ry * Rx * Rz
    const m00 = cy * cz + syn * sxn * szn, m01 = -cy * szn + syn * sxn * cz, m02 = syn * cx;
    const m10 = cx * szn, m11 = cx * cz, m12 = -sxn;
    const m20 = -syn * cz + cy * sxn * szn, m21 = syn * szn + cy * sxn * cz, m22 = cy * cx;
    out[0] = m00 * sx; out[1] = m10 * sx; out[2] = m20 * sx; out[3] = 0;
    out[4] = m01 * sy; out[5] = m11 * sy; out[6] = m21 * sy; out[7] = 0;
    out[8] = m02 * sz; out[9] = m12 * sz; out[10] = m22 * sz; out[11] = 0;
    out[12] = tx; out[13] = ty; out[14] = tz; out[15] = 1;
    return out;
  },
  invert(out, a) {
    const b00 = a[0] * a[5] - a[1] * a[4], b01 = a[0] * a[6] - a[2] * a[4],
      b02 = a[0] * a[7] - a[3] * a[4], b03 = a[1] * a[6] - a[2] * a[5],
      b04 = a[1] * a[7] - a[3] * a[5], b05 = a[2] * a[7] - a[3] * a[6],
      b06 = a[8] * a[13] - a[9] * a[12], b07 = a[8] * a[14] - a[10] * a[12],
      b08 = a[8] * a[15] - a[11] * a[12], b09 = a[9] * a[14] - a[10] * a[13],
      b10 = a[9] * a[15] - a[11] * a[13], b11 = a[10] * a[15] - a[11] * a[14];
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return null;
    det = 1 / det;
    out[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * det;
    out[1] = (a[2] * b10 - a[1] * b11 - a[3] * b09) * det;
    out[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * det;
    out[3] = (a[10] * b04 - a[9] * b05 - a[11] * b03) * det;
    out[4] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * det;
    out[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * det;
    out[6] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * det;
    out[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * det;
    out[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * det;
    out[9] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * det;
    out[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * det;
    out[11] = (a[9] * b02 - a[8] * b04 - a[11] * b00) * det;
    out[12] = (a[5] * b07 - a[4] * b09 - a[6] * b06) * det;
    out[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * det;
    out[14] = (a[13] * b01 - a[12] * b03 - a[14] * b00) * det;
    out[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * det;
    return out;
  },
  // Normal matrix (mat3, inverse-transpose of the upper 3x3) packed for a mat3 uniform.
  normalMat(out, m) {
    const a00 = m[0], a01 = m[1], a02 = m[2];
    const a10 = m[4], a11 = m[5], a12 = m[6];
    const a20 = m[8], a21 = m[9], a22 = m[10];
    const b01 = a22 * a11 - a12 * a21, b11 = -a22 * a10 + a12 * a20, b21 = a21 * a10 - a11 * a20;
    let det = a00 * b01 + a01 * b11 + a02 * b21;
    if (!det) { out.fill(0); out[0] = out[4] = out[8] = 1; return out; }
    det = 1 / det;
    out[0] = b01 * det;
    out[1] = (-a22 * a01 + a02 * a21) * det;
    out[2] = (a12 * a01 - a02 * a11) * det;
    out[3] = b11 * det;
    out[4] = (a22 * a00 - a02 * a20) * det;
    out[5] = (-a12 * a00 + a02 * a10) * det;
    out[6] = b21 * det;
    out[7] = (-a21 * a00 + a01 * a20) * det;
    out[8] = (a11 * a00 - a01 * a10) * det;
    return out;
  },
};
