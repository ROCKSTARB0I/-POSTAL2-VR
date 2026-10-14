// People, cops, traffic, pickups, gore. Everyone in town is eight boxes and a
// painted face, animated by hand -- no skeletons, no imported models.
import * as T from './textures.js';
import { rngFrom, rand, randI, pick, clamp, smooth, angleDelta, dist2, TAU } from './math.js';

const rng = rngFrom(0xB0075);

const SKINS = ['#e8b48c', '#d79a6e', '#b87b4f', '#8d5a34', '#6b4226', '#f0c6a4'];
const HAIRS = ['#2b1f18', '#4a3123', '#6b4a2a', '#8a6a3a', '#c9a15a', '#1a1a1c', '#8c8c90', '#a83c2c'];
const SHIRTS = ['#c0392b', '#2980b9', '#27ae60', '#8e44ad', '#f1c40f', '#e67e22', '#ecf0f1', '#34495e', '#16a085', '#d35098'];
const PANTS = ['#2c3e50', '#34495e', '#4a4a52', '#5d4037', '#1e2a38', '#6b6b56', '#7f8c8d'];

export const CIV_LINES = [
  'Nice day for it.', 'Get out of my way.', 'Some people, I swear.',
  'You seeing this?', 'I am not paid enough.', 'Excuse me!',
  'Beautiful weather we are having.', 'Where did I park?',
  'They never fix these sidewalks.', 'I told him already.',
  'Do I know you?', 'Lovely. Just lovely.',
];
export const PANIC_LINES = [
  'He has a gun!', 'Run! Run!', 'Somebody call the cops!',
  'Oh god oh god!', 'I am too young for this!', 'Not again!',
  'Everybody out!', 'Help! Help!',
];
export const COP_LINES = [
  'Freeze! Hands where I can see them!', 'This is your last warning!',
  'Suspect is armed!', 'Stop right there!', 'You are under arrest!',
];
export const DISGUST_LINES = [
  'What is wrong with you!', 'That is disgusting!', 'Are you serious right now?',
  'Somebody arrest this man!', 'On my shoes! My shoes!', 'That is a crime!',
];
export const LAUGH_LINES = [
  'Ha! Look at this guy!', 'Your fly is open, genius!',
  'Zip it up, buddy!', 'Oh that is a great look!',
  'Hey everybody, check this out!', 'Ha ha ha! Classy!',
  'Put it away!',
];
export const GROSSED_LINES = [
  'Oh god, no, no, no!', 'It is on me! It is on me!',
  'You animal!', 'I am going to be sick.',
  'What is WRONG with you!', 'That is assault! That is actual assault!',
];
export const GUNPULL_LINES = [
  'That is it. You are done.', 'Wrong guy, buddy!',
  'I have got something for you!', 'You picked the wrong street!',
  'Say it again. Go on.',
];
export const COMEBACK_LINES = [
  'Same to you, pal!', 'Charming. Really charming.',
  'Say that again, tough guy.', 'Screw you too!',
  'Somebody raised you wrong.', 'Real classy.',
];
export const THUG_LINES = [
  'Wrong street, buddy.', 'You lost?', 'Get him!', 'This is our block.',
];

// ---------------------------------------------------------------------------
export class Person {
  constructor(kind, x, z, opts = {}) {
    this.kind = kind;                      // 'civ' | 'cop' | 'thug' | 'clerk'
    this.x = x; this.y = 0; this.z = z;
    this.yaw = rand(rng, 0, TAU);
    this.vx = 0; this.vz = 0;
    this.hp = kind === 'cop' ? 120 : kind === 'thug' ? 80 : 60;
    this.maxHp = this.hp;
    this.state = kind === 'clerk' ? 'clerk' : 'wander';
    this.stateT = 0;
    this.walkPhase = rand(rng, 0, TAU);
    this.speed = kind === 'cop' ? 2.0 : rand(rng, 1.1, 1.8);
    this.dead = false;
    this.fall = 0;
    this.fallSpeed = 0;
    this.fallSide = rng() < 0.5 ? -1 : 1;
    this.target = null;
    this.node = null;
    this.barkCd = rand(rng, 2, 20);
    this.shootCd = rand(rng, 0.4, 1.6);
    this.tough = kind === 'thug' || (kind === 'civ' && rng() < 0.18);
    this.flinch = 0;
    this.hitFlash = 0;
    this.bleed = 0;
    this.soaked = 0;

    const skin = opts.skin || pick(rng, SKINS);
    const hair = opts.hair || pick(rng, HAIRS);
    this.skin = skin; this.hair = hair;
    if (kind === 'cop') {
      this.shirt = '#1f3a6b'; this.pants = '#16233f'; this.cap = '#16233f';
      this.speed = 2.2;
    } else if (kind === 'thug') {
      this.shirt = pick(rng, ['#2b2b30', '#3a2f24', '#402030']); this.pants = '#22242a';
      this.cap = rng() < 0.6 ? '#1c1c20' : null;
    } else if (kind === 'clerk') {
      this.shirt = opts.shirt || '#e6e6e0'; this.pants = '#2f3540'; this.cap = null;
      this.speed = 0;
    } else {
      this.shirt = pick(rng, SHIRTS); this.pants = pick(rng, PANTS);
      this.cap = rng() < 0.22 ? pick(rng, ['#c0392b', '#2980b9', '#1a1a1c']) : null;
    }
    this.face = T.faceTex(skin, hair, {
      bald: rng() < 0.12,
      shades: kind === 'cop' ? true : rng() < 0.12,
      stubble: rng() < 0.3,
      angry: kind === 'thug',
      look: (rng() * 3 - 1.5) | 0,
    });
    this.faceTex = null;                   // uploaded lazily by the renderer
    this.scale = rand(rng, 0.94, 1.07);
    this.armed = kind === 'cop' || kind === 'thug';
  }

