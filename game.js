// POSTAL 2 -- main loop. Player, combat, heat, the errand list, and drawing
// everything that moves.
import { Renderer } from './gfx.js';
import { buildCity, PITCH, GRIDN, TOWN, ROAD, roadAt } from './city.js';
import * as T from './textures.js';
import { Person, Car, Pickup, Gib, Particles, Decals, makeCivilian, makeCop, makeThug } from './entities.js';
import { WEAPONS, WEAPON_ORDER, drawViewModel } from './weapons.js';
import { DAYS, INTRO_LINES, DUDE_IDLE } from './errands.js';
import { DUDE, pickLine } from './barks.js';
import { Audio } from './audio.js';
import { Menu } from './menu.js';
import { VR } from './vr.js';
import { loadSettings, saveSettings, difficultyById, loadSave, writeSave } from './settings.js';
import { mat4, clamp, lerp, rngFrom, rand, randI, pick, dist2, TAU, angleDelta } from './math.js';

const EYE = 1.68, CROUCH_EYE = 1.12;
const rng = rngFrom(0xDEADBE);

export class Game {
  constructor(canvas, ui) {
    this.canvas = canvas;
    this.ui = ui;
    this.r = new Renderer(canvas);
    this.audio = new Audio();
    this.paused = true;
    this.started = false;
    this.over = null;
    this.settings = loadSettings();
    this.diff = difficultyById(this.settings.difficulty);

    this.city = buildCity(this.r);
    this.particles = new Particles(700);
    this.decals = new Decals(110);
    this.people = [];
    this.gibs = [];
    this.cars = [];
    this.pickups = [];
    this.corpseTimer = 0;

    this.day = 0;
    this.taskIndex = 0;
    this.taskProgress = 0;
    this.wanted = 0;
    this.heat = 0;
    this.crimeCd = 0;
    this.copSpawnCd = 4;
    this.notices = [];
    this.subtitle = { text: '', t: 0 };
    this.clock = 8 * 60;             // minutes since midnight, 8:00 AM
    this.kills = 0;
    this.civKills = 0;

    const home = this.city.shopByKey('home');
    this.player = {
      x: home.street.x, y: 0, z: home.street.z,
      vx: 0, vy: 0, vz: 0,
      yaw: Math.atan2(home.door.x - home.entry.x, home.door.z - home.entry.z),
      pitch: 0, hp: 100, armor: 0, cash: 60,
      onGround: true, crouch: false, stepPhase: 0,
      stamina: 100, winded: false,
      hurt: (dmg, fx, fz, cause) => this.playerHurt(dmg, fx, fz, cause),
    };
    this.weapon = 'boot';
    this.owned = { boot: true, shovel: false, pistol: false, shotgun: false, relief: true };
    this.bladder = 100;          // fills back up on its own; a drink tops it off
    this.streaming = false;
    this.taunt = { t: 0, max: 1.15 };
    this.mag = { pistol: 0, shotgun: 0 };
    this.ammo = { '9mm': 0, shells: 0 };
    this.fireCd = 0;
    this.vm = { bob: 0, moveAmt: 0, recoil: 0, swing: 0, lower: 0, sprint: 0, swayX: 0, swayY: 0, reloadT: 0, pumpT: 0 };
    this.reloading = 0;
    this.hurtFlash = 0;
    this.killFlash = 0;
    this.goreScreen = 0;
    this.shake = 0;
    this.camX = 0; this.camY = EYE; this.camZ = 0;

    this.keys = new Set();
    this.mouse = { down: false, right: false };
    this.bindInput();
    this.populate();
    this.buildHUD();
    this.menu = new Menu(this);
    this.vr = new VR(this);
    this.applySettings();
    this.camYaw = 0; this.camPitch = 0;
    this.menu.open('main');
    this.lastT = performance.now();
    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------- setup ---
  populate() {
    const nav = this.city.nav;
    for (let i = 0; i < 46; i++) {
      const n = pick(rng, nav);
      const p = makeCivilian(n.x + rand(rng, -5, 5), n.z + rand(rng, -5, 5));
      p.node = n;
      this.people.push(p);
    }
    // shopkeepers behind every counter
    for (const shop of this.city.shops) {
      if (shop.key === 'home') continue;
      const c = new Person('clerk', shop.spot.x + (shop.dir === 0 ? 0 : 0), shop.spot.z, {});
      const b = shop;
      // stand behind the counter, facing the customer
      const nx = [0, 1, 0, -1][shop.dir], nz = [-1, 0, 1, 0][shop.dir];
      c.x = shop.spot.x - nx * 2.4; c.z = shop.spot.z - nz * 2.4;
      c.yaw = Math.atan2(nx, nz);
      c.homeYaw = c.yaw;
      c.shopKey = shop.key;
      this.people.push(c);
    }
    // a few thugs loitering in the alleys
    for (let i = 0; i < 7; i++) {
      const n = pick(rng, nav);
      this.people.push(makeThug(n.x + rand(rng, -6, 6), n.z + rand(rng, -6, 6)));
    }
    // beat cops
    const police = this.city.shopByKey('police');
    for (let i = 0; i < 4; i++) {
      this.people.push(makeCop(police.entry.x + rand(rng, -8, 8), police.entry.z + rand(rng, -8, 8)));
    }
    // parked cars
    for (const s of this.city.carSpots) {
      this.cars.push(new Car(s.x, s.z, s.yaw, { parked: true }));
      this.city.colliders.push({ x0: s.x - 1.2, x1: s.x + 1.2, z0: s.z - 2.4, z1: s.z + 2.4, top: 1.4 });
    }
    // traffic
    for (let i = 0; i < 10; i++) {
      const along = i % 2 === 0;
      const lane = randI(rng, 0, GRIDN);
      const dir = rng() < 0.5 ? 1 : -1;
      if (along) {
        this.cars.push(new Car(rand(rng, 0, TOWN), roadAt(lane) + dir * 3, dir > 0 ? Math.PI / 2 : -Math.PI / 2, { axis: 'x', dir }));
      } else {
        this.cars.push(new Car(roadAt(lane) - dir * 3, rand(rng, 0, TOWN), dir > 0 ? 0 : Math.PI, { axis: 'z', dir }));
      }
    }
    // a shotgun behind the hardware store, a pistol in an alley -- enough to
    // arm yourself before Thursday if you go looking
    const hw = this.city.shopByKey('hardware');
    this.pickups.push(new Pickup('shotgun', hw.x1 + 2.5, hw.z1 + 2.5, 0));
    const bar = this.city.shopByKey('bar');
    this.pickups.push(new Pickup('pistol', bar.x0 - 2.5, bar.z0 - 2.5, 0));

    // loose supplies
    for (let i = 0; i < 16; i++) {
      const n = pick(rng, nav);
      const kind = pick(rng, ['cash', 'cash', 'health', 'armor', 'ammo9', 'shells']);
      this.pickups.push(new Pickup(kind, n.x + rand(rng, -6, 6), n.z + rand(rng, -6, 6),
        kind === 'cash' ? randI(rng, 15, 60) : 0));
    }
  }

  // ------------------------------------------------------------- input ---
  bindInput() {
    const c = this.canvas;
    addEventListener('keydown', e => {
      if (e.repeat) { return; }
      if (this.menu && this.menu.isOpen) { this.menu.key(e); return; }
      this.keys.add(e.code);
      if (e.code === 'Escape') { this.pauseToMenu(); return; }
      if (!this.started || this.paused) return;
      if (e.code === 'KeyR') this.startReload();
      if (e.code === 'KeyF') this.doTaunt();
      if (e.code === 'KeyM') this.ui.map.classList.toggle('big');
      if (e.code === 'KeyV') {
        this.settings.voices = !this.settings.voices;
        saveSettings(this.settings);
        this.applySettings();
        this.notify(this.settings.voices ? 'VOICES ON' : 'VOICES OFF');
      }
      if (/^Digit[1-5]$/.test(e.code)) this.selectWeapon(WEAPON_ORDER[+e.code.slice(5) - 1]);
      if (e.code === 'KeyQ') this.cycleWeapon(-1);
      if (e.code === 'Tab') { e.preventDefault(); this.ui.map.classList.toggle('big'); }
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('wheel', e => { if (!this.paused) this.cycleWeapon(e.deltaY > 0 ? 1 : -1); }, { passive: true });

    c.addEventListener('mousedown', e => {
      if (this.menu && this.menu.isOpen) return;
      if (this.paused) { return; }
      // Some embedded browsers refuse pointer lock outright; free-look covers it.
      if (document.pointerLockElement !== c && c.requestPointerLock) {
        try { const rq = c.requestPointerLock(); if (rq && rq.catch) rq.catch(() => { }); } catch (err) { }
      }
      if (e.button === 0) this.mouse.down = true;
      if (e.button === 2) this.mouse.right = true;
    });
    addEventListener('mouseup', e => {
      if (e.button === 0) this.mouse.down = false;
      if (e.button === 2) this.mouse.right = false;
    });
    c.addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('mousemove', e => {
      // Pointer lock is preferred, but plenty of embedded browsers refuse it --
      // fall back to raw mouse deltas so looking around always works.
      if (this.paused || !this.started || (this.menu && this.menu.isOpen)) return;
      const s = 0.0022 * (this.settings.sensitivity || 1);
      const inv = this.settings.invertY ? -1 : 1;
      this.player.yaw -= e.movementX * s;
      this.player.pitch = clamp(this.player.pitch - e.movementY * s * inv, -1.45, 1.45);
      this.vm.swayX = clamp(this.vm.swayX - e.movementX * 0.0006, -0.06, 0.06);
      this.vm.swayY = clamp(this.vm.swayY + e.movementY * 0.0005, -0.05, 0.05);
    });
    // Losing pointer lock never pauses the game -- some embedded browsers hand
    // it back the moment anything else takes focus. ESC is the only pause.
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === c;
      if (this.ui.lockHint) this.ui.lockHint.style.opacity = (this.locked || this.paused) ? 0 : 0.55;
    });
  }

  requestPlay() {
    this.audio.ensure(); this.audio.resume();
    this.freeLook = true;
    try {
      const req = this.canvas.requestPointerLock && this.canvas.requestPointerLock();
      if (req && req.catch) req.catch(() => { this.freeLook = true; });
    } catch (err) { this.freeLook = true; }
    setTimeout(() => { this.hadLock = document.pointerLockElement === this.canvas; }, 250);
    this.setPaused(false);
    if (!this.started) {
      this.started = true;
      this.startDay(0);
    }
  }

  setPaused(p) {
    this.paused = p;
    this.ui.overlay.classList.toggle('hidden', !p);
    if (p) {
      this.audio.siren(false);
      if (document.pointerLockElement) document.exitPointerLock();
      this.ui.overlayTitle.textContent = this.over ? this.over.title : (this.started ? 'PAUSED' : 'POSTAL 2');
      this.ui.overlayBody.innerHTML = this.over ? this.over.body : (this.started ? PAUSE_HTML : INTRO_HTML);
      this.ui.overlayHint.textContent = this.over ? 'CLICK TO PLAY AGAIN' : 'CLICK TO PLAY';
    }
  }

  applySettings() {
    const s = this.settings;
    this.diff = difficultyById(s.difficulty);
    this.audio.voice = s.voices;
    if (!s.voices) this.audio.shutUp();
    this.audio.setVolume(s.volume);
    this.goreLevel = s.gore;
  }

  // ------------------------------------------------------ menu plumbing ---
  startNewWeek(opts = {}) {
    this.over = null;
    this.deaths = 0;
    this.kills = 0; this.civKills = 0;
    this.player.hp = 100; this.player.armor = 0;
    this.player.cash = this.diff.startCash;
    this.owned = { boot: true, shovel: false, pistol: false, shotgun: false, relief: true };
    this.mag = { pistol: 0, shotgun: 0 };
    this.ammo = { '9mm': 0, shells: 0 };
    this.weapon = 'boot';
    this.bladder = 100;
    this.gibs.length = 0;
    this.decals.d.length = 0;
    this.people = this.people.filter(p => !p.dead);
    this.menu.close();
    this.started = true;
    this.paused = false;
    this.startDay(0);
    if (opts.vr) {
      // the headset drives its own loop; if it refuses, fall back to the menu
      this.vr.enter().then(ok => { if (!ok) { this.paused = true; this.menu.open('main'); } });
    } else {
      this.grabPointer();
    }
  }

  continueSaved(save) {
    this.settings.difficulty = save.difficulty || this.settings.difficulty;
    saveSettings(this.settings);
    this.applySettings();
    this.over = null;
    this.deaths = save.deaths || 0;
    this.kills = save.kills || 0;
    this.civKills = save.civKills || 0;
    this.owned = { ...this.owned, ...(save.owned || {}) };
    this.mag = { ...this.mag, ...(save.mag || {}) };
    this.ammo = { ...this.ammo, ...(save.ammo || {}) };
    this.menu.close();
    this.started = true;
    this.paused = false;
    this.startDay(save.day || 0);
    this.player.cash = save.cash === undefined ? this.diff.startCash : save.cash;
    this.taskIndex = Math.min(save.taskIndex || 0, DAYS[this.day].tasks.length - 1);
    this.updateTaskUI();
    this.grabPointer();
  }

  saveProgress() {
    writeSave({
      day: this.day, taskIndex: this.taskIndex, cash: this.player.cash,
      owned: this.owned, mag: this.mag, ammo: this.ammo,
      kills: this.kills, civKills: this.civKills, deaths: this.deaths,
      difficulty: this.settings.difficulty,
    });
  }

  pauseToMenu() {
    if (!this.started || this.over) return;
    this.paused = true;
    this.audio.siren(false);
    this.audio.stream(false);
    if (document.pointerLockElement) document.exitPointerLock();
    this.menu.open('pause');
  }

  resumeFromPause() {
    this.menu.close();
    this.paused = false;
    this.grabPointer();
  }

  toMainMenu() {
    this.paused = true;
    this.started = false;
    this.over = null;
    this.audio.siren(false);
    if (document.pointerLockElement) document.exitPointerLock();
    this.menu.open('main');
  }

  grabPointer() {
    this.audio.ensure(); this.audio.resume();
    try {
      const rq = this.canvas.requestPointerLock && this.canvas.requestPointerLock();
      if (rq && rq.catch) rq.catch(() => { });
    } catch (e) { }
  }

  selectWeapon(w) {
    if (!w || !this.owned[w] || this.weapon === w) return;
    this.weapon = w;
    this.vm.lower = 1;
    this.reloading = 0;
    this.notify(WEAPONS[w].name);
  }

  cycleWeapon(dir) {
    const have = WEAPON_ORDER.filter(w => this.owned[w]);
    const i = have.indexOf(this.weapon);
    this.selectWeapon(have[(i + dir + have.length) % have.length]);
  }

  // -------------------------------------------------------------- days ---
  // Nudge a spawn point out of whatever prop it landed inside.
  clearSpot(x, z) {
    const p = { x, z };
    for (let i = 0; i < 24; i++) {
      if (!this.city.resolve(p, 0.45)) return p;
      const a = (i / 24) * TAU;
      p.x = x + Math.cos(a) * (1.2 + i * 0.25);
      p.z = z + Math.sin(a) * (1.2 + i * 0.25);
    }
    return p;
  }

  startDay(i) {
    this.day = i;
    this.taskIndex = 0;
    this.taskProgress = 0;
    this.clock = 8 * 60;
    this.wanted = 0; this.heat = 0;
    this.player.hp = 100;
    const home = this.city.shopByKey('home');
    const spot = this.clearSpot(home.street.x, home.street.z);
    this.player.x = spot.x; this.player.z = spot.z;
    this.player.yaw = Math.atan2(home.door.x - this.player.x, home.door.z - this.player.z);
    // clear yesterday's mess
    this.people = this.people.filter(p => !p.dead);
    this.decals.d.length = 0;
    this.gibs.length = 0;
    this.goreScreen = 0;
    this.saveProgress();
    this.dayCard(DAYS[i].name, DAYS[i].tag);
    setTimeout(() => this.say(INTRO_LINES[i]), 900);
    this.updateTaskUI();
  }

  get task() { return DAYS[this.day].tasks[this.taskIndex]; }
  currentTasks() { return DAYS[this.day] ? DAYS[this.day].tasks : []; }
  get taskShop() { return this.task ? this.city.shopByKey(this.task.shop) : null; }

  completeTask() {
    const t = this.task;
    if (t.cost) this.player.cash -= t.cost;
    if (t.cash) this.player.cash += t.cash;
    if (t.heal) this.player.hp = Math.min(100, this.player.hp + t.heal);
    if (t.shop === 'bar') { this.bladder = 100; this.notify('BLADDER: FULL'); }
    if (t.give) {
      this.owned[t.give] = true;
      if (t.give === 'pistol') { this.mag.pistol = 12; this.ammo['9mm'] += 36; }
      if (t.give === 'shotgun') { this.mag.shotgun = 6; this.ammo.shells += 24; }
      this.selectWeapon(t.give);
      this.notify('ACQUIRED: ' + WEAPONS[t.give].name);
    }
    this.audio.errandDone();
    if (t.done) this.say(t.done, false, 2);
    else this.dudeSay('errandNext');
    this.taskProgress = 0;
    if (t.kind === 'end') { this.endDay(); return; }
    this.taskIndex++;
    this.saveProgress();
    this.updateTaskUI();
  }

  endDay() {
    const last = this.day >= DAYS.length - 1;
    this.dudeSay('dayEnd');
    this.audio.dayDone();
    this.ui.fade.classList.add('on');
    setTimeout(() => {
      if (last) {
        this.finish(true);
        this.ui.fade.classList.remove('on');
      } else {
        this.startDay(this.day + 1);
        this.ui.fade.classList.remove('on');
      }
    }, 1400);
  }

  finish(win) {
    this.over = win ? {
      title: 'WEEK COMPLETE',
      body: `<p>Five days. Every errand crossed off.</p>
        <div class="stats"><div><b>${this.kills}</b><span>PEOPLE KILLED</span></div>
        <div><b>$${this.player.cash}</b><span>LEFT OVER</span></div>
        <div><b>${this.civKills}</b><span>OF THEM CIVILIANS</span></div></div>
        <p class="dim">${this.civKills === 0 ? 'Nobody had to die. Nobody did.' : 'The list did not say how.'}</p>`,
    } : {
      title: 'YOU DIED',
      body: `<p>The errands remain. Somebody else can run them.</p>
        <div class="stats"><div><b>${DAYS[this.day].name}</b><span>MADE IT TO</span></div>
        <div><b>${this.kills}</b><span>PEOPLE KILLED</span></div></div>`,
    };
    this.paused = true;
    if (document.pointerLockElement) document.exitPointerLock();
    this.menu.open('over');
  }

  // ------------------------------------------------------------ combat ---
  fire() {
    const w = WEAPONS[this.weapon];
    if (this.fireCd > 0 || this.reloading > 0) return;
    if (w.melee) {
      this.fireCd = w.rate;
      this.vm.swing = 1;
      this.audio.swing(this.player.x, this.player.z);
      setTimeout(() => this.meleeHit(w), 130);
      return;
    }
    if (this.mag[this.weapon] <= 0) {
      this.audio.dryFire(this.player.x, this.player.z);
      this.dudeSay('empty');
      this.fireCd = 0.35;
      this.startReload();
      return;
    }
    this.fireCd = w.rate;
    this.mag[this.weapon]--;
    this.vm.recoil = w.kick;
    this.shake = Math.max(this.shake, w.kick * 6);
    if (this.weapon === 'shotgun') this.vm.pumpT = 1;
    this.audio.gunshot(this.player.x, this.player.z, w.sound);
    const dir = this.lookDir();
    const o = this.aimFrom();
    const mx = o[0] + dir[0] * 0.3, my = o[1] - (this.aimOrigin ? 0 : 0.14) + dir[1] * 0.3, mz = o[2] + dir[2] * 0.3;
    this.particles.muzzle(mx, my, mz);
    this.particles.casing(mx, my, mz, this.player.yaw);
    const pellets = w.pellets || 1;
    for (let i = 0; i < pellets; i++) {
      const d = this.spreadDir(dir, w.spread);
      this.hitscan(d, w.dmg);
    }
    this.noise(w.heat);
  }

  // Step the same ballistic arc the droplets fly to find the wet spot.
  streamLanding(ox, oy, oz, dx, dy, dz) {
    let x = ox, y = oy, z = oz;
    let vx = dx * STREAM_SPEED, vy = dy * STREAM_SPEED, vz = dz * STREAM_SPEED;
    const step = 0.04;
    for (let i = 0; i < 70; i++) {
      vy -= 12 * step;
      x += vx * step; y += vy * step; z += vz * step;
      if (y <= 0.03) break;
    }
    return { x, z, dist: Math.hypot(x - ox, z - oz) };
  }

  // Standing around with your fly open is its own event. People point.
  updateUnzipped(dt) {
    this.mockCd = (this.mockCd || 0) - dt;
    if (this.mockCd > 0) return;
    this.mockCd = 1.1;
    const now = performance.now() / 1000;
    let laughs = 0;
    for (const p of this.people) {
      if (p.dead || p.state !== 'wander') continue;
      if (p.kind !== 'civ' && p.kind !== 'clerk') continue;
      if (p.mockUntil && now < p.mockUntil) continue;
      const d = Math.sqrt(dist2(p.x, p.z, this.player.x, this.player.z));
      if (d > 15 || d < 1.2) continue;
      if (rng() > 0.45) continue;
      if (!this.hasLOS(this.player.x, this.player.y + 1.6, this.player.z, p.x, p.eyeY, p.z)) continue;
      p.mockUntil = now + 10 + rng() * 12;
      p.mock(this);
      if (++laughs >= 2) break;
    }
  }

  // One finger, one opinion. Costs nothing, changes everyone's mood.
  doTaunt() {
    if (this.taunt.t > 0) return;
    this.taunt.t = this.taunt.max;
    this.say(TAUNT_LINE, false, 2);
    const dir = this.lookDir();
    let seen = 0;
    for (const p of this.people) {
      if (p.dead) continue;
      const dx = p.x - this.player.x, dz = p.z - this.player.z;
      const d = Math.hypot(dx, dz);
      if (d > 14 || d < 0.01) continue;
      const facing = (dx / d) * dir[0] + (dz / d) * dir[2];
      if (facing < 0.45) continue;                  // has to be roughly in front of you
      if (!this.hasLOS(this.player.x, this.player.y + 1.6, this.player.z, p.x, p.eyeY, p.z)) continue;
      p.insulted(this.player.x, this.player.z, this);
      seen++;
    }
    if (seen) { this.addHeat(0.05 * seen); this.crimeCd = 4; }
  }

  // Postal's other button. No damage -- it just ruins everyone's morning.
  updateStream(dt) {
    const go = this.mouse.down && this.bladder > 0;
    this.streaming = go;
    this.audio.stream(go);
    if (!go) { this.wasStreaming = false; return; }
    if (!this.wasStreaming) this.dudeSay('relief');
    this.wasStreaming = true;
    this.bladder = Math.max(0, this.bladder - dt * 6.2);
    const dir = this.lookDir();
    const ox = this.camX + dir[0] * 0.32, oy = this.camY - 0.58, oz = this.camZ + dir[2] * 0.32;
    // a touch of lift so it arcs instead of dribbling
    const ay = dir[1] + 0.07;
    this.particles.stream(ox, oy, oz, dir[0], ay, dir[2], STREAM_SPEED);

    const land = this.streamLanding(ox, oy, oz, dir[0], ay, dir[2]);

    // wet patch where it actually lands
    this.wetCd = (this.wetCd || 0) - dt;
    if (this.wetCd <= 0) {
      this.wetCd = 0.16;
      this.decals.wet(land.x + rand(rng, -0.3, 0.3), land.z + rand(rng, -0.3, 0.3), 1.1 + rng() * 0.9);
    }

    // anyone between you and where it lands takes it personally
    this.soakCd = (this.soakCd || 0) - dt;
    if (this.soakCd > 0) return;
    this.soakCd = 0.3;
    let hit = false;
    const reach = Math.min(STREAM_REACH, Math.max(2.5, land.dist + 1.2));
    for (const p of this.people) {
      if (p.dead) continue;
      const dx = p.x - this.player.x, dz = p.z - this.player.z;
      const d = Math.hypot(dx, dz);
      if (d > reach || d < 0.01) continue;
      // cone widens with distance, the way a stream does
      if ((dx / d) * dir[0] + (dz / d) * dir[2] < 0.80) continue;
      p.disgust(this.player.x, this.player.z, this);
      hit = true;
    }
    if (hit) {
      this.addHeat(WEAPONS.relief.heat * 0.4);
      this.dudeSay('soaked');
      this.crimeCd = 5;
    } else {
      this.noiseWitness();
    }
  }

  // Doing it in the street is its own small offence.
  noiseWitness() {
    this.witCd = (this.witCd || 0) - 0.4;
    if (this.witCd > 0) return;
    this.witCd = 2.0;
    for (const p of this.people) {
      if (p.dead || p.kind === 'clerk') continue;
      if (dist2(p.x, p.z, this.player.x, this.player.z) < 14 * 14) {
        this.addHeat(0.06);
        this.crimeCd = 4;
        if (p.kind === 'civ' && p.state === 'wander' && rng() < 0.35) p.disgust(this.player.x, this.player.z, this);
        break;
      }
    }
  }

  spreadDir(dir, spread) {
    if (!spread) return dir;
    const a = rand(rng, 0, TAU), r = Math.sqrt(rng()) * spread;
    // build a basis around dir
    const up = Math.abs(dir[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const rx = dir[1] * up[2] - dir[2] * up[1], ry = dir[2] * up[0] - dir[0] * up[2], rz = dir[0] * up[1] - dir[1] * up[0];
    const rl = Math.hypot(rx, ry, rz) || 1;
    const ux = ry / rl * dir[2] - rz / rl * dir[1];
    const uy = rz / rl * dir[0] - rx / rl * dir[2];
    const uz = rx / rl * dir[1] - ry / rl * dir[0];
    const ox = Math.cos(a) * r, oy = Math.sin(a) * r;
    const nx = dir[0] + (rx / rl) * ox + ux * oy;
    const ny = dir[1] + (ry / rl) * ox + uy * oy;
    const nz = dir[2] + (rz / rl) * ox + uz * oy;
    const l = Math.hypot(nx, ny, nz);
    return [nx / l, ny / l, nz / l];
  }

  hitscan(dir, dmg) {
    const o = this.aimFrom();
    const ox = o[0], oy = o[1], oz = o[2];
    const maxD = 140;
    let wallD = this.city.rayHit(ox, oy, oz, dir[0], dir[1], dir[2], maxD);
    if (dir[1] < -0.001) wallD = Math.min(wallD, -oy / dir[1]);        // the ground
    let best = null, bestT = wallD;
    for (const p of this.people) {
      if (p.dead) continue;
      const h = p.rayHit(ox, oy, oz, dir[0], dir[1], dir[2], bestT);
      if (h && h.t < bestT) { bestT = h.t; best = { p, h }; }
    }
    const hx = ox + dir[0] * bestT, hy = oy + dir[1] * bestT, hz = oz + dir[2] * bestT;
    if (best) {
      const mult = best.h.head ? 2.6 : 1;
      this.particles.blood(hx, hy, hz, best.h.head ? 26 : 13, dir[0], dir[1], dir[2]);
      if (best.h.head) this.particles.mist(hx, hy, hz, 5);
      this.audio.meat(hx, hz);
      const died = best.p.hurt(dmg * mult, ox, oz, true, this, this.weapon);
      if (best.h.head && died) { this.notify('HEADSHOT'); this.dudeSay('headshot'); }
      this.killFlash = 0.12;
    } else if (bestT < maxD) {
      this.particles.spark(hx, hy, hz);
      this.audio.ricochet(hx, hz);
      if (hy < 0.2) this.particles.dust(hx, 0.06, hz, 3);
    }
  }

  meleeHit(w) {
    const dir = this.lookDir();
    let hitSomething = false;
    for (const p of this.people) {
      if (p.dead) continue;
      const dx = p.x - this.player.x, dz = p.z - this.player.z;
      const d = Math.hypot(dx, dz);
      if (d > w.range) continue;
      const dot = (dx / d) * dir[0] + (dz / d) * dir[2];
      if (dot < 1 - w.arc) continue;
      p.hurt(w.dmg, this.player.x, this.player.z, true, this, this.weapon);
      this.particles.blood(p.x, 1.3, p.z, 18, dir[0], 0.25, dir[2]);
      this.audio.meat(p.x, p.z);
      hitSomething = true;
      this.noise(w.heat);
      break;
    }
    if (!hitSomething) {
      // did we at least hit a wall?
      const o = this.aimFrom();
      const d = this.city.rayHit(o[0], o[1], o[2], dir[0], dir[1], dir[2], w.range);
      if (d < w.range) {
        this.particles.dust(o[0] + dir[0] * d, o[1] + dir[1] * d, o[2] + dir[2] * d, 4);
        this.audio.punch(this.player.x, this.player.z);
      }
    }
  }

  startReload() {
    const w = WEAPONS[this.weapon];
    if (w.melee || this.reloading > 0) return;
    if (this.mag[this.weapon] >= w.mag || this.ammo[w.ammo] <= 0) return;
    this.reloading = w.reload;
    this.audio.reload(this.player.x, this.player.z);
  }

  // Loud actions attract attention.
  noise(heat) {
    if (!heat) return;
    this.crimeCd = 6;
    let witnesses = 0;
    for (const p of this.people) {
      if (p.dead || p.kind === 'clerk') continue;
      const d2 = dist2(p.x, p.z, this.player.x, this.player.z);
      if (d2 < 26 * 26) {
        witnesses++;
        if (p.kind === 'civ' && p.state === 'wander' && rng() < 0.7) {
          p.state = 'panic'; p.stateT = rand(rng, 6, 11);
          p.threatX = this.player.x; p.threatZ = this.player.z;
        }
      }
    }
    if (witnesses) this.addHeat(heat * 0.18);
  }

  addHeat(v) {
    this.heat = clamp(this.heat + v * this.diff.heatGain, 0, 5.99);
    const w = Math.floor(this.heat);
    if (w > this.wanted) {
      this.wanted = w;
      this.notify('WANTED ' + '★'.repeat(this.wanted));
      this.audio.ding();
      this.dudeSay('wanted');
    } else this.wanted = w;
  }

  onKill(p) {
    this.kills++;
    const d = Math.sqrt(dist2(p.x, p.z, this.player.x, this.player.z));
    if (d < 5) this.goreScreen = Math.max(this.goreScreen, (1 - d / 5) * 0.8);
    this.crimeCd = 8;
    if (p.kind === 'civ' || p.kind === 'clerk') { this.civKills++; this.addHeat(1.15); this.dudeSay('kill'); }
    else if (p.kind === 'cop') { this.addHeat(1.6); this.dudeSay('killCop'); }
    else { this.addHeat(0.4); this.dudeSay('kill'); }
    if (p.kind === 'thug' && rng() < 0.7) this.pickups.push(new Pickup('cash', p.x, p.z, randI(rng, 20, 70)));
    if (p.kind === 'cop' && rng() < 0.35) this.pickups.push(new Pickup('armor', p.x - 0.6, p.z, 0));
    // anyone who was carrying drops what they were carrying
    if (p.armed) {
      const kind = p.kind === 'thug' && rng() < 0.4 ? 'shotgun' : 'pistol';
      this.pickups.push(new Pickup(kind, p.x + rand(rng, -0.8, 0.8), p.z + rand(rng, -0.8, 0.8), 0));
    } else if (p.kind === 'cop') {
      this.pickups.push(new Pickup('ammo9', p.x + 0.6, p.z, 0));
    }
  }

  // Blow a body apart into pieces of the right colours.
  spawnGibs(p) {
    if (this.goreLevel === 'OFF') return;
    const s = p.scale;
    const skin = hex(p.skin), shirt = hex(p.shirt), pants = hex(p.pants);
    const dx = p.hitDX || 0, dz = p.hitDZ || 0;
    const chunks = [
      { y: 1.72, sx: 0.30, sy: 0.32, sz: 0.29, c: skin, big: true },   // head
      { y: 1.28, sx: 0.44, sy: 0.42, sz: 0.27, c: shirt, big: true },  // chest
      { y: 0.98, sx: 0.40, sy: 0.30, sz: 0.25, c: pants, big: true },  // hips
      { y: 1.45, sx: 0.14, sy: 0.58, sz: 0.15, c: shirt },             // arm
      { y: 1.45, sx: 0.14, sy: 0.58, sz: 0.15, c: shirt },             // arm
      { y: 0.70, sx: 0.17, sy: 0.72, sz: 0.18, c: pants },             // leg
      { y: 0.70, sx: 0.17, sy: 0.72, sz: 0.18, c: pants },             // leg
    ];
    for (let i = 0; i < 5; i++) {
      chunks.push({ y: 0.9 + rng() * 0.8, sx: 0.12, sy: 0.12, sz: 0.12, c: [0.45, 0.04, 0.05] });
    }
    for (const ch of chunks) {
      const spread = ch.big ? 2.6 : 4.4;
      this.gibs.push(new Gib(
        p.x + rand(rng, -0.2, 0.2), ch.y * s, p.z + rand(rng, -0.2, 0.2),
        dx * rand(rng, 1.5, 4.5) + rand(rng, -spread, spread),
        rand(rng, 2.5, 7.5),
        dz * rand(rng, 1.5, 4.5) + rand(rng, -spread, spread),
        ch.sx * s, ch.sy * s, ch.sz * s,
        [ch.c[0] * 0.8 + 0.12, ch.c[1] * 0.55, ch.c[2] * 0.55]));
    }
    if (this.gibs.length > 70) this.gibs.splice(0, this.gibs.length - 70);
    // blood on the lens if it happened in your face
    const d = Math.sqrt(dist2(p.x, p.z, this.player.x, this.player.z));
    if (d < 9) this.goreScreen = Math.max(this.goreScreen, 1 - d / 9);
    this.shake = Math.max(this.shake, 0.5);
  }

  alarmCrowd(x, z, radius, threatX, threatZ) {
    for (const p of this.people) {
      if (p.dead || p.state === 'fight') continue;
      if (dist2(p.x, p.z, x, z) < radius * radius) {
        if (p.kind === 'civ' || p.kind === 'clerk') {
          p.state = 'panic'; p.stateT = rand(rng, 8, 14);
          p.threatX = threatX; p.threatZ = threatZ;
        }
      }
    }
  }

  hasLOS(x1, y1, z1, x2, y2, z2) {
    const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.001) return true;
    const t = this.city.rayHit(x1, y1, z1, dx / d, dy / d, dz / d, d);
    return t >= d - 0.35;
  }

  lookDir() {
    if (this.aimDir) return this.aimDir;          // VR: the hand points, not the head
    const cp = Math.cos(this.player.pitch);
    return [-Math.sin(this.player.yaw) * cp, Math.sin(this.player.pitch), -Math.cos(this.player.yaw) * cp];
  }

  aimFrom() {
    return this.aimOrigin || [this.camX, this.camY, this.camZ];
  }

  // ------------------------------------------------------------ player ---
  updatePlayer(dt) {
    const p = this.player;
    const k = this.keys;
    let sprint = k.has('ShiftLeft') || k.has('ShiftRight') || this.vrSprint;
    p.crouch = k.has('ControlLeft') || k.has('KeyC');
    // sprinting burns stamina; you need a decent chunk back before you can
    // start again, so it can't be tapped in and out
    const moving = Math.hypot(p.vx, p.vz) > 1.2;
    if (p.winded) { sprint = false; if (p.stamina > 28) p.winded = false; }
    if (sprint && moving) {
      p.stamina = Math.max(0, p.stamina - dt * 24);
      if (p.stamina <= 0) { p.winded = true; sprint = false; }
    } else {
      p.stamina = Math.min(100, p.stamina + dt * (moving ? 10 : 19));
    }
    let ix = 0, iz = 0;
    if (k.has('KeyW')) iz += 1;
    if (k.has('KeyS')) iz -= 1;
    if (k.has('KeyA')) ix -= 1;
    if (k.has('KeyD')) ix += 1;
    if (this.vrMove) { ix += this.vrMove.x; iz += this.vrMove.z; }
    // arrows look around, for anyone without a working pointer lock
    const look = 2.1 * dt;
    if (k.has('ArrowLeft')) p.yaw += look;
    if (k.has('ArrowRight')) p.yaw -= look;
    if (k.has('ArrowUp')) p.pitch = clamp(p.pitch + look * 0.7, -1.45, 1.45);
    if (k.has('ArrowDown')) p.pitch = clamp(p.pitch - look * 0.7, -1.45, 1.45);
    const il = Math.hypot(ix, iz);
    let speed = p.crouch ? 2.0 : sprint ? 6.4 : 3.9;
    if (this.taskProgress > 0) speed = 0;

    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    let wx = 0, wz = 0;
    if (il > 0) {
      wx = (fx * iz + rx * ix) / il;
      wz = (fz * iz + rz * ix) / il;
    }
    const accel = p.onGround ? 26 : 6;
    p.vx += (wx * speed - p.vx) * Math.min(1, dt * accel);
    p.vz += (wz * speed - p.vz) * Math.min(1, dt * accel);

    if (k.has('Space') && p.onGround) { p.vy = 6.4; p.onGround = false; }
    p.vy -= 21 * dt;
    p.y += p.vy * dt;
    if (p.y <= 0) { p.y = 0; p.vy = 0; p.onGround = true; }

    const np = { x: p.x + p.vx * dt, z: p.z + p.vz * dt };
    this.city.resolve(np, 0.38);
    const b = this.city.bounds;
    np.x = clamp(np.x, b.min - 24, b.max + 24);
    np.z = clamp(np.z, b.min - 24, b.max + 24);
    p.x = np.x; p.z = np.z;

    // footsteps
    const spd = Math.hypot(p.vx, p.vz);
    if (p.onGround && spd > 0.6) {
      p.stepPhase += spd * dt * 1.5;
      if (p.stepPhase > 1) { p.stepPhase = 0; this.audio.step(p.x, p.z, sprint); }
    }
    this.vm.moveAmt = lerp(this.vm.moveAmt, clamp(spd / 4, 0, 1.3), Math.min(1, dt * 8));
    this.vm.bob += spd * dt * 2.2;
    this.vm.sprint = lerp(this.vm.sprint, sprint && spd > 3 ? 1 : 0, Math.min(1, dt * 8));
    this.vm.lower = Math.max(0, this.vm.lower - dt * 3.5);
    this.vm.recoil = Math.max(0, this.vm.recoil - dt * 0.35);
    this.vm.swing = Math.max(0, this.vm.swing - dt * 3.4);
    this.vm.pumpT = Math.max(0, this.vm.pumpT - dt * 2.6);
    this.vm.swayX *= Math.max(0, 1 - dt * 6);
    this.vm.swayY *= Math.max(0, 1 - dt * 6);
    this.fireCd = Math.max(0, this.fireCd - dt);
    this.shake = Math.max(0, this.shake - dt * 2.2);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.6);
    this.killFlash = Math.max(0, this.killFlash - dt * 3);
    this.goreScreen = Math.max(0, this.goreScreen - dt * 0.14);
    this.taunt.t = Math.max(0, this.taunt.t - dt);

    if (this.reloading > 0) {
      this.reloading -= dt;
      const w = WEAPONS[this.weapon];
      this.vm.reloadT = clamp(this.reloading / w.reload, 0, 1);
      if (this.reloading <= 0) {
        const need = w.mag - this.mag[this.weapon];
        const take = Math.min(need, this.ammo[w.ammo]);
        this.mag[this.weapon] += take;
        this.ammo[w.ammo] -= take;
        this.vm.reloadT = 0;
      }
    }

    if (WEAPONS[this.weapon].stream) { this.updateStream(dt); this.updateUnzipped(dt); }
    else { this.streaming = false; this.audio.stream(false); if (this.mouse.down) this.fire(); }
    // the bladder refills slowly on its own
    if (!this.streaming) this.bladder = Math.min(100, this.bladder + dt * 2.4);

    // camera
    const eye = lerp(p.crouch ? CROUCH_EYE : EYE, p.crouch ? CROUCH_EYE : EYE, 1);
    this.eyeH = lerp(this.eyeH === undefined ? eye : this.eyeH, eye, Math.min(1, dt * 12));
    const bobY = Math.sin(this.vm.bob * 2) * 0.028 * this.vm.moveAmt;
    const bobX = Math.sin(this.vm.bob) * 0.03 * this.vm.moveAmt;
    const sh = this.shake;
    const bobOn = this.settings.viewBob !== false && !(this.vr && this.vr.active);
    this.camX = p.x + (bobOn ? rx * bobX : 0) + rand(rng, -sh, sh) * 0.06;
    this.camY = p.y + this.eyeH + (bobOn ? bobY : 0) + rand(rng, -sh, sh) * 0.06;
    this.camZ = p.z + (bobOn ? rz * bobX : 0);
    this.camYaw = p.yaw; this.camPitch = p.pitch;
    this.camRoll = Math.sin(this.vm.bob) * 0.012 * this.vm.moveAmt + (this.hurtFlash * 0.05);

    // pickups
    for (const pk of this.pickups) {
      if (pk.taken) continue;
      if (dist2(pk.x, pk.z, p.x, p.z) < 1.7) this.take(pk);
    }
    this.pickups = this.pickups.filter(pk => !pk.taken);
  }

  take(pk) {
    const p = this.player;
    switch (pk.kind) {
      case 'cash': p.cash += pk.amount; this.notify('+$' + pk.amount); this.audio.pickup('cash'); this.dudeSay('cash'); break;
      case 'health':
        if (p.hp >= 100) return;
        p.hp = Math.min(100, p.hp + Math.round(35 * this.diff.healMul)); this.notify('+' + Math.round(35 * this.diff.healMul) + ' HEALTH'); this.audio.pickup(); this.dudeSay('health'); break;
      case 'armor':
        if (p.armor >= 100) return;
        p.armor = Math.min(100, p.armor + 50); this.notify('+50 ARMOR'); this.audio.pickup(); break;
      case 'ammo9':
        this.ammo['9mm'] += 24; this.notify('+24 9MM'); this.audio.pickup(); this.dudeSay('ammo'); break;
      case 'shells':
        this.ammo.shells += 12; this.notify('+12 SHELLS'); this.audio.pickup(); this.dudeSay('ammo'); break;
      case 'pistol':
      case 'shotgun': {
        const had = this.owned[pk.kind];
        const w = WEAPONS[pk.kind];
        this.owned[pk.kind] = true;
        if (!had) {
          this.mag[pk.kind] = w.mag;
          this.notify('PICKED UP: ' + w.name);
          this.dudeSay('gotGun');
        } else {
          this.notify('+' + (pk.kind === 'pistol' ? '18 9MM' : '8 SHELLS'));
          this.dudeSay('ammo');
        }
        this.ammo[w.ammo] += pk.kind === 'pistol' ? 18 : 8;
        this.audio.pickup();
        // if you were swinging a boot, you are not any more
        if (WEAPONS[this.weapon].melee || WEAPONS[this.weapon].stream) this.selectWeapon(pk.kind);
        break;
      }
    }
    pk.taken = true;
  }

  playerHurt(dmg, fromX, fromZ, cause) {
    const p = this.player;
    dmg *= this.diff.dmgTaken;
    if (p.armor > 0) {
      const soak = Math.min(p.armor, dmg * 0.6);
      p.armor -= soak; dmg -= soak;
    }
    p.hp -= dmg;
    this.hurtFlash = 1;
    this.shake = Math.max(this.shake, 0.5);
    this.audio.hurt();
    if (p.hp > 0) this.dudeSay(p.hp < 32 ? 'lowHealth' : 'hurt');
    if (p.hp <= 0) { p.hp = 0; this.playerDied(); }
  }

  playerDied() {
    if (this.over) return;
    this.deaths = (this.deaths || 0) + 1;
    if (this.deaths >= this.diff.lives) { this.finish(false); return; }
    const home = this.city.shopByKey('home');
    this.player.hp = 100; this.player.armor = 0;
    this.player.cash = Math.max(0, this.player.cash - 40);
    const spot = this.clearSpot(home.street.x, home.street.z);
    this.player.x = spot.x; this.player.z = spot.z;
    this.player.vx = this.player.vz = 0;
    this.wanted = 0; this.heat = 0;
    this.taskProgress = 0;
    for (const p of this.people) if (p.state === 'fight') { p.state = p.kind === 'cop' ? 'patrol' : 'wander'; }
    this.ui.fade.classList.add('on');
    setTimeout(() => this.ui.fade.classList.remove('on'), 700);
    this.notify('YOU WOKE UP AT HOME. $40 GONE.');
    this.dudeSay('died');
  }

  // ---------------------------------------------------------- errands ---
  updateErrand(dt) {
    const t = this.task;
    this.prompt = null;
    if (!t) return;
    const shop = this.taskShop;
    const p = this.player;
    const d = Math.sqrt(dist2(p.x, p.z, shop.spot.x, shop.spot.z));
    const holding = this.keys.has('KeyE');
    if (d > 2.8) {
      if (this.taskProgress > 0) this.taskProgress = 0;
      return;
    }
    const cost = t.cost || 0;
    if (cost > p.cash) {
      this.prompt = { text: `NOT ENOUGH CASH — NEED $${cost}`, bad: true };
      this.dudeSay('brokeAF');
      return;
    }
    if (this.wanted >= 3) {
      this.prompt = { text: 'NOBODY WILL SERVE YOU WITH THE COPS ON YOU', bad: true };
      return;
    }
    this.prompt = {
      text: holding ? t.verb + '…' : `HOLD [E] TO ${t.verb}`,
      progress: this.taskProgress / t.time,
    };
    if (holding) {
      if (this.taskProgress === 0 && t.kind === 'queue') this.dudeSay('queueStart');
      this.taskProgress += dt;
      if (t.kind === 'queue' && this.taskProgress > 2.5) this.dudeSay('queueWait');
      if (!this.queueSoundT || performance.now() - this.queueSoundT > 900) {
        this.queueSoundT = performance.now();
        if (t.kind === 'queue' && rng() < 0.5) this.audio.step(p.x, p.z, false);
      }
      if (this.taskProgress >= t.time) this.completeTask();
    } else if (this.taskProgress > 0) {
      this.taskProgress = Math.max(0, this.taskProgress - dt * 2);
    }
  }

  // ------------------------------------------------------------- world ---
  updateWorld(dt) {
    for (const p of this.people) p.update(dt, this);
    for (const c of this.cars) c.update(dt, this);
    for (let i = this.gibs.length - 1; i >= 0; i--) {
      const gb = this.gibs[i];
      gb.update(dt, this);
      if (gb.life <= 0) this.gibs.splice(i, 1);
    }
    for (const pk of this.pickups) pk.update(dt);
    this.particles.update(dt);
    this.decals.update(dt);

    // heat cools off when nobody is looking
    this.crimeCd = Math.max(0, this.crimeCd - dt);
    if (this.crimeCd <= 0 && this.heat > 0) {
      const before = this.wanted;
      this.heat = Math.max(0, this.heat - dt * 0.11 * this.diff.heatDecay);
      this.wanted = Math.floor(this.heat);
      if (before > 0 && this.wanted === 0) this.dudeSay('copsGone');
    }
    this.audio.siren(this.wanted > 0);

    // more cops arrive as the heat climbs
    this.copSpawnCd -= dt;
    const wantCops = Math.round(this.wanted * this.diff.copRate);
    const liveCops = this.people.filter(p => p.kind === 'cop' && !p.dead && p.state === 'fight').length;
    if (this.copSpawnCd <= 0 && liveCops < wantCops) {
      this.copSpawnCd = 3.5;
      const a = rand(rng, 0, TAU), r = rand(rng, 42, 62);
      const cop = makeCop(this.player.x + Math.cos(a) * r, this.player.z + Math.sin(a) * r);
      const pos = { x: cop.x, z: cop.z };
      this.city.resolve(pos, 0.5);
      cop.x = pos.x; cop.z = pos.z;
      cop.state = 'fight'; cop.stateT = 90;
      this.people.push(cop);
    }
    // clean up: drop the oldest corpses so the crowd stays affordable
    const corpses = this.people.filter(p => p.dead);
    if (corpses.length > 26) {
      const doomed = corpses.slice(0, corpses.length - 26);
      this.people = this.people.filter(p => !doomed.includes(p));
    }
    // keep the streets busy
    if (this.people.filter(p => p.kind === 'civ' && !p.dead).length < 34 && rng() < dt * 0.9) {
      const n = pick(rng, this.city.nav);
      if (dist2(n.x, n.z, this.player.x, this.player.z) > 60 * 60) {
        const c = makeCivilian(n.x + rand(rng, -4, 4), n.z + rand(rng, -4, 4));
        c.node = n;
        this.people.push(c);
      }
    }

    this.clock += dt * 3.2;
    if (this.dudeIdleCd === undefined) this.dudeIdleCd = 40;
    this.dudeIdleCd -= dt;
    if (this.dudeIdleCd <= 0) { this.dudeIdleCd = rand(rng, 55, 110); this.dudeSay('idle'); }
  }

  // ------------------------------------------------------------ render ---
  render() {
    const r = this.r;
    r.time = performance.now() / 1000;
    const menuBg = this.menu && this.menu.isOpen && this.menu.screen !== 'pause';
    r.beginFrame(this.camX, this.camY, this.camZ, this.camYaw, this.camPitch,
      (this.mouse.right ? 0.86 : 1.0) * (this.settings.fov || 1.28),
      menuBg ? 0 : (this.camRoll || 0));
    this.renderScene();
    // hands
    if (!menuBg) {
      const gl = r.gl;
      gl.clear(gl.DEPTH_BUFFER_BIT);
      drawViewModel(r, this);
    }
  }

  // Everything in the world. Called once on flat screens, once per eye in VR.
  renderScene() {
    const r = this.r;
    const gl = r.gl;
    for (const b of this.city.batches) {
      if (b.twoSided) gl.disable(gl.CULL_FACE);
      if (b.blend) { r.setBlend(true); r.setDepthWrite(false); }
      r.draw(b.mesh, b.tex, null, { alphaMode: b.alphaMode, unlit: b.unlit });
      if (b.blend) { r.setBlend(false); r.setDepthWrite(true); }
      if (b.twoSided) gl.enable(gl.CULL_FACE);
    }

    // people + traffic
    const px = this.player.x, pz = this.player.z;
    for (const p of this.people) {
      if (p.gibbed) continue;                       // they are the chunks now
      if (dist2(p.x, p.z, px, pz) > 105 * 105) continue;
      this.drawPerson(p);
    }
    for (const c of this.cars) {
      if (dist2(c.x, c.z, px, pz) > 130 * 130) continue;
      this.drawCar(c);
    }
    for (const gb of this.gibs) {
      if (dist2(gb.x, gb.z, px, pz) > 90 * 90) continue;
      r.box(gb.x, gb.y, gb.z, gb.sx, gb.sy, gb.sz, gb.ry, gb.color, { rx: gb.rx, rz: gb.rz });
    }
    for (const pk of this.pickups) {
      if (dist2(pk.x, pk.z, px, pz) > 90 * 90) continue;
      this.drawPickup(pk);
    }

    // transparent pass
    r.setBlend(true); r.setDepthWrite(false);
    gl.disable(gl.CULL_FACE);
    this.drawDecals();
    this.drawShadows();
    this.drawBeacon();
    this.drawParticles();
    gl.enable(gl.CULL_FACE);
    r.setBlend(false); r.setDepthWrite(true);
  }

  drawPerson(p) {
    const r = this.r;
    if (!p.faceTex) p.faceTex = r.texture(p.face, { wrap: false });
    const s = p.scale;
    const yaw = p.yaw;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const fall = p.fall;
    const cF = Math.cos(fall), sF = Math.sin(fall);
    // basis with the fall rotation folded in
    const ux = fx * sF, uy = cF, uz = fz * sF;
    const wx = fx * cF, wy = -sF, wz = fz * cF;
    const pos = (lx, ly, lz) => [
      p.x + rx * lx + ux * ly + wx * lz,
      ux * 0 + uy * ly + wy * lz + (p.y || 0),
      p.z + rz * lx + uz * ly + wz * lz,
    ];
    const shirt = hex(p.shirt), pants = hex(p.pants), skin = hex(p.skin), hair = hex(p.hair);
    const flash = p.hitFlash > 0 ? 1.8 : 1;
    const tint = c => flash > 1 ? [c[0] * flash + 0.4, c[1] * 0.5, c[2] * 0.5] : c;

    const walk = Math.sin(p.walkPhase) * clamp(Math.hypot(p.vx, p.vz) / 2.4, 0, 1) * 0.85;
    const arm = -walk * 0.9;

    // torso + head
    let t = pos(0, 1.24 * s, 0);
    r.box(t[0], t[1], t[2], 0.46 * s, 0.74 * s, 0.28 * s, yaw, tint(shirt), { rx: fall });
    t = pos(0, 0.90 * s, 0);
    r.box(t[0], t[1], t[2], 0.42 * s, 0.24 * s, 0.26 * s, yaw, tint(pants), { rx: fall });
    // head
    t = pos(0, 1.72 * s, 0);
    r.box(t[0], t[1], t[2], 0.30 * s, 0.32 * s, 0.29 * s, yaw, tint(skin), { rx: fall });
    // face plate
    const fp = pos(0, 1.72 * s, 0.152 * s);
    mat4.compose(FACE_M, fp[0], fp[1], fp[2], yaw, 0.29 * s, 0.31 * s, 1, fall);
    r.draw(r.unitQuad, p.faceTex, FACE_M, { color: tint([1, 1, 1]), alphaMode: 0 });
    // hair / cap
    const hp = pos(0, 1.90 * s, 0);
    r.box(hp[0], hp[1], hp[2], 0.32 * s, 0.10 * s, 0.31 * s, yaw, p.cap ? hex(p.cap) : hair, { rx: fall });
    if (p.cap) {
      const bp = pos(0, 1.86 * s, 0.20 * s);
      r.box(bp[0], bp[1], bp[2], 0.30 * s, 0.045 * s, 0.16 * s, yaw, hex(p.cap), { rx: fall });
    }
    // limbs
    const limb = (jx, jy, jz, ang, len, w, d, color) => {
      const a = fall + ang;
      const sa = Math.sin(a), ca = Math.cos(a);
      const j = pos(jx, jy, jz);
      const cx = j[0] - (len / 2) * (fx * sa);
      const cy = j[1] - (len / 2) * ca;
      const cz = j[2] - (len / 2) * (fz * sa);
      r.box(cx, cy, cz, w, len, d, yaw, color, { rx: a });
    };
    // arms: pose depends on what they think of you
    let armR, armL;
    if (p.state === 'panic') {
      armR = armL = 2.3 + Math.sin(p.walkPhase * 2) * 0.35;            // both hands up, fleeing
    } else if (p.state === 'grossed') {
      armR = 2.55 + Math.sin(p.laughT || 0) * 0.1;                      // hands to the face, gagging
      armL = 2.75;
    } else if (p.state === 'mock') {
      armR = 1.62 + Math.sin((p.laughT || 0) * 11) * 0.14;              // one arm pointing at you
      armL = 0.75;                                                       // the other clutching the ribs
    } else if (p.armed && p.state === 'fight' && !(p.drawT > 0)) {
      armR = armL = 1.45;                                                // levelled at you
    } else {
      armR = arm; armL = -arm;
    }
    // once they are dying, the death animation owns every limb
    let legR = walk, legL = -walk;
    if (p.dead && p.anim) {
      const a = p.anim;
      if (a.armA !== undefined) armR = a.armA;
      if (a.armB !== undefined) armL = a.armB;
      if (a.legA !== undefined) legR = a.legA;
      if (a.legB !== undefined) legL = a.legB;
    }
    limb(0.30 * s, 1.52 * s, 0, armR, 0.62 * s, 0.14 * s, 0.16 * s, tint(shirt));
    limb(-0.30 * s, 1.52 * s, 0, armL, 0.62 * s, 0.14 * s, 0.16 * s, tint(shirt));
    limb(0.13 * s, 0.92 * s, 0, legR, 0.92 * s, 0.17 * s, 0.19 * s, tint(pants));
    limb(-0.13 * s, 0.92 * s, 0, legL, 0.92 * s, 0.17 * s, 0.19 * s, tint(pants));
    // held weapon
    if (p.armed && !p.dead && !(p.drawT > 0)) {
      const g = pos(0.34 * s, 1.30 * s, 0.42 * s);
      r.box(g[0], g[1], g[2], 0.07, 0.10, 0.30, yaw, [0.16, 0.17, 0.2], { rx: fall + (p.state === 'fight' ? 0 : 0.9) });
    }
  }

  drawCar(c) {
    const r = this.r;
    const col = hex(c.color);
    const dark = [col[0] * 0.35, col[1] * 0.35, col[2] * 0.35];
    r.box(c.x, 0.62, c.z, c.wid, 0.72, c.len, c.yaw, col);
    r.box(c.x, 1.16, c.z - 0.15, c.wid * 0.86, 0.62, c.len * 0.5, c.yaw, [0.32, 0.36, 0.42]);
    r.box(c.x, 0.30, c.z, c.wid * 1.02, 0.26, c.len * 0.98, c.yaw, dark);
    const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
    const rx = Math.cos(c.yaw), rz = -Math.sin(c.yaw);
    for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const wx = c.x + rx * a * (c.wid / 2) + fx * b * (c.len * 0.32);
      const wz = c.z + rz * a * (c.wid / 2) + fz * b * (c.len * 0.32);
      r.box(wx, 0.32, wz, 0.16, 0.6, 0.6, c.yaw, [0.09, 0.09, 0.1], { rx: c.wheelSpin });
    }
    // lights
    r.box(c.x + fx * c.len * 0.5, 0.66, c.z + fz * c.len * 0.5, c.wid * 0.8, 0.16, 0.06, c.yaw, [2.2, 2.1, 1.7], { unlit: true });
    r.box(c.x - fx * c.len * 0.5, 0.66, c.z - fz * c.len * 0.5, c.wid * 0.8, 0.14, 0.06, c.yaw, [1.6, 0.14, 0.12], { unlit: true });
  }

