// Weapon stats and the first-person view model, built from boxes each frame.
import { mat4 } from './math.js';

export const WEAPONS = {
  boot: { name: 'BOOT', key: 'boot', slot: 1, melee: true, dmg: 40, rate: 0.44, range: 2.4, arc: 0.75, heat: 0.7 },
  shovel: { name: 'SHOVEL', key: 'shovel', slot: 2, melee: true, dmg: 95, rate: 0.62, range: 2.8, arc: 0.85, heat: 0.9 },
  pistol: { name: 'PISTOL', key: 'pistol', slot: 3, dmg: 30, rate: 0.17, spread: 0.011, mag: 12, ammo: '9mm', reload: 1.3, sound: 'pistol', heat: 1.0, kick: 0.028 },
  shotgun: { name: 'SHOTGUN', key: 'shotgun', slot: 4, dmg: 17, pellets: 9, rate: 0.82, spread: 0.055, mag: 6, ammo: 'shells', reload: 2.0, sound: 'shotgun', heat: 1.4, kick: 0.075 },
  // Held, not fired. Empties the bladder meter instead of a magazine.
  relief: { name: 'PISS', key: 'relief', slot: 5, stream: true, rate: 0, heat: 0.22 },
};
export const WEAPON_ORDER = ['boot', 'shovel', 'pistol', 'shotgun', 'relief'];

const tmp = mat4.create(), out = mat4.create(), base = mat4.create();

function part(r, lx, ly, lz, sx, sy, sz, color, rx = 0, ry = 0, rz = 0) {
  mat4.compose(tmp, lx, ly, lz, ry, sx, sy, sz, rx, rz);
  mat4.multiply(out, base, tmp);
  r.draw(r.unitCube, r.whiteTex, out, { color, noFog: true });
}

// The universal gesture. Rises into frame, holds, drops -- drawn over
// whatever else is in your hands.
function drawTaunt(r, g, skin, sleeve) {
  const t = 1 - g.taunt.t / g.taunt.max;          // 0 -> 1 over the animation
  const rise = Math.min(1, Math.sin(Math.min(t, 0.999) * Math.PI) * 2.4);
  const x = -0.13, y = -0.34 + rise * 0.30, z = -0.46;
  const tilt = -0.40 + rise * 0.34;
  const S = 1;
  // forearm, fist, folded knuckles, thumb, and the one that matters
  part(r, x - 0.03, y - 0.19, z + 0.12, 0.085 * S, 0.20 * S, 0.09 * S, sleeve, tilt);
  part(r, x, y, z, 0.082 * S, 0.095 * S, 0.062 * S, skin, tilt);
  part(r, x - 0.026, y + 0.055, z + 0.004, 0.028 * S, 0.036 * S, 0.05 * S, skin, tilt);
  part(r, x + 0.026, y + 0.055, z + 0.004, 0.028 * S, 0.036 * S, 0.05 * S, skin, tilt);
  part(r, x + 0.001, y + 0.108, z - 0.004, 0.03 * S, 0.105 * S, 0.032 * S, skin, tilt);
  part(r, x - 0.052, y + 0.018, z + 0.012, 0.028 * S, 0.055 * S, 0.032 * S, skin, tilt + 0.4, 0, -0.7);
}