  get eyeY() { return 1.62 * this.scale; }

  // Somebody just gestured at you from across the street. Nobody takes it well,
  // and a fair few of them are carrying.
  insulted(fromX, fromZ, g) {
    if (this.dead || this.state === 'fight') return;
    this.threatX = fromX; this.threatZ = fromZ;
    const packing = this.kind === 'thug' || this.kind === 'cop' || this.tough || rng() < 0.28;
    if (packing) {
      this.armed = true;
      this.hasGun = true;
      this.state = 'fight';
      this.stateT = 45;
      this.drawT = 0.75;                      // beat before the gun comes out
      this.shootCd = Math.max(this.shootCd, 0.9);
      if (g) {
        g.audio.bark(pick(rng, GUNPULL_LINES), this, g, 1.15);
        this.barkCd = rand(rng, 5, 9);
      }
    } else if (rng() < 0.55) {
      this.state = 'angry'; this.stateT = 11;
      this.comebackLine = true;
      if (this.barkCd > 0.5) this.barkCd = 0.1;
    } else {
      this.state = 'panic'; this.stateT = rand(rng, 2.5, 5);
      this.comebackLine = true;
      if (this.barkCd > 0.5) this.barkCd = 0.1;
    }
  }

  // You are stood there with your fly open. They have noticed.
  mock(g) {
    if (this.dead || this.state !== 'wander') return;
    this.state = 'mock';
    this.stateT = rand(rng, 2.6, 4.6);
    this.mockCd = 9 + rng() * 10;
    this.laughT = 0;
    if (g) {
      g.audio.laugh(this.x, this.z);
      g.audio.bark(pick(rng, LAUGH_LINES), this, g, 1.1);
      this.barkCd = rand(rng, 6, 12);
    }
  }

  // Being urinated on: not damage, just extremely unwelcome. They gag, back
  // off, and only then decide whether to run or swing.
  disgust(fromX, fromZ, g) {
    if (this.dead) return;
    this.soaked = 5.5;
    this.threatX = fromX; this.threatZ = fromZ;
    if (this.state === 'fight') return;
    if (this.state !== 'grossed') {
      this.state = 'grossed';
      this.stateT = rand(rng, 2.2, 3.4);
      if (g) g.audio.retch(this.x, this.z);
    } else {
      this.stateT = Math.max(this.stateT, 1.6);
    }
    if (this.barkCd > 0.6) this.barkCd = 0.15;
    this.disgustLine = true;
  }

  hurt(dmg, fromX, fromZ, byPlayer, game, cause) {
    if (this.dead) return false;
    if (cause) this.lastCause = cause;
    // Shotgun pellets arrive as separate hits -- sum anything landing in the
    // same instant so a point-blank blast counts as one big one.
    const now = performance.now();
    if (!this.lastHitT || now - this.lastHitT > 220) this.burstDmg = 0;
    this.lastHitT = now;
    this.burstDmg += dmg;
    this.lastDmg = this.burstDmg;
    {
      const ddx = this.x - fromX, ddz = this.z - fromZ;
      const dl = Math.hypot(ddx, ddz) || 1;
      this.hitDX = ddx / dl; this.hitDZ = ddz / dl;
    }
    this.hp -= dmg;
    this.hitFlash = 0.14;
    this.flinch = 0.2;
    this.bleed = 0.6;
    const dx = this.x - fromX, dz = this.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    this.vx += (dx / d) * 2.2; this.vz += (dz / d) * 2.2;
    if (this.hp <= 0) {
      this.die(game, byPlayer);
      if (this.anim && this.anim.type === 'blownBack') {
        // off their feet and backwards, hard
        const kick = rand(rng, 7.5, 11.5);
        this.vx = (dx / d) * kick;
        this.vz = (dz / d) * kick;
        this.vy = rand(rng, 3.4, 5.2);
      }
      return true;
    }
    if (this.kind === 'civ') {
      this.state = this.tough ? 'angry' : 'panic';
      this.stateT = this.tough ? 14 : 12;
      this.threatX = fromX; this.threatZ = fromZ;
      if (game) game.audio.scream(this.x, this.z);
    } else if (this.kind === 'clerk') {
      this.state = 'panic'; this.stateT = 20; this.speed = 3.4;
      this.threatX = fromX; this.threatZ = fromZ;
      if (game) game.audio.scream(this.x, this.z);
    } else {
      this.state = 'fight'; this.stateT = 20;
    }
    return false;
  }

