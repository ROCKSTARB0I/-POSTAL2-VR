// Front end: a menu that sits over the living town, with difficulty, options
// and the pause screen. Keyboard and mouse both work.
import { DIFFICULTIES, GORE_LEVELS, difficultyById, saveSettings, loadSave, clearSave } from './settings.js';
import { DAYS } from './errands.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Menu {
  constructor(game) {
    this.g = game;
    this.root = document.getElementById('menu');
    this.body = document.getElementById('menuBody');
    this.foot = document.getElementById('menuFoot');
    this.titleEl = document.getElementById('menuTitle');
    this.screen = 'main';
    this.index = 0;
    this.isOpen = false;
    this.pendingMode = 'flat';
    this.vrSupported = false;
    this.vrApi = !!navigator.xr;
    import('./vr.js').then(m => m.VR.supported()).then(ok => {
      this.vrSupported = ok;
      if (this.isOpen) this.render();
    }).catch(() => { });
    this.orbit = Math.random() * Math.PI * 2;
    this.shot = null;

    this.body.addEventListener('mousemove', e => {
      const row = e.target.closest('[data-i]');
      if (row) { this.index = +row.dataset.i; this.paint(); }
    });
    this.body.addEventListener('mousedown', e => {
      e.stopPropagation();
      const row = e.target.closest('[data-i]');
      if (!row) return;
      this.index = +row.dataset.i;
      const item = this.items()[this.index];
      if (!item) return;
      // clicking the right half of a slider nudges it up, left half down
      if (item.kind === 'range' || item.kind === 'cycle' || item.kind === 'toggle') {
        const r = row.getBoundingClientRect();
        this.adjust(e.clientX > r.left + r.width * 0.5 ? 1 : -1);
      } else {
        this.activate(item);
      }
    });
  }

  // ---------------------------------------------------------------- state --
  open(screen) {
    this.screen = screen || 'main';
    this.index = 0;
    this.isOpen = true;
    this.root.classList.remove('hidden');
    document.body.classList.add('menu-open');
    this.render();
  }

  close() {
    this.isOpen = false;
    this.root.classList.add('hidden');
    document.body.classList.remove('menu-open');
  }

  back() {
    if (this.screen === 'main') return;
    if (this.screen === 'pause') { this.g.resumeFromPause(); return; }
    this.open(this.g.started && !this.g.over ? 'pause' : 'main');
  }

  // ---------------------------------------------------------------- items --
  items() {
    const g = this.g, s = g.settings;
    switch (this.screen) {
      case 'main': {
        const save = loadSave();
        const list = [];
        if (save) {
          list.push({
            label: 'CONTINUE',
            note: `${DAYS[save.day] ? DAYS[save.day].name : 'MONDAY'} · $${save.cash} · ${difficultyById(save.difficulty).name}`,
            act: () => { this.pendingMode = 'flat'; g.continueSaved(save); },
          });
        }
        list.push({
          label: 'NEW WEEK', note: 'start Monday from scratch',
          act: () => { this.pendingMode = 'flat'; this.open('difficulty'); },
        });
        if (this.vrSupported) {
          list.push({
            label: 'PLAY IN VR', note: 'headset, motion controllers, tracked hands',
            act: () => { this.pendingMode = 'vr'; this.open('difficulty'); },
          });
        } else if (this.vrApi) {
          list.push({ label: 'PLAY IN VR', note: 'no headset detected', disabled: true });
        }
        if (this.vrSupported || this.vrApi) {
          list.push({
            label: 'VR CONTROLS', note: 'controller and hand bindings',
            act: () => this.open('vrcontrols'),
          });
        }
        list.push({
          label: 'DIFFICULTY', kind: 'static',
          note: difficultyById(s.difficulty).name,
          act: () => { this.pendingMode = 'flat'; this.open('difficulty'); },
        });
        list.push({ label: 'OPTIONS', act: () => this.open('options') });
        list.push({ label: 'CONTROLS', act: () => this.open('controls') });
        if (save) list.push({ label: 'ERASE SAVE', note: 'wipe the week', act: () => { clearSave(); this.render(); } });
        return list;
      }
      case 'difficulty':
        return DIFFICULTIES.map(d => ({
          label: d.name,
          note: d.blurb,
          selected: s.difficulty === d.id,
          act: () => {
            s.difficulty = d.id;
            saveSettings(s);
            g.applySettings();
            if (g.started && !g.over) { this.open('pause'); return; }
            g.startNewWeek({ vr: this.pendingMode === 'vr' });
          },
        })).concat([{ label: 'BACK', act: () => this.back() }]);
      case 'options':
        return [
          { label: 'VOICES', kind: 'toggle', get: () => s.voices, set: v => { s.voices = v; } },
          { label: 'GORE', kind: 'cycle', opts: GORE_LEVELS, get: () => s.gore, set: v => { s.gore = v; } },
          { label: 'VOLUME', kind: 'range', min: 0, max: 1, step: 0.05, get: () => s.volume, set: v => { s.volume = v; } },
          { label: 'SENSITIVITY', kind: 'range', min: 0.3, max: 2.5, step: 0.1, get: () => s.sensitivity, set: v => { s.sensitivity = v; } },
          {
            label: 'FIELD OF VIEW', kind: 'range', min: 1.0, max: 1.75, step: 0.05,
            get: () => s.fov, set: v => { s.fov = v; },
            fmt: v => Math.round(v * 180 / Math.PI) + '°',
          },
          { label: 'INVERT LOOK', kind: 'toggle', get: () => s.invertY, set: v => { s.invertY = v; } },
          { label: 'VIEW BOB', kind: 'toggle', get: () => s.viewBob, set: v => { s.viewBob = v; } },
          { label: 'BACK', act: () => this.back() },
        ];
      case 'controls':
      case 'vrcontrols':
        return [{ label: 'BACK', act: () => this.back() }];
      case 'pause':
        return [
          { label: 'RESUME', act: () => this.g.resumeFromPause() },
          { label: 'DIFFICULTY', kind: 'static', note: difficultyById(s.difficulty).name, act: () => this.open('difficulty') },
          { label: 'OPTIONS', act: () => this.open('options') },
          { label: 'CONTROLS', act: () => this.open('controls') },
          { label: 'ABANDON WEEK', note: 'back to the main menu', act: () => this.g.toMainMenu() },
        ];
      case 'over':
        return [
          { label: 'NEW WEEK', act: () => this.open('difficulty') },
          { label: 'MAIN MENU', act: () => this.g.toMainMenu() },
        ];
      default:
        return [];
    }
  }

  // --------------------------------------------------------------- render --
  render() {
    const g = this.g;
    const titles = {
      main: '', difficulty: 'HOW BAD A WEEK', options: 'OPTIONS',
      controls: 'CONTROLS', vrcontrols: 'VR CONTROLS',
      pause: 'PAUSED', over: g.over ? g.over.title : '',
    };
    this.titleEl.classList.toggle('big', this.screen === 'main');
    if (this.screen === 'difficulty') {
      titles.difficulty = this.pendingMode === 'vr' ? 'HOW BAD A WEEK · VR' : 'HOW BAD A WEEK';
    }
    this.titleEl.innerHTML = this.screen === 'main'
      ? '<span class="t1">POSTAL</span><span class="t2">2</span><em>PARADISE, ARIZONA</em>'
      : `<span class="t3">${titles[this.screen] || ''}</span>`;

    let head = '';
    if (this.screen === 'over' && g.over) head = `<div class="over-body">${g.over.body}</div>`;
    if (this.screen === 'controls') head = CONTROLS_HTML;
    if (this.screen === 'vrcontrols') head = VR_CONTROLS_HTML;
    if (this.screen === 'main') head = '<p class="tagline">A week of errands in a town having a worse week than you.</p>';

    const rows = this.items().map((it, i) => this.rowHTML(it, i)).join('');
    this.body.innerHTML = head + '<div class="rows">' + rows + '</div>';
    this.paint();
    this.foot.textContent = this.screen === 'main'
      ? '↑↓ MOVE · ENTER SELECT'
      : '↑↓ MOVE · ←→ CHANGE · ENTER SELECT · ESC BACK';
  }

  rowHTML(it, i) {
    let right = '';
    if (it.kind === 'toggle') right = `<b>${it.get() ? 'ON' : 'OFF'}</b>`;
    else if (it.kind === 'cycle') right = `<b>${it.get()}</b>`;
    else if (it.kind === 'range') {
      const t = (it.get() - it.min) / (it.max - it.min);
      const filled = Math.round(t * 12);
      right = `<span class="meter">${'▮'.repeat(filled)}${'▯'.repeat(12 - filled)}</span>` +
        `<b>${it.fmt ? it.fmt(it.get()) : Math.round(it.get() * 100) + '%'}</b>`;
    } else if (it.note && it.kind === 'static') right = `<b>${it.note}</b>`;
    const note = it.note && it.kind !== 'static' ? `<em>${it.note}</em>` : '';
    const sel = (it.selected ? ' selected' : '') + (it.disabled ? ' disabled' : '');
    return `<div class="row${sel}" data-i="${i}"><span class="lbl">${it.label}</span>${note}<span class="val">${right}</span></div>`;
  }

  paint() {
    const rows = this.body.querySelectorAll('.row');
    rows.forEach((r, i) => r.classList.toggle('on', i === this.index));
  }

  // ----------------------------------------------------------------- input --
  key(e) {
    const items = this.items();
    if (!items.length) return;
    switch (e.code) {
      case 'ArrowUp': case 'KeyW':
        this.index = (this.index - 1 + items.length) % items.length; this.paint(); break;
      case 'ArrowDown': case 'KeyS':
        this.index = (this.index + 1) % items.length; this.paint(); break;
      case 'ArrowLeft': case 'KeyA': this.adjust(-1); break;
      case 'ArrowRight': case 'KeyD': this.adjust(1); break;
      case 'Enter': case 'Space': case 'NumpadEnter':
        this.activate(items[this.index]); break;
      case 'Escape': this.back(); break;
      default: return;
    }
    e.preventDefault();
  }

  activate(item) {
    if (!item || item.disabled) return;
    if (item.act) { this.g.audio.ding(); item.act(); return; }
    if (item.kind) this.adjust(1);
  }

  adjust(dir) {
    const it = this.items()[this.index];
    if (!it) return;
    if (it.kind === 'toggle') it.set(!it.get());
    else if (it.kind === 'cycle') {
      const i = it.opts.indexOf(it.get());
      it.set(it.opts[(i + dir + it.opts.length) % it.opts.length]);
    } else if (it.kind === 'range') {
      it.set(+clamp(it.get() + dir * it.step, it.min, it.max).toFixed(2));
    } else return;
    saveSettings(this.g.settings);
    this.g.applySettings();
    this.render();
  }

  // ------------------------------------------------------------ backdrop --
  // Slow orbit of a street corner while the town carries on without you.
  updateBackground(dt) {
    const g = this.g;
    if (!this.target) {
      const mall = g.city.shopByKey('mall');
      this.target = { x: mall.cx, z: mall.cz };
    }
    this.orbit += dt * 0.055;
    const r = 34, h = 9.5;
    const cx = this.target.x + Math.cos(this.orbit) * r;
    const cz = this.target.z + Math.sin(this.orbit) * r;
    g.camX = cx; g.camY = h; g.camZ = cz;
    g.camYaw = Math.atan2(cx - this.target.x, cz - this.target.z);
    g.camPitch = -0.16;
  }
}

