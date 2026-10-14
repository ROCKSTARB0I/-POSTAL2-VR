// Minimal WebGL2 renderer written for this game: one lit/textured/fogged program,
// one procedural sky program, a mesh builder for baked static geometry, and a
// unit cube + quad for everything that moves.
import { mat4 } from './math.js';

const VERT_FLOATS = 11;               // pos3 nrm3 uv2 tint3
const STRIDE = VERT_FLOATS * 4;

const WORLD_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec2 aUV;
layout(location=3) in vec3 aTint;
uniform mat4 uProj, uView, uModel;
uniform mat3 uNorm;
uniform vec2 uUVScale, uUVOffset;
out vec3 vNrm; out vec2 vUV; out vec3 vTint; out vec3 vWorld;
void main(){
  vec4 wp = uModel * vec4(aPos,1.0);
  vWorld = wp.xyz;
  vNrm = normalize(uNorm * aNrm);
  vUV = aUV * uUVScale + uUVOffset;
  vTint = aTint;
  gl_Position = uProj * uView * wp;
}`;

const WORLD_FS = `#version 300 es
precision highp float;
in vec3 vNrm; in vec2 vUV; in vec3 vTint; in vec3 vWorld;
uniform sampler2D uTex;
uniform vec3 uSunDir, uSunColor, uAmbient, uFogColor, uCamPos;
uniform vec4 uColor;          // rgb multiply, a = opacity
uniform float uFogDensity;    // 0 disables fog
uniform float uUnlit;         // 1 = skip lighting (flashes, sprites)
uniform int uAlphaMode;       // 0 opaque, 1 cutout, 2 blended
out vec4 frag;
void main(){
  vec4 t = texture(uTex, vUV);
  if (uAlphaMode == 1 && t.a < 0.5) discard;
  vec3 N = normalize(vNrm);
  float ndl = max(dot(N, uSunDir), 0.0);
  // cheap sky/ground hemisphere bounce so nothing reads as flat black
  vec3 bounce = mix(vec3(0.20,0.18,0.15), vec3(0.30,0.34,0.42), N.y*0.5+0.5);
  vec3 light = uAmbient + uSunColor * ndl + bounce * 0.5;
  vec3 col = t.rgb * vTint * uColor.rgb;
  col = mix(col * light, col, uUnlit);
  if (uFogDensity > 0.0) {
    float d = length(vWorld - uCamPos) * uFogDensity;
    col = mix(col, uFogColor, clamp(1.0 - exp(-d*d), 0.0, 1.0));
  }
  float a = uColor.a * (uAlphaMode == 2 ? t.a : 1.0);
  frag = vec4(col, a);
}`;

const SKY_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
uniform mat4 uInvVP;
uniform vec3 uCamPos;
out vec3 vDir;
void main(){
  vec4 far = uInvVP * vec4(aPos, 1.0, 1.0);
  vDir = normalize(far.xyz / far.w - uCamPos);
  gl_Position = vec4(aPos, 1.0, 1.0);
}`;