  die(game, byPlayer) {
    this.dead = true;
    this.state = 'dead';
    this.fallSpeed = 3.2 + rng() * 2;
    this.vy = 0;
    this.anim = this.pickDeath();
    // a big enough hit takes them apart instead of knocking them down
    this.gibbed = (this.lastDmg || 0) >= 75 || this.hp <= -40;
    if (game) {
      game.audio.death(this.x, this.z);
      if (this.gibbed) {
        game.audio.gib(this.x, this.z);
        game.spawnGibs(this);
        game.decals.pool(this.x, this.z, 2.6 + rng() * 1.4);
        game.particles.blood(this.x, 1.1, this.z, 30, this.hitDX, 0.3, this.hitDZ);
        game.particles.mist(this.x, 1.2, this.z, 10);
        // spray pattern thrown out behind them
        for (let i = 1; i <= 4; i++) {
          const dd = i * 1.1;
          game.decals.splat(
            this.x + (this.hitDX || 0) * dd + rand(rng, -0.5, 0.5),
            this.z + (this.hitDZ || 0) * dd + rand(rng, -0.5, 0.5),
            1.3 - i * 0.16);
        }
      } else {
        game.decals.pool(this.x, this.z, 1.8 + rng() * 1.1);
        game.particles.blood(this.x, 1.2, this.z, 20, this.hitDX, 0.2, this.hitDZ);
        for (let i = 1; i <= 2; i++) {
          game.decals.splat(this.x + (this.hitDX || 0) * i * 1.2 + rand(rng, -0.6, 0.6),
            this.z + (this.hitDZ || 0) * i * 1.2 + rand(rng, -0.6, 0.6), 1.0);
        }
      }
      if (byPlayer) game.onKill(this);
      game.alarmCrowd(this.x, this.z, 26, this.x, this.z);
    }
  }

  // Which way they go down. Being launched off your feet is strictly a
  // shotgun privilege; everything else is on the table for any weapon.
  pickDeath() {
    const shotgun = this.lastCause === 'shotgun';
    if (shotgun && rng() < 0.62) {
      return { type: 'blownBack', t: 0, spin: rand(rng, 2.6, 4.4), landed: false };
    }
    const r = rng();
    if (r < 0.34) return { type: 'kneel', t: 0, dir: rng() < 0.5 ? 1 : -1, lean: rand(rng, -0.25, 0.25) };
    if (r < 0.68) return { type: 'stumble', t: 0, crawl: rand(rng, 1.6, 3.0), drift: rand(rng, -0.5, 0.5) };
    return { type: 'collapse', t: 0, roll: rand(rng, -0.5, 0.5) };
  }