  drawPickup(pk) {
    const r = this.r;
    const y = 0.55 + Math.sin(pk.bob) * 0.12;
    if (pk.kind === 'pistol' || pk.kind === 'shotgun') {
      const long = pk.kind === 'shotgun';
      const steel = [0.20, 0.21, 0.24], wood = [0.42, 0.28, 0.16];
      r.box(pk.x, y + 0.03, pk.z, long ? 0.06 : 0.05, 0.07, long ? 0.95 : 0.28, pk.spin, steel);
      if (long) {
        r.box(pk.x, y - 0.02, pk.z + 0.30, 0.07, 0.11, 0.30, pk.spin, wood);
        r.box(pk.x, y - 0.03, pk.z - 0.10, 0.06, 0.06, 0.26, pk.spin, steel);
      } else {
        r.box(pk.x, y - 0.09, pk.z + 0.05, 0.05, 0.16, 0.07, pk.spin, [0.13, 0.12, 0.13], { rx: 0.3 });
      }
      // glow ring so you can spot it on the ground
      r.box(pk.x, 0.06, pk.z, 0.8, 0.02, 0.8, pk.spin * 0.5, [1.0, 0.85, 0.35], { unlit: true, alpha: 0.9 });
      return;
    }
    const colors = {
      cash: [0.35, 0.75, 0.35], health: [0.95, 0.25, 0.25], armor: [0.35, 0.6, 1.0],
      ammo9: [0.85, 0.7, 0.3], shells: [0.9, 0.45, 0.2],
    };
    const c = colors[pk.kind] || [1, 1, 1];
    r.box(pk.x, y, pk.z, 0.34, 0.34, 0.34, pk.spin, c);
    r.box(pk.x, y, pk.z, 0.40, 0.10, 0.40, pk.spin, [c[0] * 1.4, c[1] * 1.4, c[2] * 1.4], { unlit: true });
  }