const VR_CONTROLS_HTML = `
<div class="keys vr">
  <div><b>LEFT STICK</b> move, relative to where you look</div>
  <div><b>RIGHT STICK</b> snap turn</div>
  <div><b>LEFT GRIP</b> sprint (burns stamina)</div>
  <div><b>RIGHT TRIGGER</b> attack</div>
  <div><b>RIGHT GRIP</b> reload</div>
  <div><b>A</b> (hold) do the errand</div>
  <div><b>B</b> flip them off</div>
  <div><b>X</b> cycle weapon</div>
</div>
<p class="tagline">
  You aim with your right hand, not your head &mdash; the shot goes where the
  gun points. Your left wrist carries the map, health and stamina; your right
  wrist carries the list. Turn a wrist towards your face to read it.
</p>
<p class="tagline dim">
  If your headset reports hand tracking, your real hands are drawn joint by
  joint. Otherwise you get jointed hands that curl with the trigger and grip.
</p>`;

const CONTROLS_HTML = `
<div class="keys">
  <div><b>WASD</b> move</div><div><b>SHIFT</b> sprint</div>
  <div><b>MOUSE</b> look</div><div><b>ARROWS</b> look (no mouse lock)</div>
  <div><b>LMB</b> attack</div><div><b>RMB</b> zoom</div>
  <div><b>E</b> (hold) do the errand</div><div><b>F</b> flip them off</div>
  <div><b>1-4</b> weapons</div><div><b>5</b> piss</div>
  <div><b>Q / WHEEL</b> cycle weapon</div><div><b>R</b> reload</div>
  <div><b>SPACE</b> jump</div><div><b>CTRL</b> crouch</div>
  <div><b>TAB / M</b> big map</div><div><b>V</b> mute voices</div>
  <div><b>ESC</b> pause</div><div></div>
</div>`;