  updateDeath(dt, g) {
    const a = this.anim || (this.anim = { type: 'collapse', t: 0, roll: 0 });
    a.t += dt;
    const P2 = Math.PI / 2;

    if (a.type === 'blownBack') {
      // launched off their feet, lands on their back, skids
      this.vy -= 23 * dt;
      this.y += this.vy * dt;
      this.x += this.vx * dt; this.z += this.vz * dt;
      if (this.y > 0.01) this.fall = Math.max(-P2, this.fall - a.spin * dt);
      if (this.y <= 0) {
        this.y = 0;
        if (!a.landed) {
          a.landed = true;
          if (g) {
            g.audio.thud(this.x, this.z);
            g.decals.splat(this.x, this.z, 1.1 + rng() * 0.7);
            g.particles.blood(this.x, 0.35, this.z, 7);
            g.particles.dust(this.x, 0.08, this.z, 5);
          }
          this.vy = Math.abs(this.vy) > 3.5 ? -this.vy * 0.22 : 0;   // one small bounce
        } else this.vy = 0;
        this.vx *= Math.max(0, 1 - dt * 4.2);
        this.vz *= Math.max(0, 1 - dt * 4.2);
        this.fall = Math.max(-P2, this.fall - 7 * dt);
      }
      const flail = Math.max(0, 1 - a.t * 1.6);
      a.armA = -2.3 + Math.sin(a.t * 14) * 0.35 * flail;
      a.armB = -2.1 - Math.sin(a.t * 12) * 0.35 * flail;
      a.legA = 0.5 * flail + 0.15;
      a.legB = -0.35 * flail + 0.1;
      return;
    }

    if (a.type === 'kneel') {
      // knees buckle first, body hangs upright for a beat, then topples
      const k = smooth(clamp(a.t / 0.42, 0, 1));
      this.y = -0.46 * k;
      a.legA = -1.65 * k; a.legB = -1.55 * k;
      // hands come up, then drop
      const reach = a.t < 0.55 ? smooth(clamp(a.t / 0.3, 0, 1)) : Math.max(0, 1 - (a.t - 0.55) / 0.4);
      a.armA = 1.15 * reach + 0.08;
      a.armB = 1.0 * reach + 0.08;
      if (a.t < 0.95) {
        this.fall = a.lean * k + Math.sin(a.t * 7) * 0.05 * k;     // a slight sway
      } else {
        const f = smooth(clamp((a.t - 0.95) / 0.55, 0, 1));
        this.fall = a.lean + (P2 - a.lean) * f;
        a.armA = 0.1; a.armB = 0.1;
      }
      this.vx *= 0.9; this.vz *= 0.9;
      return;
    }

    if (a.type === 'stumble') {
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      if (a.t < 0.62) {
        // staggering forward, still on their feet
        const s2 = 1 - a.t / 0.62;
        this.fall = 0.5 * smooth(clamp(a.t / 0.62, 0, 1));
        const sp = 2.6 * s2;
        this.x += fx * sp * dt; this.z += fz * sp * dt;
        this.walkPhase += dt * 13;
        a.legA = Math.sin(this.walkPhase) * 0.9;
        a.legB = -Math.sin(this.walkPhase) * 0.9;
        a.armA = -0.9 - Math.sin(this.walkPhase) * 0.5;
        a.armB = -0.7 + Math.sin(this.walkPhase) * 0.5;
      } else if (a.t < 1.02) {
        // down on their face
        const f = smooth(clamp((a.t - 0.62) / 0.4, 0, 1));
        this.fall = 0.5 + (P2 - 0.5) * f;
        a.armA = -1.2 * f - 0.3; a.armB = -1.1 * f - 0.3;
        a.legA = 0.15; a.legB = -0.1;
        if (!a.thudded && f > 0.8 && g) {
          a.thudded = true;
          g.audio.thud(this.x, this.z);
          g.particles.dust(this.x, 0.08, this.z, 4);
        }
      } else if (a.t < 1.02 + a.crawl) {
        // dragging themselves along, one arm at a time
        this.fall = P2;
        const c = (a.t - 1.02) * 2.4;
        const pull = Math.sin(c);
        const sp = 0.55 * Math.max(0, 1 - (a.t - 1.02) / a.crawl);
        this.x += (fx + a.drift * 0.2) * sp * dt;
        this.z += (fz - a.drift * 0.2) * sp * dt;
        this.yaw += a.drift * 0.25 * dt;
        a.armA = -1.5 - pull * 0.6;
        a.armB = -1.5 + pull * 0.6;
        a.legA = 0.18 + pull * 0.22;
        a.legB = -0.14 - pull * 0.22;
        this.y = Math.abs(pull) * 0.035;
        a.crawlCd = (a.crawlCd || 0) - dt;
        if (a.crawlCd <= 0 && g) {
          a.crawlCd = 0.28;
          g.decals.splat(this.x, this.z, 0.5 + rng() * 0.4);
          if (rng() < 0.5) g.particles.blood(this.x, 0.2, this.z, 1);
        }
      } else {
        this.fall = P2; this.y = 0;
        a.armA = -1.5; a.armB = -1.4;
        a.legA = 0.18; a.legB = -0.14;
      }
      return;
    }

    // plain collapse: straight down where they stood
    if (this.fall < P2) {
      this.fallSpeed += dt * 9;
      this.fall = Math.min(P2, this.fall + this.fallSpeed * dt);
      if (this.fall >= P2 && !a.thudded && g) {
        a.thudded = true;
        g.audio.thud(this.x, this.z);
        g.particles.dust(this.x, 0.08, this.z, 3);
      }
    }
    a.armA = -0.25 + a.roll * 0.4; a.armB = -0.15 - a.roll * 0.4;
    a.legA = 0.12; a.legB = -0.08;
    this.vx *= 0.86; this.vz *= 0.86;
    this.x += this.vx * dt; this.z += this.vz * dt;
  }