  drawShadows() {
    const r = this.r;
    if (!this.shadowTex) this.shadowTex = r.texture(T.blob('0,0,0', 0.25), { wrap: false });
    for (const p of this.people) {
      if (p.gibbed) continue;
      if (dist2(p.x, p.z, this.player.x, this.player.z) > 70 * 70) continue;
      const sc = p.dead ? 1.9 : 1.25;
      mat4.compose(FACE_M, p.x, 0.035, p.z, 0, sc, 1, sc, 0);
      r.draw(r.unitGround, this.shadowTex, FACE_M, { alphaMode: 2, unlit: true, alpha: p.dead ? 0.35 : 0.5 });
    }
    for (const c of this.cars) {
      if (dist2(c.x, c.z, this.player.x, this.player.z) > 80 * 80) continue;
      mat4.compose(FACE_M, c.x, 0.03, c.z, c.yaw, c.wid * 1.4, 1, c.len * 1.2, 0);
      r.draw(r.unitGround, this.shadowTex, FACE_M, { alphaMode: 2, unlit: true, alpha: 0.45 });
    }
  }

  drawDecals() {
    const r = this.r;
    if (!this.splatTex) this.splatTex = r.texture(T.splatTex(), { wrap: false });
    if (!this.wetTex) this.wetTex = r.texture(T.blob('190,178,70', 0.45), { wrap: false });
    for (const d of this.decals.d) {
      if (dist2(d.x, d.z, this.player.x, this.player.z) > 80 * 80) continue;
      const wet = d.kind === 'wet';
      mat4.compose(FACE_M, d.x, 0.045, d.z, d.rot, d.size, 1, d.size, 0);
      r.draw(r.unitGround, wet ? this.wetTex : this.splatTex, FACE_M, {
        alphaMode: 2, unlit: true,
        alpha: wet ? Math.max(0, 0.45 - d.age * 0.012) : 0.85,
      });
    }
  }

