// WebXR mode. Stereo rendering through the same renderer the flat game uses,
// motion-controller aiming, smooth locomotion with snap turn, and hands that
// come from the headset's own joint tracking when it offers it.
import { mat4, clamp, TAU } from './math.js';
import { WEAPONS } from './weapons.js';

// Finger chains, in the joint names WebXR uses.
const FINGERS = [
  ['wrist', 'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'],
  ['index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip'],
  ['middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip'],
  ['ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip'],
  ['pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip'],
];
const SKIN = [0.80, 0.60, 0.46];
const SKIN_DARK = [0.62, 0.44, 0.33];

export class VR {
  constructor(game) {
    this.g = game;
    this.active = false;
    this.session = null;
    this.refSpace = null;
    this.playerM = mat4.create();
    this.tmp = mat4.create();
    this.tmp2 = mat4.create();
    this.viewM = mat4.create();
    this.camWorld = mat4.create();
    this.hands = { left: null, right: null };
    this.snapLatch = false;
    this.lastT = 0;
    this.onFrame = this.onFrame.bind(this);
    this.panels = {};
  }

  static async supported() {
    if (!navigator.xr) return false;
    try { return await navigator.xr.isSessionSupported('immersive-vr'); } catch (e) { return false; }
  }

  async enter() {
    if (this.active) return;
    const gl = this.g.r.gl;
    try {
      await gl.makeXRCompatible();
      const session = await navigator.xr.requestSession('immersive-vr', {
        optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
      });
      this.session = session;
      session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });
      this.refSpace = await session.requestReferenceSpace('local-floor')
        .catch(() => session.requestReferenceSpace('local'));
      session.addEventListener('end', () => this.cleanup());
      this.buildPanels();
      this.active = true;
      this.g.menu.close();
      this.g.paused = false;
      this.lastT = 0;
      session.requestAnimationFrame(this.onFrame);
      return true;
    } catch (err) {
      this.g.notify('VR FAILED: ' + (err && err.message ? err.message : err));
      return false;
    }
  }

  exit() { if (this.session) this.session.end(); }

  cleanup() {
    this.active = false;
    this.session = null;
    this.g.vrMove = null;
    this.g.aimDir = null;
    this.g.aimOrigin = null;
    this.g.vrSprint = false;
    this.g.paused = true;
    this.g.menu.open(this.g.started ? 'pause' : 'main');
    this.g.lastT = performance.now();
    requestAnimationFrame(this.g.frame);
  }

  // ------------------------------------------------------------ panels ---
  buildPanels() {
    const r = this.g.r;
    const mk = (w, h) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      return { canvas: c, ctx: c.getContext('2d'), tex: r.texture(c, { wrap: false, mips: false }) };
    };
    this.panels.vitals = mk(256, 300);   // left wrist: map, health, stamina
    this.panels.tasks = mk(256, 300);    // right wrist: the list
    this.panelCd = 0;
  }

  refreshPanels(dt) {
    this.panelCd -= dt;
    if (this.panelCd > 0) return;
    this.panelCd = 0.2;
    const g = this.g, r = g.r;

    // --- left wrist ---------------------------------------------------
    const v = this.panels.vitals, vc = v.ctx;
    vc.fillStyle = '#0e1013'; vc.fillRect(0, 0, 256, 300);
    g.drawMapInto(vc, 256, 190, 120, false);
    const bar = (y, frac, col, label) => {
      vc.fillStyle = 'rgba(255,255,255,0.12)'; vc.fillRect(12, y, 232, 24);
      vc.fillStyle = col; vc.fillRect(12, y, 232 * clamp(frac, 0, 1), 24);
      vc.fillStyle = '#fff'; vc.font = 'bold 15px Helvetica, Arial'; vc.textAlign = 'left';
      vc.fillText(label, 18, y + 17);
    };
    bar(204, g.player.hp / 100, '#c0392b', 'HEALTH ' + Math.ceil(g.player.hp));
    bar(234, g.player.stamina / 100, g.player.winded ? '#e0703f' : '#b8b23c',
      'STAMINA ' + Math.ceil(g.player.stamina));
    vc.fillStyle = '#8fce6a'; vc.font = 'bold 17px Helvetica, Arial';
    vc.fillText('$' + g.player.cash, 14, 286);
    const w = WEAPONS[g.weapon];
    vc.fillStyle = '#ffd97a'; vc.textAlign = 'right';
    vc.fillText(w.melee ? w.name : w.stream ? Math.round(g.bladder) + '%'
      : w.name + '  ' + g.mag[g.weapon] + '/' + g.ammo[w.ammo], 244, 286);
    if (g.wanted > 0) {
      vc.fillStyle = '#ffb43c'; vc.textAlign = 'center';
      vc.fillText('★'.repeat(g.wanted), 128, 286);
    }
    r.updateTexture(v.tex, v.canvas);

    // --- right wrist --------------------------------------------------
    const t = this.panels.tasks, tc = t.ctx;
    const grad = tc.createLinearGradient(0, 0, 0, 300);
    grad.addColorStop(0, '#f4f0e0'); grad.addColorStop(1, '#ddd6c0');
    tc.fillStyle = grad; tc.fillRect(0, 0, 256, 300);
    tc.fillStyle = '#23211c';
    tc.font = 'bold 26px "Courier New", monospace'; tc.textAlign = 'left';
    const day = g.day >= 0 && g.dayName ? g.dayName : '';
    tc.fillText(g.ui.dayLabel ? g.ui.dayLabel.textContent : 'MONDAY', 14, 36);
    tc.fillStyle = 'rgba(40,36,28,0.5)'; tc.fillRect(14, 46, 228, 3);
    const tasks = (g.currentTasks && g.currentTasks()) || [];
    tc.font = '16px "Courier New", monospace';
    tasks.forEach((task, i) => {
      const y = 76 + i * 46;
      const doneTask = i < g.taskIndex;
      tc.fillStyle = doneTask ? 'rgba(35,33,28,0.4)' : i === g.taskIndex ? '#23211c' : 'rgba(35,33,28,0.7)';
      tc.fillText(doneTask ? '✓' : i === g.taskIndex ? '▶' : '□', 16, y);
      const words = task.label.split(' ');
      let line = '', ly = y;
      for (const word of words) {
        if (tc.measureText(line + word).width > 196) { tc.fillText(line, 40, ly); line = ''; ly += 19; }
        line += word + ' ';
      }
      tc.fillText(line, 40, ly);
      if (doneTask) {
        tc.strokeStyle = 'rgba(35,33,28,0.45)'; tc.lineWidth = 1.5;
        tc.beginPath(); tc.moveTo(38, y - 5); tc.lineTo(236, y - 5); tc.stroke();
      }
    });
    r.updateTexture(t.tex, t.canvas);
  }

  // ------------------------------------------------------------- frame ---
  onFrame(t, frame) {
    if (!this.active) return;
    this.session.requestAnimationFrame(this.onFrame);
    const g = this.g, r = g.r, gl = r.gl;
    let dt = this.lastT ? (t - this.lastT) / 1000 : 0.016;
    this.lastT = t;
    if (dt > 0.1) dt = 0.1;

    const pose = frame.getViewerPose(this.refSpace);
    if (!pose) return;

    // the player object is the stage: everything tracked is relative to it
    mat4.compose(this.playerM, g.player.x, g.player.y, g.player.z, g.player.yaw, 1, 1, 1, 0);
    mat4.multiply(this.camWorld, this.playerM, pose.views[0].transform.matrix);
    const headX = this.camWorld[12], headY = this.camWorld[13], headZ = this.camWorld[14];
    // forward is -Z of the head matrix
    const fx = -this.camWorld[8], fz = -this.camWorld[10];
    g.headYaw = Math.atan2(-fx, -fz);

    this.readInput(frame, dt);

    g.camX = headX; g.camY = headY; g.camZ = headZ;
    g.updatePlayer(dt);
    g.camX = headX; g.camY = headY; g.camZ = headZ;   // the headset owns the camera
    g.updateErrand(dt);
    g.updateWorld(dt);
    g.audio.setListener(g.player.x, g.player.z, g.headYaw);
    this.refreshPanels(dt);

    const layer = this.session.renderState.baseLayer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
    r.clearFrame();
    r.time = t / 1000;

    for (const view of pose.views) {
      const vp = layer.getViewport(view);
      mat4.multiply(this.tmp, this.playerM, view.transform.matrix);
      mat4.invert(this.viewM, this.tmp);
      r.setCamera(view.projectionMatrix, this.viewM, this.tmp[12], this.tmp[13], this.tmp[14], vp);
      g.renderScene();
      this.drawHands(frame);
    }
  }

  // ------------------------------------------------------------- input ---
  readInput(frame, dt) {
    const g = this.g;
    let move = null, sprint = false;
    this.handPoses = { left: null, right: null };

    for (const src of this.session.inputSources) {
      const hand = src.handedness;
      if (src.gripSpace) {
        const p = frame.getPose(src.gripSpace, this.refSpace);
        if (p) {
          const m = mat4.create();
          mat4.multiply(m, this.playerM, p.transform.matrix);
          this.handPoses[hand] = m;
        }
      }
      if (src.hand) this.hands[hand] = src;

      const gp = src.gamepad;
      if (!gp) continue;
      const ax = gp.axes || [];
      // thumbstick is usually axes 2/3; touchpad-only devices use 0/1
      const sx = Math.abs(ax[2] || 0) > 0.001 ? ax[2] : (ax[0] || 0);
      const sy = Math.abs(ax[3] || 0) > 0.001 ? ax[3] : (ax[1] || 0);

      if (hand === 'left') {
        if (Math.hypot(sx, sy) > 0.15) move = { x: sx, y: sy };
        sprint = !!(gp.buttons[1] && gp.buttons[1].pressed);     // squeeze to run
        // X button cycles weapons
        const x = gp.buttons[4] && gp.buttons[4].pressed;
        if (x && !this.xLatch) g.cycleWeapon(1);
        this.xLatch = x;
      } else {
        // snap turn
        if (Math.abs(sx) > 0.7) {
          if (!this.snapLatch) { g.player.yaw -= Math.sign(sx) * (Math.PI / 6); this.snapLatch = true; }
        } else this.snapLatch = false;
        // trigger fires, grip reloads, A does the errand
        const trigger = gp.buttons[0] && gp.buttons[0].pressed;
        g.mouse.down = !!trigger;
        const grip = gp.buttons[1] && gp.buttons[1].pressed;
        if (grip && !this.gripLatch) g.startReload();
        this.gripLatch = grip;
        const a = gp.buttons[4] && gp.buttons[4].pressed;
        if (a) g.keys.add('KeyE'); else g.keys.delete('KeyE');
        const b = gp.buttons[5] && gp.buttons[5].pressed;
        if (b && !this.bLatch) g.doTaunt();
        this.bLatch = b;
      }
    }

    // aim down the right hand, or the head if there is no controller
    const rm = this.handPoses.right;
    if (rm) {
      g.aimOrigin = [rm[12], rm[13], rm[14]];
      const d = [-rm[8], -rm[9], -rm[10]];
      const l = Math.hypot(d[0], d[1], d[2]) || 1;
      g.aimDir = [d[0] / l, d[1] / l, d[2] / l];
    } else { g.aimOrigin = null; g.aimDir = null; }

    // move relative to where you are looking
    if (move) {
      const yaw = g.headYaw;
      const f = [-Math.sin(yaw), -Math.cos(yaw)];
      const r2 = [Math.cos(yaw), -Math.sin(yaw)];
      const mx = f[0] * -move.y + r2[0] * move.x;
      const mz = f[1] * -move.y + r2[1] * move.x;
      // fed through the normal movement code as if it were WASD
      const yawRel = Math.atan2(-mx, -mz) - g.player.yaw;
      const mag = clamp(Math.hypot(move.x, move.y), 0, 1);
      g.vrMove = { x: Math.sin(yawRel) * -mag, z: Math.cos(yawRel) * mag };
    } else g.vrMove = null;
    g.vrSprint = sprint;
  }

  // ------------------------------------------------------------- hands ---
  drawHands(frame) {
    const g = this.g, r = g.r;
    for (const side of ['left', 'right']) {
      const src = this.hands[side];
      if (src && src.hand) {
        if (this.drawTrackedHand(frame, src, side)) {
          if (side === 'right') this.drawWeapon(this.handPoses.right);
          this.drawPanel(side);
          continue;
        }
      }
      const m = this.handPoses[side];
      if (!m) continue;
      this.drawControllerHand(m, side);
      if (side === 'right') this.drawWeapon(m);
      this.drawPanel(side);
    }
  }

  // Real joints from the headset: 25 per hand, each with its own radius.
  drawTrackedHand(frame, src, side) {
    const g = this.g, r = g.r;
    let drew = false;
    for (const chain of FINGERS) {
      let prev = null, prevR = 0;
      for (const name of chain) {
        const space = src.hand.get(name);
        if (!space) continue;
        const jp = frame.getJointPose ? frame.getJointPose(space, this.refSpace) : null;
        if (!jp) continue;
        mat4.multiply(this.tmp2, this.playerM, jp.transform.matrix);
        const x = this.tmp2[12], y = this.tmp2[13], z = this.tmp2[14];
        const rad = Math.max(0.006, jp.radius || 0.008);
        r.box(x, y, z, rad * 2.1, rad * 2.1, rad * 2.1, 0, SKIN);
        drew = true;
        if (prev) {
          // a tapered segment between consecutive joints
          const dx = x - prev[0], dy = y - prev[1], dz = z - prev[2];
          const len = Math.hypot(dx, dy, dz);
          if (len > 0.0005) {
            const midX = (x + prev[0]) / 2, midY = (y + prev[1]) / 2, midZ = (z + prev[2]) / 2;
            const yaw = Math.atan2(dx, dz);
            const pitch = -Math.asin(clamp(dy / len, -1, 1));
            const th = (rad + prevR) * 0.9;
            r.box(midX, midY, midZ, th, th, len, yaw, SKIN_DARK, { rx: pitch });
          }
        }
        prev = [x, y, z]; prevR = rad;
      }
    }
    return drew;
  }

  // No hand tracking: a jointed hand posed from the trigger and grip.
  drawControllerHand(m, side) {
    const g = this.g, r = g.r;
    const src = [...this.session.inputSources].find(s => s.handedness === side);
    const gp = src && src.gamepad;
    const trigger = gp && gp.buttons[0] ? gp.buttons[0].value : 0;
    const grip = gp && gp.buttons[1] ? gp.buttons[1].value : 0;
    const flip = side === 'left' ? -1 : 1;

    const place = (lx, ly, lz, sx, sy, sz, color, rx = 0, ry = 0, rz = 0) => {
      mat4.compose(this.tmp2, lx, ly, lz, ry, sx, sy, sz, rx, rz);
      mat4.multiply(this.tmp, m, this.tmp2);
      r.draw(r.unitCube, r.whiteTex, this.tmp, { color });
    };

    place(0, 0, 0.01, 0.055, 0.085, 0.035, SKIN);                       // palm
    place(0.03 * flip, 0.016, 0.028, 0.022, 0.03, 0.022, SKIN, 0.5, 0, 0.6 * flip);  // thumb base
    place(0.042 * flip, 0.03, 0.044, 0.018, 0.034, 0.018, SKIN, 0.9 - grip * 0.5, 0, 0.8 * flip);
    // four fingers curl with the trigger (index) and grip (the rest)
    for (let i = 0; i < 4; i++) {
      const curl = (i === 0 ? trigger : grip) * 1.5;
      const off = (i - 1.5) * 0.019 * flip;
      place(off, -0.035, 0.044, 0.016, 0.042, 0.016, SKIN, -0.3 + curl);
      place(off, -0.056 - Math.cos(curl) * 0.018, 0.05 + Math.sin(curl) * 0.03,
        0.015, 0.032, 0.015, SKIN_DARK, -0.2 + curl * 1.6);
    }
  }

  drawWeapon(m) {
    const g = this.g, r = g.r;
    if (!m) return;
    const place = (lx, ly, lz, sx, sy, sz, color, rx = 0) => {
      mat4.compose(this.tmp2, lx, ly, lz, 0, sx, sy, sz, rx);
      mat4.multiply(this.tmp, m, this.tmp2);
      r.draw(r.unitCube, r.whiteTex, this.tmp, { color });
    };
    const steel = [0.20, 0.21, 0.24], wood = [0.42, 0.28, 0.16], dark = [0.13, 0.12, 0.13];
    switch (g.weapon) {
      case 'pistol':
        place(0, 0.02, -0.10, 0.045, 0.06, 0.20, steel);
        place(0, -0.05, 0.01, 0.04, 0.10, 0.05, dark, 0.25);
        break;
      case 'shotgun':
        place(0, 0.02, -0.40, 0.045, 0.045, 0.80, steel);
        place(0, 0.01, -0.02, 0.05, 0.08, 0.22, wood);
        place(0, -0.02, 0.26, 0.05, 0.10, 0.26, wood, 0.12);
        break;
      case 'shovel':
        place(0, 0, -0.42, 0.035, 0.035, 0.9, [0.55, 0.40, 0.24]);
        place(0, 0, -0.92, 0.22, 0.26, 0.04, [0.62, 0.64, 0.68]);
        break;
      default:
        break;   // boot and piss are empty-handed
    }
  }

  // The wrist panels: vitals on the left, the list on the right.
  drawPanel(side) {
    const m = this.handPoses[side];
    if (!m) return;
    const r = this.g.r;
    const panel = side === 'left' ? this.panels.vitals : this.panels.tasks;
    if (!panel) return;
    const flip = side === 'left' ? 1 : -1;
    // sit it on the back of the wrist, tilted up towards the face
    mat4.compose(this.tmp2, 0.02 * flip, 0.035, 0.085, 0, 0.115, 0.135, 1, -1.05, 0.25 * flip);
    mat4.multiply(this.tmp, m, this.tmp2);
    r.draw(r.unitQuad, panel.tex, this.tmp, { unlit: true, noFog: true });
  }
}