  update(dt, g) {
    if (this.dead) {
      this.updateDeath(dt, g);
      // keep bodies out of the walls they slide into
      const pz = { x: this.x, z: this.z };
      if (g && g.city.resolve(pz, 0.5)) {
        this.x = pz.x; this.z = pz.z;
        this.vx *= 0.3; this.vz *= 0.3;
      }
      return;
    }
    this.stateT -= dt;
    this.flinch = Math.max(0, this.flinch - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.bleed = Math.max(0, this.bleed - dt);
    this.soaked = Math.max(0, this.soaked - dt);
    this.barkCd -= dt;
    this.shootCd -= dt;

    const px = g.player.x, pz = g.player.z;
    const dp = Math.sqrt(dist2(this.x, this.z, px, pz));
    let mx = 0, mz = 0, speed = this.speed;

    switch (this.state) {
      case 'wander': {
        if (!this.target || dist2(this.x, this.z, this.target.x, this.target.z) < 2.2) this.pickNode(g);
        if (this.target) { mx = this.target.x - this.x; mz = this.target.z - this.z; }
        if (this.barkCd <= 0) {
          this.barkCd = rand(rng, 14, 40);
          if (dp < 22) g.audio.bark(pick(rng, CIV_LINES), this, g);
        }
        break;
      }
      case 'clerk': {
        this.yaw = this.homeYaw !== undefined ? this.homeYaw : this.yaw;
        if (dp < 18 && g.wanted >= 3) { this.state = 'panic'; this.stateT = 20; this.speed = 3.6; this.threatX = px; this.threatZ = pz; }
        break;
      }
      case 'mock': {
        // stand there pointing and laughing
        speed = 0;
        this.faceTo(px, pz, dt, 8);
        this.laughT += dt;
        this.y = Math.abs(Math.sin(this.laughT * 11)) * 0.07;
        if (dp > 26 || this.stateT <= 0) { this.y = 0; this.state = 'wander'; this.target = null; }
        break;
      }
      case 'grossed': {
        // gagging, hands up, backing away from you
        speed = 1.9;
        mx = this.x - (this.threatX === undefined ? px : this.threatX);
        mz = this.z - (this.threatZ === undefined ? pz : this.threatZ);
        this.faceTo(px, pz, dt, 5);
        if (this.barkCd <= 0) {
          this.barkCd = rand(rng, 2, 4);
          g.audio.bark(pick(rng, GROSSED_LINES), this, g, 1.3);
        }
        if (this.stateT <= 0) {
          if (this.tough) { this.state = 'angry'; this.stateT = 11; }
          else { this.state = 'panic'; this.stateT = rand(rng, 6, 10); }
          this.threatX = px; this.threatZ = pz;
        }
        break;
      }
      case 'panic': {
        speed = this.kind === 'clerk' ? 3.6 : 3.9;
        const tx = this.threatX === undefined ? px : this.threatX;
        const tz = this.threatZ === undefined ? pz : this.threatZ;
        mx = this.x - tx; mz = this.z - tz;
        if (Math.hypot(mx, mz) < 0.3) { mx = Math.cos(this.yaw); mz = Math.sin(this.yaw); }
        if (this.barkCd <= 0) {
          this.barkCd = rand(rng, 3, 7);
          const lines = this.disgustLine ? DISGUST_LINES
            : this.comebackLine ? COMEBACK_LINES : PANIC_LINES;
          this.disgustLine = false; this.comebackLine = false;
          g.audio.bark(pick(rng, lines), this, g, 1.35);
        }
        if (this.stateT <= 0) { this.state = 'wander'; this.target = null; }
        break;
      }
      case 'angry': {
        speed = 3.4;
        if (this.comebackLine && this.barkCd <= 0) {
          this.barkCd = rand(rng, 4, 8); this.comebackLine = false;
          g.audio.bark(pick(rng, COMEBACK_LINES), this, g, 1.1);
        }
        mx = px - this.x; mz = pz - this.z;
        if (dp < 1.9 && this.shootCd <= 0) {
          this.shootCd = 1.1;
          g.player.hurt(6, this.x, this.z, 'fists');
          g.audio.punch(this.x, this.z);
        }
        if (this.stateT <= 0) { this.state = 'panic'; this.stateT = 8; this.threatX = px; this.threatZ = pz; }
        break;
      }
      case 'fight': {
        // cops and thugs: close in, then shoot from range
        const wantD = this.kind === 'cop' ? 9 : 7;
        speed = this.kind === 'cop' ? 3.5 : 3.2;
        if (dp > wantD) { mx = px - this.x; mz = pz - this.z; }
        else if (dp < wantD * 0.6) { mx = this.x - px; mz = this.z - pz; speed = 2.0; }
        else { mx = -(pz - this.z); mz = (px - this.x); speed = 1.4; }   // strafe
        this.faceTo(px, pz, dt, 9);
        if (this.drawT > 0) { this.drawT -= dt; break; }
        if (this.shootCd <= 0 && dp < 26 && g.hasLOS(this.x, this.eyeY, this.z, px, g.player.y + 1.5, pz)) {
          this.shootCd = this.kind === 'cop' ? rand(rng, 0.75, 1.25) : rand(rng, 0.9, 1.6);
          this.shootAt(g);
        }
        if (this.barkCd <= 0) {
          this.barkCd = rand(rng, 5, 12);
          g.audio.bark(pick(rng, this.kind === 'cop' ? COP_LINES : THUG_LINES), this, g, 0.9);
        }
        break;
      }
      case 'patrol': {
        if (!this.target || dist2(this.x, this.z, this.target.x, this.target.z) < 2.5) this.pickNode(g);
        if (this.target) { mx = this.target.x - this.x; mz = this.target.z - this.z; }
        speed = 2.2;
        if (g.wanted > 0 && dp < 60) { this.state = 'fight'; this.stateT = 60; }
        break;
      }
    }

    // cops give up when the heat dies down
    if (this.kind === 'cop' && this.state === 'fight' && g.wanted === 0) {
      this.state = 'patrol'; this.target = null;
    }
    if (this.kind === 'thug' && this.state === 'wander' && dp < 20 &&
      g.hasLOS(this.x, this.eyeY, this.z, px, g.player.y + 1.4, pz)) {
      this.state = 'fight'; this.stateT = 40;
    }

    const ml = Math.hypot(mx, mz);
    if (ml > 0.001 && this.flinch <= 0) {
      mx /= ml; mz /= ml;
      this.vx += mx * speed * dt * 8;
      this.vz += mz * speed * dt * 8;
      if (this.state !== 'fight' && this.state !== 'grossed' && this.state !== 'mock') {
        this.faceTo(this.x + mx, this.z + mz, dt, 7);
      }
    }
    const vl = Math.hypot(this.vx, this.vz);
    if (vl > speed) { this.vx = this.vx / vl * speed; this.vz = this.vz / vl * speed; }
    this.vx *= 0.86; this.vz *= 0.86;

    const before = { x: this.x + this.vx * dt, z: this.z + this.vz * dt };
    const p = { x: before.x, z: before.z };
    if (g.city.resolve(p, 0.42)) {
      // bumped a wall -- pick somewhere else to be
      if (this.state === 'wander' || this.state === 'patrol') this.target = null;
      this.vx *= 0.4; this.vz *= 0.4;
    }
    this.x = p.x; this.z = p.z;
    this.walkPhase += Math.hypot(this.vx, this.vz) * dt * 3.4;

    if (this.bleed > 0) {
      if (rng() < dt * 14) g.particles.blood(this.x, 1.0, this.z, 1);
      this.trailCd = (this.trailCd || 0) - dt;
      if (this.trailCd <= 0) { this.trailCd = 0.3; g.decals.splat(this.x, this.z, 0.35 + rng() * 0.3); }
    }
  }

  faceTo(tx, tz, dt, rate) {
    const want = Math.atan2(tx - this.x, tz - this.z);
    this.yaw += angleDelta(this.yaw, want) * Math.min(1, dt * rate);
  }

  pickNode(g) {
    if (this.node && this.node.links.length && rng() < 0.85) {
      this.node = pick(rng, this.node.links);
    } else {
      this.node = pick(rng, g.city.nav);
    }
    this.target = {
      x: this.node.x + rand(rng, -3.5, 3.5),
      z: this.node.z + rand(rng, -3.5, 3.5),
    };
  }

  shootAt(g) {
    const px = g.player.x, pz = g.player.z;
    const spread = this.kind === 'cop' ? 0.05 : this.kind === 'thug' ? 0.09 : 0.14;
    g.audio.gunshot(this.x, this.z,
      this.kind === 'cop' ? 'pistol' : this.kind === 'thug' ? 'smg' : 'pistol');
    g.particles.muzzle(this.x + Math.sin(this.yaw) * 0.5, 1.45, this.z + Math.cos(this.yaw) * 0.5);
    const d = Math.sqrt(dist2(this.x, this.z, px, pz));
    const diffAcc = (g.diff && g.diff.enemyAcc) || 1;
    const acc = clamp((1 - d / 34) * diffAcc, 0.1, 0.95) - (rng() * spread * 8);
    if (rng() < acc) {
      g.player.hurt(this.kind === 'cop' ? randI(rng, 7, 13)
        : this.kind === 'thug' ? randI(rng, 5, 10) : randI(rng, 4, 8), this.x, this.z, 'bullet');
    } else {
      g.particles.spark(px + rand(rng, -1.2, 1.2), rand(rng, 0.4, 1.9), pz + rand(rng, -1.2, 1.2));
    }
  }

  // ray vs. upright capsule-ish cylinder
  rayHit(ox, oy, oz, dx, dy, dz, maxD) {
    const r = this.dead ? 0.7 : 0.42;
    const topY = this.dead ? 0.55 : 1.86 * this.scale;
    const ex = ox - this.x, ez = oz - this.z;
    const a = dx * dx + dz * dz;
    if (a < 1e-8) return null;
    const b = 2 * (ex * dx + ez * dz);
    const c = ex * ex + ez * ez - r * r;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    if (t < 0.2 || t > maxD) return null;
    const y = oy + dy * t;
    if (y < 0.05 || y > topY) return null;
    return { t, y, head: !this.dead && y > 1.48 * this.scale };
  }
}

// ---------------------------------------------------------------------------
export class Car {
  constructor(x, z, yaw, opts = {}) {
    this.x = x; this.z = z; this.yaw = yaw;
    this.color = opts.color || pick(rng, ['#b83c30', '#2d5f9a', '#d9d5cc', '#2f2f34', '#6f8f5a', '#c9a13a', '#8a4a9a']);
    this.parked = !!opts.parked;
    this.speed = this.parked ? 0 : rand(rng, 7, 11);
    this.axis = opts.axis || 'x';
    this.dir = opts.dir || 1;
    this.len = rand(rng, 4.0, 4.8);
    this.wid = 1.9;
    this.honkCd = rand(rng, 3, 20);
    this.wheelSpin = 0;
  }
  update(dt, g) {
    if (this.parked) return;
    const ahead = 6;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    // brake for whatever is standing in the road
    let blocked = false;
    const tx = this.x + fx * ahead, tz = this.z + fz * ahead;
    if (dist2(tx, tz, g.player.x, g.player.z) < 9) blocked = true;
    // brake for pedestrians too, not just the player
    if (!blocked) {
      for (const p of g.people) {
        if (p.dead) continue;
        if (dist2(p.x, p.z, this.x, this.z) > 100) continue;
        const rx = p.x - this.x, rz = p.z - this.z;
        if (rx * fx + rz * fz < 0) continue;                 // behind us
        const lateral = Math.abs(rx * fz - rz * fx);
        if (lateral < 1.9) { blocked = true; break; }
      }
    }
    this.cur = this.cur === undefined ? this.speed : this.cur;
    this.cur += ((blocked ? 0 : this.speed) - this.cur) * Math.min(1, dt * 2.5);
    this.x += fx * this.cur * dt;
    this.z += fz * this.cur * dt;
    this.wheelSpin += this.cur * dt * 2;
    if (blocked && (this.honkCd -= dt) <= 0) { this.honkCd = rand(rng, 2, 6); g.audio.honk(this.x, this.z); }

    // run over anyone in the way
    for (const p of g.people) {
      if (p.dead) continue;
      if (dist2(p.x, p.z, this.x, this.z) < 3.2 && this.cur > 3) {
        p.hurt(90, this.x, this.z, false, g, 'car');
        g.audio.thud(this.x, this.z);
      }
    }
    if (dist2(g.player.x, g.player.z, this.x, this.z) < 3.0 && this.cur > 4) {
      g.player.hurt(18, this.x, this.z, 'car');
    }

    const b = g.city.bounds;
    if (this.x < b.min - 30 || this.x > b.max + 30 || this.z < b.min - 30 || this.z > b.max + 30) {
      this.x = this.x < b.min ? b.max + 20 : this.x > b.max ? b.min - 20 : this.x;
      this.z = this.z < b.min ? b.max + 20 : this.z > b.max ? b.min - 20 : this.z;
    }
  }
}

// ---------------------------------------------------------------------------
// A piece of somebody. Tumbles, bounces, leaves a trail.
export class Gib {
  constructor(x, y, z, vx, vy, vz, sx, sy, sz, color) {
    this.x = x; this.y = y; this.z = z;
    this.vx = vx; this.vy = vy; this.vz = vz;
    this.sx = sx; this.sy = sy; this.sz = sz;
    this.color = color;
    this.rx = rand(rng, 0, TAU); this.ry = rand(rng, 0, TAU); this.rz = rand(rng, 0, TAU);
    this.spinX = rand(rng, -9, 9); this.spinY = rand(rng, -9, 9); this.spinZ = rand(rng, -9, 9);
    this.life = 26;
    this.rest = false;
    this.dripCd = 0;
  }
  update(dt, g) {
    this.life -= dt;
    if (this.rest) return;
    this.vy -= 19 * dt;
    this.x += this.vx * dt; this.y += this.vy * dt; this.z += this.vz * dt;
    this.rx += this.spinX * dt; this.ry += this.spinY * dt; this.rz += this.spinZ * dt;
    const floor = this.sy * 0.5;
    if (this.y <= floor) {
      this.y = floor;
      if (Math.abs(this.vy) < 1.4 && Math.hypot(this.vx, this.vz) < 1.2) {
        this.rest = true;
        this.vx = this.vz = this.vy = 0;
        this.spinX = this.spinY = this.spinZ = 0;
        this.rx = Math.PI / 2 * (rng() < 0.5 ? 1 : 0);
        g.decals.splat(this.x, this.z, 0.7 + rng() * 0.6);
      } else {
        this.vy *= -0.32;
        this.vx *= 0.62; this.vz *= 0.62;
        this.spinX *= 0.5; this.spinY *= 0.5; this.spinZ *= 0.5;
        g.decals.splat(this.x, this.z, 0.45 + rng() * 0.5);
        g.particles.blood(this.x, this.y + 0.1, this.z, 2);
      }
    }
    // bleeding mid-air
    this.dripCd -= dt;
    if (this.dripCd <= 0 && !this.rest) {
      this.dripCd = 0.05;
      g.particles.blood(this.x, this.y, this.z, 1);
    }
  }
}

export class Pickup {
  constructor(kind, x, z, amount) {
    this.kind = kind; this.x = x; this.z = z; this.amount = amount || 0;
    this.spin = rand(rng, 0, TAU);
    this.bob = rand(rng, 0, TAU);
    this.taken = false;
  }
  update(dt) { this.spin += dt * 1.7; this.bob += dt * 2.4; }
}

// ---------------------------------------------------------------------------
export class Particles {
  constructor(max = 600) {
    this.p = [];
    this.max = max;
  }
  add(x, y, z, vx, vy, vz, life, size, color, kind) {
    if (this.p.length >= this.max) this.p.shift();
    this.p.push({ x, y, z, vx, vy, vz, life, max: life, size, color, kind });
  }
  blood(x, y, z, n, dx, dy, dz) {
    for (let i = 0; i < n; i++) {
      // a directional spray along the shot, plus a wet burst in all directions
      const along = dx !== undefined && i % 2 === 0;
      const sp = along ? rand(rng, 3, 9) : 1;
      this.add(x, y, z,
        (along ? dx * sp : 0) + rand(rng, -2.8, 2.8),
        (along ? dy * sp : 0) + rand(rng, 0.6, 4.6),
        (along ? dz * sp : 0) + rand(rng, -2.8, 2.8),
        rand(rng, 0.6, 1.5), rand(rng, 0.09, 0.26), [0.52, 0.02, 0.03], 'blood');
    }
  }