  drawParticles() {
    const r = this.r;
    if (!this.softTex) this.softTex = r.texture(T.blob('255,255,255', 0.4), { wrap: false });
    const yaw = this.player.yaw, pitch = this.player.pitch;
    for (const q of this.particles.p) {
      const a = clamp(q.life / q.max, 0, 1);
      const s = q.size * (q.kind === 'flash' ? 1 + (1 - a) * 2 : 1);
      mat4.compose(FACE_M, q.x, q.y, q.z, yaw, s, s, s, pitch);
      const add = q.kind === 'flash' || q.kind === 'spark';
      if (add) r.setAdditive();
      r.draw(r.unitQuad, this.softTex, FACE_M, {
        color: q.color, alphaMode: 2, unlit: true,
        alpha: q.kind === 'smoke' ? a * 0.4 : a,
      });
      if (add) r.setBlend(true);
    }
  }

  drawBeacon() {
    const shop = this.taskShop;
    if (!shop) return;
    const r = this.r;
    if (!this.beamTex) this.beamTex = r.texture(T.blob('255,220,120', 0.6), { wrap: false });
    const t = performance.now() / 1000;
    const x = shop.door.x, z = shop.door.z;
    r.setAdditive();
    for (let i = 0; i < 3; i++) {
      mat4.compose(FACE_M, x, 7, z, i * 1.05 + t * 0.25, 3.2, 14, 1, 0);
      r.draw(r.unitQuad, this.beamTex, FACE_M, { color: [1.0, 0.82, 0.35], alphaMode: 2, unlit: true, alpha: 0.16 });
    }
    // bobbing marker over the entrance
    const y = 5.9 + Math.sin(t * 2.2) * 0.25;
    mat4.compose(FACE_M, x, y, z, t * 1.6, 0.55, 0.55, 0.55, 0.6, 0.6);
    r.draw(r.unitCube, r.whiteTex, FACE_M, { color: [2.2, 1.7, 0.5], unlit: true, alpha: 0.9, alphaMode: 0 });
    r.setBlend(true);
  }