// vm: { bob, recoil, swing, lower, sprint }
export function drawViewModel(r, g) {
  const p = g.player;
  const vm = g.vm;
  mat4.compose(base, g.camX, g.camY, g.camZ, p.yaw, 1, 1, 1, p.pitch);

  const bobX = Math.sin(vm.bob) * 0.017 * vm.moveAmt;
  const bobY = Math.abs(Math.cos(vm.bob)) * 0.014 * vm.moveAmt;
  const kick = vm.recoil;
  const sway = vm.swayX, swayY = vm.swayY;
  const lower = vm.lower * 0.35 + vm.sprint * 0.22;

  const HX = 0.26 + bobX + sway, HY = -0.25 + bobY - lower + swayY, HZ = -0.55 + kick * 0.5;
  const w = g.weapon;
  const skin = [0.86, 0.66, 0.50];
  const sleeve = [0.30, 0.34, 0.42];

  if (g.taunt.t > 0) drawTaunt(r, g, skin, sleeve);

  if (w === 'boot') {
    // swings a boot up into frame
    const s = vm.swing;
    if (s > 0) {
      const t = 1 - s;
      const up = Math.sin(t * Math.PI) * 0.9;
      part(r, 0.06, -0.85 + up * 0.75, -0.55 - up * 0.5, 0.20, 0.14, 0.42,
        [0.16, 0.13, 0.12], -0.5 + up * 1.1);
      part(r, 0.06, -0.95 + up * 0.72, -0.42 - up * 0.42, 0.17, 0.28, 0.16,
        [0.22, 0.20, 0.26], -0.3 + up * 0.9);
    }
    // idle: an open hand at the edge of frame
    part(r, HX + 0.06, HY - 0.06, HZ + 0.1, 0.10, 0.13, 0.20, skin, 0.2, -0.3);
    return;
  }

  if (w === 'relief') {
    // Hands at the waist, nothing else -- the stream itself is particles.
    const go = g.streaming ? 1 : 0;
    const j = go ? Math.sin(vm.bob * 3) * 0.006 : 0;
    part(r, 0.10 + j, -0.46 + bobY * 0.5 - lower, -0.34, 0.11, 0.12, 0.16, skin, 0.55, -0.35);
    part(r, -0.10 - j, -0.46 + bobY * 0.5 - lower, -0.34, 0.11, 0.12, 0.16, skin, 0.55, 0.35);
    part(r, 0.15, -0.56 + bobY * 0.5 - lower, -0.26, 0.14, 0.14, 0.19, sleeve, 0.45, -0.3);
    part(r, -0.15, -0.56 + bobY * 0.5 - lower, -0.26, 0.14, 0.14, 0.19, sleeve, 0.45, 0.3);
    return;
  }

  if (w === 'shovel') {
    const s = vm.swing;
    const sw = s > 0 ? Math.sin((1 - s) * Math.PI) : 0;
    const rot = -0.55 + sw * 1.9;
    const roll = 0.35 - sw * 0.8;
    const hx = HX - 0.02 + sw * -0.18, hy = HY + sw * 0.16, hz = HZ - sw * 0.22;
    // shaft
    part(r, hx, hy + 0.10, hz - 0.30, 0.045, 0.045, 1.05, [0.55, 0.40, 0.24], rot, 0, roll);
    // blade
    const bx = hx - Math.sin(roll) * 0.5, by = hy + 0.10 + Math.sin(rot) * 0.52 + 0.34, bz = hz - 0.30 - Math.cos(rot) * 0.52;
    part(r, bx, by - 0.62, bz - 0.18, 0.26, 0.30, 0.05, [0.62, 0.64, 0.68], rot + 0.15, 0, roll);
    // hands
    part(r, hx + 0.02, hy + 0.02, hz - 0.06, 0.10, 0.11, 0.14, skin, rot, 0, roll);
    part(r, hx - 0.02, hy + 0.16, hz - 0.42, 0.10, 0.11, 0.14, skin, rot, 0, roll);
    part(r, hx + 0.04, hy - 0.06, hz + 0.06, 0.13, 0.13, 0.17, sleeve, rot, 0, roll);
    return;
  }

  if (w === 'pistol') {
    const rz = vm.reloadT > 0 ? Math.sin(vm.reloadT * Math.PI) * 0.9 : 0;
    const dy = vm.reloadT > 0 ? -Math.sin(vm.reloadT * Math.PI) * 0.18 : 0;
    const gx = HX, gy = HY + dy, gz = HZ;
    part(r, gx, gy + 0.035, gz - 0.10, 0.055, 0.075, 0.30, [0.20, 0.21, 0.24], -kick * 2 + rz * 0.3);   // slide
    part(r, gx, gy + 0.005, gz - 0.24, 0.036, 0.036, 0.10, [0.16, 0.17, 0.19], -kick * 2 + rz * 0.3);   // barrel
    part(r, gx, gy - 0.11, gz + 0.02, 0.052, 0.16, 0.07, [0.13, 0.12, 0.13], 0.35 + rz * 0.3);          // grip
    part(r, gx, gy - 0.045, gz - 0.02, 0.035, 0.05, 0.05, [0.18, 0.18, 0.2], 0);                         // trigger guard
    part(r, gx + 0.005, gy - 0.09, gz + 0.03, 0.10, 0.12, 0.13, skin, 0.3);                              // hand
    part(r, gx + 0.02, gy - 0.16, gz + 0.14, 0.12, 0.13, 0.18, sleeve, 0.2);                             // sleeve
    if (vm.reloadT > 0) part(r, gx - 0.02, gy - 0.30 + rz * 0.16, gz + 0.06, 0.036, 0.10, 0.05, [0.55, 0.45, 0.20]);
    return;
  }

  // shotgun
  const pump = vm.pumpT > 0 ? Math.sin(vm.pumpT * Math.PI) : 0;
  const gx = HX - 0.04, gy = HY - 0.02, gz = HZ;
  part(r, gx, gy + 0.05, gz - 0.42, 0.05, 0.05, 0.92, [0.22, 0.23, 0.26], -kick * 1.4);         // barrel
  part(r, gx, gy - 0.005, gz - 0.40, 0.045, 0.045, 0.80, [0.18, 0.19, 0.21], -kick * 1.4);      // mag tube
  part(r, gx, gy + 0.01, gz - 0.30 + pump * 0.14, 0.075, 0.075, 0.20, [0.36, 0.24, 0.14], -kick * 1.4); // pump
  part(r, gx, gy + 0.02, gz + 0.06, 0.06, 0.10, 0.26, [0.40, 0.27, 0.16], -kick * 1.4);          // receiver
  part(r, gx, gy - 0.06, gz + 0.30, 0.055, 0.13, 0.30, [0.38, 0.25, 0.15], 0.18 - kick);         // stock
  part(r, gx + 0.01, gy - 0.06, gz - 0.28 + pump * 0.14, 0.10, 0.11, 0.14, skin, 0.2);           // fore hand
  part(r, gx + 0.02, gy - 0.10, gz + 0.14, 0.10, 0.11, 0.14, skin, 0.25);                        // trigger hand
  part(r, gx + 0.03, gy - 0.17, gz + 0.26, 0.12, 0.13, 0.18, sleeve, 0.2);
}