  // Fine red mist, for when something really comes apart.
  mist(x, y, z, n) {
    for (let i = 0; i < n; i++) {
      this.add(x, y, z, rand(rng, -1.6, 1.6), rand(rng, 0.2, 2.2), rand(rng, -1.6, 1.6),
        rand(rng, 0.5, 1.0), rand(rng, 0.25, 0.6), [0.42, 0.04, 0.05], 'smoke');
    }
  }
  muzzle(x, y, z) {
    this.add(x, y, z, 0, 0, 0, 0.06, 0.6, [1.6, 1.2, 0.5], 'flash');
    for (let i = 0; i < 4; i++)
      this.add(x, y, z, rand(rng, -1, 1), rand(rng, 0.4, 1.6), rand(rng, -1, 1),
        rand(rng, 0.25, 0.5), rand(rng, 0.1, 0.25), [0.6, 0.6, 0.62], 'smoke');
  }
  spark(x, y, z) {
    for (let i = 0; i < 5; i++)
      this.add(x, y, z, rand(rng, -2, 2), rand(rng, 0.5, 3), rand(rng, -2, 2),
        rand(rng, 0.15, 0.35), 0.05, [1.4, 1.1, 0.6], 'spark');
    this.add(x, y, z, 0, 0.4, 0, 0.5, 0.3, [0.55, 0.55, 0.55], 'smoke');
  }
  dust(x, y, z, n = 6) {
    for (let i = 0; i < n; i++)
      this.add(x, y, z, rand(rng, -0.8, 0.8), rand(rng, 0.2, 1.1), rand(rng, -0.8, 0.8),
        rand(rng, 0.4, 0.9), rand(rng, 0.2, 0.5), [0.7, 0.68, 0.62], 'smoke');
  }
  // A proper arc: fast out of the gate, gravity does the rest.
  stream(x, y, z, dx, dy, dz, speed = 7.6) {
    for (let i = 0; i < 3; i++) {
      const jitter = 0.14;
      this.add(x, y, z,
        dx * speed + rand(rng, -jitter, jitter),
        dy * speed + rand(rng, -jitter * 0.6, jitter * 0.6),
        dz * speed + rand(rng, -jitter, jitter),
        2.6, rand(rng, 0.045, 0.085), [0.95, 0.88, 0.32], 'pee');
    }
  }