  // --------------------------------------------------------------- HUD ---
  buildHUD() {
    this.ui.tasks = document.getElementById('tasks');
    this.ui.dayLabel = document.getElementById('dayLabel');
    this.ui.clock = document.getElementById('clock');
    this.ui.hp = document.getElementById('hpFill');
    this.ui.ar = document.getElementById('arFill');
    this.ui.st = document.getElementById('stFill');
    this.ui.hpNum = document.getElementById('hpNum');
    this.ui.cash = document.getElementById('cash');
    this.ui.wanted = document.getElementById('wanted');
    this.ui.weapon = document.getElementById('weaponName');
    this.ui.ammo = document.getElementById('ammoCount');
    this.ui.prompt = document.getElementById('prompt');
    this.ui.promptBar = document.getElementById('promptBar');
    this.ui.notices = document.getElementById('notices');
    this.ui.sub = document.getElementById('subtitle');
    this.ui.compass = document.getElementById('compass');
    this.ui.dist = document.getElementById('objDist');
    this.ui.flash = document.getElementById('flash');
    this.ui.fade = document.getElementById('fade');
    this.ui.card = document.getElementById('dayCard');
    this.ui.map = document.getElementById('mapWrap');
    this.ui.lockHint = document.getElementById('lockHint');
    this.ui.gore = document.getElementById('gore');
    this.ui.voiceState = document.getElementById('voiceState');
    this.ui.gore.style.backgroundImage = 'url(' + T.screenSpatter().toDataURL() + ')';
    this.mapCtx = document.getElementById('map').getContext('2d');
    this.updateTaskUI();
  }