const SKY_FS = `#version 300 es
precision highp float;
in vec3 vDir;
uniform vec3 uSunDir, uHorizon, uZenith, uSunColor;
uniform float uTime;
out vec4 frag;

float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  float a = hash(i), b = hash(i+vec2(1,0)), c = hash(i+vec2(0,1)), d = hash(i+vec2(1,1));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
float fbm(vec2 p){
  float v = 0.0, amp = 0.5;
  for (int i=0;i<4;i++){ v += amp*vnoise(p); p *= 2.03; amp *= 0.5; }
  return v;
}
void main(){
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -1.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h,0.0,1.0), 0.55));
  col = mix(col, uHorizon*0.82, clamp(-h*3.0, 0.0, 1.0));   // below the horizon: haze
  // sun
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * pow(sd, 900.0) * 6.0;
  col += uSunColor * pow(sd, 24.0) * 0.28;
  // clouds on a flat dome
  if (h > 0.02) {
    vec2 uv = d.xz / max(h, 0.02) * 0.055 + vec2(uTime*0.004, uTime*0.0016);
    float n = fbm(uv*1.6);
    float cover = smoothstep(0.52, 0.86, n) * smoothstep(0.02, 0.22, h);
    vec3 cloud = mix(vec3(0.62,0.64,0.70), vec3(1.02,1.0,0.97), smoothstep(0.5,0.95,n));
    col = mix(col, cloud, cover*0.85);
  }
  frag = vec4(col, 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error('shader: ' + gl.getShaderInfoLog(s));
  }
  return s;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    u[info.name.replace('[0]', '')] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

// ---------------------------------------------------------------------------
// Mesh building. Everything static in town is poured into one of these and
// uploaded once.
// ---------------------------------------------------------------------------
export class MeshBuilder {
  constructor() { this.v = []; }

  get count() { return this.v.length / VERT_FLOATS; }

  vert(x, y, z, nx, ny, nz, u, vv, t) {
    this.v.push(x, y, z, nx, ny, nz, u, vv, t[0], t[1], t[2]);
  }

  // Quad from 4 corners (CCW seen from the front), tint per-corner optional.
  quad(a, b, c, d, n, uv, tint, tints) {
    const t0 = tints ? tints[0] : tint, t1 = tints ? tints[1] : tint;
    const t2 = tints ? tints[2] : tint, t3 = tints ? tints[3] : tint;
    this.vert(a[0], a[1], a[2], n[0], n[1], n[2], uv[0], uv[1], t0);
    this.vert(b[0], b[1], b[2], n[0], n[1], n[2], uv[2], uv[3], t1);
    this.vert(c[0], c[1], c[2], n[0], n[1], n[2], uv[4], uv[5], t2);
    this.vert(a[0], a[1], a[2], n[0], n[1], n[2], uv[0], uv[1], t0);
    this.vert(c[0], c[1], c[2], n[0], n[1], n[2], uv[4], uv[5], t2);
    this.vert(d[0], d[1], d[2], n[0], n[1], n[2], uv[6], uv[7], t3);
  }

  // Axis-aligned (or Y-rotated) box centred at cx,cy,cz.
  // Corners for every face go bottom-left, bottom-right, top-right, top-left as
  // seen from outside, so U runs along the surface and V runs up it.
  // opts.uv = metres covered by one texture tile.
  box(cx, cy, cz, w, h, d, opts = {}) {
    const uvS = opts.uv || 4;
    const tint = opts.tint || WHITE;
    const ry = opts.ry || 0;
    const faces = opts.faces || FACES_ALL;
    const shadeTop = opts.shadeTop === undefined ? 1.0 : opts.shadeTop;
    const gradient = opts.gradient || 0;
    const hw = w / 2, hh = h / 2, hd = d / 2;
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const P = (x, y, z) => [cx + x * cs + z * sn, cy + y, cz - x * sn + z * cs];
    const N = (x, y, z) => [x * cs + z * sn, y, -x * sn + z * cs];
    const uo = opts.uvOffset || [0, 0];

    // per-corner tint for a bottom-to-top gradient: BL, BR, TR, TL
    const lo = gradient ? mul3(tint, 1 - gradient) : tint;
    const grad = gradient ? [lo, lo, tint, tint] : null;

    if (faces.px) this.quad(P(hw, -hh, hd), P(hw, -hh, -hd), P(hw, hh, -hd), P(hw, hh, hd),
      N(1, 0, 0), rectUV(d, h, uvS, uo), tint, grad);
    if (faces.nx) this.quad(P(-hw, -hh, -hd), P(-hw, -hh, hd), P(-hw, hh, hd), P(-hw, hh, -hd),
      N(-1, 0, 0), rectUV(d, h, uvS, uo), tint, grad);
    if (faces.pz) this.quad(P(-hw, -hh, hd), P(hw, -hh, hd), P(hw, hh, hd), P(-hw, hh, hd),
      N(0, 0, 1), rectUV(w, h, uvS, uo), tint, grad);
    if (faces.nz) this.quad(P(hw, -hh, -hd), P(-hw, -hh, -hd), P(-hw, hh, -hd), P(hw, hh, -hd),
      N(0, 0, -1), rectUV(w, h, uvS, uo), tint, grad);
    if (faces.py) this.quad(P(-hw, hh, hd), P(hw, hh, hd), P(hw, hh, -hd), P(-hw, hh, -hd),
      N(0, 1, 0), rectUV(w, d, uvS, uo), mul3(tint, shadeTop));
    if (faces.ny) this.quad(P(-hw, -hh, -hd), P(hw, -hh, -hd), P(hw, -hh, hd), P(-hw, -hh, hd),
      N(0, -1, 0), rectUV(w, d, uvS, uo), mul3(tint, 0.55));
  }

  // Flat horizontal slab at height y. `down` makes it a ceiling instead.
  ground(x0, z0, x1, z1, y, uvS, tint, down) {
    const u = (x1 - x0) / uvS, v = (z1 - z0) / uvS;
    const uv = [0, 0, u, 0, u, v, 0, v];
    if (down) {
      this.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [0, -1, 0], uv, tint || WHITE);
    } else {
      this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], uv, tint || WHITE);
    }
  }

  // Vertical plane (signs, posters, fronds, foliage cards).
  panel(cx, cy, cz, w, h, ry, tint, flip) {
    const hw = w / 2, hh = h / 2;
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const P = (x, y) => [cx + x * cs, cy + y, cz - x * sn];
    const n = [sn, 0, cs];
    if (flip) {
      // back face, with U mirrored so lettering still reads the right way round
      this.quad(P(hw, -hh), P(-hw, -hh), P(-hw, hh), P(hw, hh),
        [-n[0], 0, -n[2]], [1, 0, 0, 0, 0, 1, 1, 1], tint || WHITE);
    } else {
      this.quad(P(-hw, -hh), P(hw, -hh), P(hw, hh), P(-hw, hh),
        n, [0, 0, 1, 0, 1, 1, 0, 1], tint || WHITE);
    }
  }

  cylinder(cx, cy, cz, r, h, seg, tint, uvS = 4) {
    const t = tint || WHITE;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const x0 = Math.cos(a0) * r, z0 = Math.sin(a0) * r;
      const x1 = Math.cos(a1) * r, z1 = Math.sin(a1) * r;
      const u0 = (i / seg) * (2 * Math.PI * r) / uvS, u1 = ((i + 1) / seg) * (2 * Math.PI * r) / uvS;
      const vh = h / uvS;
      this.quad([cx + x0, cy, cz + z0], [cx + x1, cy, cz + z1],
        [cx + x1, cy + h, cz + z1], [cx + x0, cy + h, cz + z0],
        [Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2)],
        [u0, 0, u1, 0, u1, vh, u0, vh], t);
      // cap
      this.vert(cx, cy + h, cz, 0, 1, 0, 0.5, 0.5, t);
      this.vert(cx + x0, cy + h, cz + z0, 0, 1, 0, 0.5 + x0 / r * 0.5, 0.5 + z0 / r * 0.5, t);
      this.vert(cx + x1, cy + h, cz + z1, 0, 1, 0, 0.5 + x1 / r * 0.5, 0.5 + z1 / r * 0.5, t);
    }
  }

  build(gl) {
    const data = new Float32Array(this.v);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, STRIDE, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, STRIDE, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, STRIDE, 24);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 3, gl.FLOAT, false, STRIDE, 32);
    gl.bindVertexArray(null);
    const count = data.length / VERT_FLOATS;
    this.v = null;
    return { vao, count };
  }
}

const WHITE = [1, 1, 1];
const FACES_ALL = { px: 1, nx: 1, py: 1, ny: 1, pz: 1, nz: 1 };
export const FACES_NO_BOTTOM = { px: 1, nx: 1, py: 1, ny: 0, pz: 1, nz: 1 };
const mul3 = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
function rectUV(w, h, s, o) {
  const u = w / s, v = h / s;
  return [o[0], o[1], o[0] + u, o[1], o[0] + u, o[1] + v, o[0], o[1] + v];
}

// ---------------------------------------------------------------------------
export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', {
      antialias: true, alpha: false, powerPreference: 'high-performance', depth: true,
      xrCompatible: true,
    });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.canvas = canvas;
    this.gl = gl;
    this.world = program(gl, WORLD_VS, WORLD_FS);
    this.sky = program(gl, SKY_VS, SKY_FS);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clearColor(0.55, 0.62, 0.70, 1);

    // fullscreen triangle for the sky
    this.skyVAO = gl.createVertexArray();
    gl.bindVertexArray(this.skyVAO);
    const sb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, sb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    // shared dynamic primitives
    const cube = new MeshBuilder();
    cube.box(0, 0, 0, 1, 1, 1, { uv: 1 });
    this.unitCube = cube.build(gl);
    const quad = new MeshBuilder();
    quad.panel(0, 0, 0, 1, 1, 0);
    this.unitQuad = quad.build(gl);
    const flat = new MeshBuilder();
    flat.ground(-0.5, -0.5, 0.5, 0.5, 0, 1);
    this.unitGround = flat.build(gl);

    this.whiteTex = this.textureFromPixel(255, 255, 255);
    this.proj = mat4.create();
    this.view = mat4.create();
    this.model = mat4.create();
    this.nrm = new Float32Array(9);
    this.invVP = mat4.create();
    this.tmpA = mat4.create();
    this.camPos = [0, 0, 0];
    this.time = 0;
    this.drawCalls = 0;

    // High desert at eleven in the morning: hard sun, dusty haze, clear air.
    this.sun = normalize([0.34, 0.88, 0.36]);
    this.sunColor = [1.28, 1.14, 0.92];
    this.ambient = [0.40, 0.39, 0.37];
    this.fogColor = [0.80, 0.73, 0.60];
    this.fogDensity = 0.0016;
    this.horizon = [0.87, 0.81, 0.67];
    this.zenith = [0.15, 0.40, 0.78];
  }

  textureFromPixel(r, g, b) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([r, g, b, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    return t;
  }

  texture(canvas, { wrap = true, mips = true, nearest = false } = {}) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    const w = wrap ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, w);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, w);
    if (mips) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER,
        nearest ? gl.NEAREST_MIPMAP_LINEAR : gl.LINEAR_MIPMAP_LINEAR);
      const ext = gl.getExtension('EXT_texture_filter_anisotropic');
      if (ext) gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT,
        Math.min(8, gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, nearest ? gl.NEAREST : gl.LINEAR);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, nearest ? gl.NEAREST : gl.LINEAR);
    return t;
  }

  // Canvas-backed texture that can be refreshed in place (the VR wrist panel).
  updateTexture(tex, canvas) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    return tex;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(this.canvas.clientWidth * dpr);
    const h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
    }
    this.aspect = w / Math.max(1, h);
    this.gl.viewport(0, 0, w, h);
  }

  beginFrame(camX, camY, camZ, yaw, pitch, fov, roll = 0) {
    this.resize();
    this.clearFrame();
    mat4.perspective(this.proj, fov, this.aspect, 0.06, 900);
    mat4.fpsView(this.view, camX, camY, camZ, yaw, pitch, roll);
    this.setCamera(this.proj, this.view, camX, camY, camZ);
  }

  // Clear once per frame. In VR both eyes share the cleared buffer.
  clearFrame() {
    const gl = this.gl;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.drawCalls = 0;
  }

  // Point the renderer at a camera. VR passes the headset's own per-eye
  // projection and view matrices straight through.
  setCamera(proj, view, camX, camY, camZ, viewport) {
    const gl = this.gl;
    if (viewport) gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
    if (proj !== this.proj) this.proj.set(proj);
    if (view !== this.view) this.view.set(view);
    this.camPos[0] = camX; this.camPos[1] = camY; this.camPos[2] = camZ;
    this.drawSky();
    const { p, u } = this.world;
    gl.useProgram(p);
    gl.uniformMatrix4fv(u.uProj, false, this.proj);
    gl.uniformMatrix4fv(u.uView, false, this.view);
    gl.uniform3fv(u.uSunDir, this.sun);
    gl.uniform3fv(u.uSunColor, this.sunColor);
    gl.uniform3fv(u.uAmbient, this.ambient);
    gl.uniform3fv(u.uFogColor, this.fogColor);
    gl.uniform3fv(u.uCamPos, this.camPos);
    gl.uniform1f(u.uFogDensity, this.fogDensity);
    gl.uniform1i(u.uTex, 0);
    this.setDepthWrite(true);
    gl.disable(gl.BLEND);
  }

  drawSky() {
    const gl = this.gl, { p, u } = this.sky;
    mat4.multiply(this.tmpA, this.proj, this.view);
    mat4.invert(this.invVP, this.tmpA);
    gl.useProgram(p);
    gl.depthMask(false);
    gl.disable(gl.DEPTH_TEST);
    gl.uniformMatrix4fv(u.uInvVP, false, this.invVP);
    gl.uniform3fv(u.uCamPos, this.camPos);
    gl.uniform3fv(u.uSunDir, this.sun);
    gl.uniform3fv(u.uSunColor, this.sunColor);
    gl.uniform3fv(u.uHorizon, this.horizon);
    gl.uniform3fv(u.uZenith, this.zenith);
    gl.uniform1f(u.uTime, this.time);
    gl.bindVertexArray(this.skyVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
  }

  setDepthWrite(on) { this.gl.depthMask(on); }

  setBlend(on) {
    const gl = this.gl;
    if (on) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }
    else gl.disable(gl.BLEND);
  }
  setAdditive() {
    const gl = this.gl;
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  }

  // Draw a built mesh. modelMat may be null for baked world geometry.
  draw(mesh, tex, modelMat, opts = {}) {
    if (!mesh || !mesh.count) return;
    const gl = this.gl, u = this.world.u;
    const m = modelMat || IDENTITY;
    gl.uniformMatrix4fv(u.uModel, false, m);
    mat4.normalMat(this.nrm, m);
    gl.uniformMatrix3fv(u.uNorm, false, this.nrm);
    const c = opts.color || WHITE;
    gl.uniform4f(u.uColor, c[0], c[1], c[2], opts.alpha === undefined ? 1 : opts.alpha);
    gl.uniform1f(u.uUnlit, opts.unlit ? 1 : 0);
    gl.uniform1i(u.uAlphaMode, opts.alphaMode || 0);
    gl.uniform1f(u.uFogDensity, opts.noFog ? 0 : this.fogDensity);
    const s = opts.uvScale || ONE2, o = opts.uvOffset || ZERO2;
    gl.uniform2f(u.uUVScale, s[0], s[1]);
    gl.uniform2f(u.uUVOffset, o[0], o[1]);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex || this.whiteTex);
    gl.bindVertexArray(mesh.vao);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    this.drawCalls++;
  }

  // Convenience: a coloured box placed in the world (limbs, props, cars...).
  box(x, y, z, sx, sy, sz, ry, color, opts = {}) {
    mat4.compose(this.model, x, y, z, ry, sx, sy, sz, opts.rx || 0, opts.rz || 0);
    this.draw(this.unitCube, opts.tex || this.whiteTex, this.model,
      { color, alpha: opts.alpha, unlit: opts.unlit, alphaMode: opts.alphaMode, uvScale: opts.uvScale });
  }
}

const IDENTITY = mat4.create();
const ONE2 = [1, 1], ZERO2 = [0, 0];
function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}