  // Where it lands, it splashes.
  splash(x, z) {
    for (let i = 0; i < 3; i++) {
      this.add(x, 0.05, z,
        rand(rng, -1.1, 1.1), rand(rng, 0.8, 2.2), rand(rng, -1.1, 1.1),
        rand(rng, 0.18, 0.34), rand(rng, 0.03, 0.055), [0.92, 0.86, 0.38], 'spray');
    }
  }

  casing(x, y, z, yaw) {
    this.add(x, y, z, Math.cos(yaw) * 2.5 + rand(rng, -0.6, 0.6), rand(rng, 1.5, 2.6),
      -Math.sin(yaw) * 2.5 + rand(rng, -0.6, 0.6), 1.2, 0.045, [1.3, 1.0, 0.35], 'casing');
  }
  update(dt) {
    let landed = null;
    for (let i = this.p.length - 1; i >= 0; i--) {
      const q = this.p[i];
      q.life -= dt;
      if (q.life <= 0) { this.p.splice(i, 1); continue; }
      if (q.kind !== 'flash') {
        q.vy -= (q.kind === 'smoke' ? -1.2 : 12) * dt;
        q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
        if (q.y < 0.03) {
          if (q.kind === 'pee') {
            (landed || (landed = [])).push(q.x, q.z);
            this.p.splice(i, 1);
            continue;
          }
          q.y = 0.03; q.vy *= -0.28; q.vx *= 0.6; q.vz *= 0.6;
        }
        if (q.kind === 'smoke') { q.vx *= 0.94; q.vz *= 0.94; q.size += dt * 0.5; }
      }
    }
    // splash after the sweep, so we aren't mutating the array mid-walk
    if (landed) for (let i = 0; i < landed.length; i += 2) this.splash(landed[i], landed[i + 1]);
  }
}

// ---------------------------------------------------------------------------
export class Decals {
  constructor(max = 90) { this.d = []; this.max = max; }
  splat(x, z, size) { this.push(x, z, size, 'blood'); }
  wet(x, z, size) { this.push(x, z, size, 'wet'); }
  pool(x, z, maxSize) {
    const d = this.push(x, z, 0.4, 'blood');
    d.grow = maxSize;
    return d;
  }
  push(x, z, size, kind) {
    if (this.d.length >= this.max) this.d.shift();
    const d = { x, z, size, kind, rot: rand(rng, 0, TAU), age: 0 };
    this.d.push(d);
    return d;
  }
  update(dt) {
    for (const d of this.d) {
      d.age += dt;
      if (d.grow && d.size < d.grow) d.size = Math.min(d.grow, d.size + dt * 0.38);
    }
  }
}

export function makeCivilian(x, z) { return new Person('civ', x, z); }
export function makeCop(x, z) { const c = new Person('cop', x, z); c.state = 'patrol'; return c; }
export function makeThug(x, z) { return new Person('thug', x, z); }