  updateTaskUI() {
    const day = DAYS[this.day];
    this.ui.dayLabel.textContent = day.name;
    this.ui.tasks.innerHTML = day.tasks.map((t, i) => {
      const cls = i < this.taskIndex ? 'done' : i === this.taskIndex ? 'now' : 'todo';
      const cost = t.cost ? ` <em>$${t.cost}</em>` : t.cash ? ` <em>+$${t.cash}</em>` : '';
      return `<li class="${cls}"><span class="tick">${i < this.taskIndex ? '✓' : '□'}</span>${t.label}${cost}</li>`;
    }).join('');
  }

  notify(text) {
    this.notices.push({ text, t: 3.2 });
    if (this.notices.length > 5) this.notices.shift();
  }

  say(text, quiet, pri = 2) {
    this.subtitle = { text, t: 4.2 };
    if (!quiet || rng() < 0.6) this.audio.dude(text, pri);
  }

  // Fire one of the Dude's situational lines, respecting its own cooldown.
  dudeSay(key) {
    const b = DUDE[key];
    if (!b) return;
    this.barkCd = this.barkCd || {};
    const now = performance.now() / 1000;
    if (this.barkCd[key] && now < this.barkCd[key]) return;
    this.barkCd[key] = now + b.cd;
    const line = pickLine(key, rng);
    if (line) this.say(line, false, b.pri);
  }

  dayCard(name, tag) {
    this.ui.card.innerHTML = `<b>${name}</b><span>${tag}</span>`;
    this.ui.card.classList.add('show');
    setTimeout(() => this.ui.card.classList.remove('show'), 2600);
  }

  updateHUD(dt) {
    const p = this.player;
    this.ui.hp.style.width = clamp(p.hp, 0, 100) + '%';
    this.ui.ar.style.width = clamp(p.armor, 0, 100) + '%';
    this.ui.st.style.width = clamp(p.stamina, 0, 100) + '%';
    this.ui.st.classList.toggle('winded', p.winded);
    this.ui.hpNum.textContent = Math.ceil(p.hp);
    this.ui.cash.textContent = '$' + p.cash;
    const w = WEAPONS[this.weapon];
    this.ui.weapon.textContent = w.name;
    this.ui.ammo.textContent = w.stream ? Math.round(this.bladder) + '%'
      : w.melee ? '—'
        : `${this.mag[this.weapon]} / ${this.ammo[w.ammo]}`;
    this.ui.ammo.classList.toggle('low',
      (w.stream && this.bladder < 15) || (!w.melee && !w.stream && this.mag[this.weapon] === 0));

    let stars = '';
    for (let i = 0; i < 5; i++) stars += `<span class="${i < this.wanted ? 'on' : ''}">★</span>`;
    if (this.ui.wanted.dataset.n !== String(this.wanted)) {
      this.ui.wanted.innerHTML = stars;
      this.ui.wanted.dataset.n = String(this.wanted);
    }

    // clock
    const mins = Math.floor(this.clock) % (24 * 60);
    const hh = Math.floor(mins / 60), mm = mins % 60;
    this.ui.clock.textContent = `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;

    // prompt
    if (this.prompt) {
      this.ui.prompt.textContent = this.prompt.text;
      this.ui.prompt.className = this.prompt.bad ? 'bad' : '';
      this.ui.prompt.style.display = 'block';
      this.ui.promptBar.style.display = this.prompt.progress ? 'block' : 'none';
      if (this.prompt.progress) this.ui.promptBar.firstElementChild.style.width = (this.prompt.progress * 100) + '%';
    } else {
      this.ui.prompt.style.display = 'none';
      this.ui.promptBar.style.display = 'none';
    }

    // notices
    for (let i = this.notices.length - 1; i >= 0; i--) {
      this.notices[i].t -= dt;
      if (this.notices[i].t <= 0) this.notices.splice(i, 1);
    }
    this.ui.notices.innerHTML = this.notices.map(n =>
      `<div style="opacity:${clamp(n.t, 0, 1)}">${n.text}</div>`).join('');

    // subtitle
    this.subtitle.t -= dt;
    this.ui.sub.textContent = this.subtitle.t > 0 ? this.subtitle.text : '';
    this.ui.sub.style.opacity = clamp(this.subtitle.t, 0, 1);

    // objective compass
    const shop = this.taskShop;
    if (shop) {
      const dx = shop.door.x - p.x, dz = shop.door.z - p.z;
      const d = Math.hypot(dx, dz);
      const ang = Math.atan2(dx, dz) - (p.yaw + Math.PI);
      this.ui.compass.style.transform = `rotate(${-ang}rad)`;
      this.ui.dist.textContent = Math.round(d) + 'm';
    }

    // damage flash
    // say plainly why nobody is talking
    const vs = !this.audio.voice ? 'VOICES OFF  [V]' : '';
    if (this.ui.voiceState.textContent !== vs) this.ui.voiceState.textContent = vs;
    this.ui.gore.style.opacity = clamp(this.goreScreen, 0, 1) * 0.92;
    this.ui.flash.style.opacity = Math.max(this.hurtFlash * 0.55, 0);
    this.ui.flash.style.background = this.hurtFlash > 0
      ? 'radial-gradient(ellipse at center, rgba(140,0,0,0) 35%, rgba(150,0,0,0.9) 100%)'
      : 'none';

    this.drawMap();
  }

  drawMap() {
    const big = this.ui.map.classList.contains('big');
    const c = this.mapCtx;
    this.drawMapInto(c, c.canvas.width, c.canvas.height, big ? TOWN + 40 : 130, big);
  }

  // Shared by the HUD minimap and the VR wrist panel.
  drawMapInto(c, W, H, span, centred) {
    const p = this.player;
    const cxw = centred ? TOWN / 2 : p.x, czw = centred ? TOWN / 2 : p.z;
    const sc = W / span;
    const tx = x => (x - cxw) * sc + W / 2;
    const tz = z => (z - czw) * sc + H / 2;

    c.clearRect(0, 0, W, H);
    c.fillStyle = '#191b1f'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#2b2e34';
    for (let gz = 0; gz < GRIDN; gz++) for (let gx = 0; gx < GRIDN; gx++) {
      const x0 = roadAt(gx) + ROAD / 2, z0 = roadAt(gz) + ROAD / 2;
      c.fillRect(tx(x0), tz(z0), BLOCKW * sc, BLOCKW * sc);
    }
    c.strokeStyle = '#4a4f57'; c.lineWidth = Math.max(1, ROAD * sc * 0.8);
    for (let i = 0; i <= GRIDN; i++) {
      c.beginPath(); c.moveTo(tx(roadAt(i)), tz(-ROAD)); c.lineTo(tx(roadAt(i)), tz(TOWN + ROAD)); c.stroke();
      c.beginPath(); c.moveTo(tx(-ROAD), tz(roadAt(i))); c.lineTo(tx(TOWN + ROAD), tz(roadAt(i))); c.stroke();
    }
    for (const s of this.city.shops) {
      c.fillStyle = s.key === 'home' ? '#7fe08a' : '#8b939e';
      c.fillRect(tx(s.x0), tz(s.z0), (s.x1 - s.x0) * sc, (s.z1 - s.z0) * sc);
    }
    for (const per of this.people) {
      if (per.dead) continue;
      if (!centred && dist2(per.x, per.z, p.x, p.z) > (span / 2) ** 2) continue;
      c.fillStyle = per.kind === 'cop' ? '#5aa8ff' : per.kind === 'thug' ? '#d95c4a' : '#6e737b';
      c.fillRect(tx(per.x) - 1, tz(per.z) - 1, 2.5, 2.5);
    }
    const shop = this.taskShop;
    if (shop) {
      const t = performance.now() / 400;
      c.fillStyle = '#ffd24a';
      c.beginPath(); c.arc(tx(shop.door.x), tz(shop.door.z), 3.5 + Math.sin(t) * 1.2, 0, TAU); c.fill();
    }
    c.save();
    c.translate(tx(p.x), tz(p.z));
    c.rotate(-(this.headYaw === undefined ? p.yaw : this.headYaw) + Math.PI);
    c.fillStyle = '#fff';
    c.beginPath(); c.moveTo(0, -5); c.lineTo(3.6, 4); c.lineTo(0, 2); c.lineTo(-3.6, 4); c.fill();
    c.restore();
    c.strokeStyle = 'rgba(255,255,255,0.25)'; c.lineWidth = 1; c.strokeRect(0.5, 0.5, W - 1, H - 1);
  }

  // -------------------------------------------------------------- loop ---
  frame(now) {
    if (this.vr && this.vr.active) return;      // the XR loop is driving
    requestAnimationFrame(this.frame);
    let dt = (now - this.lastT) / 1000;
    this.lastT = now;
    if (dt > 0.1) dt = 0.1;
    if (this.menu && this.menu.isOpen) {
      if (this.menu.screen !== 'pause') {
        this.menu.updateBackground(dt);
        this.updateWorld(dt);              // the town carries on behind the menu
      }
      this.render();
      return;
    }
    if (this.paused) { this.render(); return; }

    this.updatePlayer(dt);
    this.updateErrand(dt);
    this.updateWorld(dt);
    this.audio.setListener(this.player.x, this.player.z, this.player.yaw);
    this.render();
    this.updateHUD(dt);
  }
}

const STREAM_SPEED = 7.6;      // metres per second out of the gate
const STREAM_REACH = 9;        // furthest anyone can be and still get caught

// The gesture has exactly one thing to say.
const TAUNT_LINE = 'Fuck you.';

const BLOCKW = PITCH - ROAD;
const FACE_M = mat4.create();
function hex(h) {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const INTRO_HTML = `
<p>A week of errands in a town that is having a bad week of its own.</p>
<p>Work down the list. How you get it done is between you and the list.</p>
<div class="keys">
  <div><b>WASD</b> move</div><div><b>SHIFT</b> sprint</div>
  <div><b>MOUSE</b> look</div><div><b>LMB</b> attack</div>
  <div><b>RMB</b> zoom</div><div><b>E</b> (hold) do the errand</div>
  <div><b>1-4</b> weapon</div><div><b>R</b> reload</div>
  <div><b>5</b> piss</div><div><b>Q / WHEEL</b> cycle</div>
  <div><b>F</b> flip them off</div><div><b>ESC</b> pause</div>
  <div><b>SPACE</b> jump</div><div><b>CTRL</b> crouch</div>
  <div><b>TAB</b> big map</div><div><b>V</b> mute voices</div>
</div>`;

const PAUSE_HTML = INTRO_HTML;
