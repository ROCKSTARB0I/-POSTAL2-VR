// Difficulty table, player options, and the one save slot. All of it lives in
// localStorage so the week survives a reload.

export const DIFFICULTIES = [
  {
    id: 'errand',
    name: 'ERRAND BOY',
    blurb: 'The town is in a good mood. Nobody shoots straight and the police have paperwork.',
    dmgTaken: 0.5, enemyAcc: 0.6, heatGain: 0.55, copRate: 1, heatDecay: 1.8,
    startCash: 140, healMul: 1.4, lives: 6,
  },
  {
    id: 'regular',
    name: 'REGULAR GUY',
    blurb: 'An ordinary week in Paradise. Errands, queues, and the occasional incident.',
    dmgTaken: 1, enemyAcc: 1, heatGain: 1, copRate: 2, heatDecay: 1,
    startCash: 60, healMul: 1, lives: 4,
  },
  {
    id: 'badweek',
    name: 'BAD WEEK',
    blurb: 'Everyone woke up annoyed. They aim better and they call it in faster.',
    dmgTaken: 1.4, enemyAcc: 1.25, heatGain: 1.35, copRate: 2.5, heatDecay: 0.8,
    startCash: 40, healMul: 0.85, lives: 3,
  },
  {
    id: 'famous',
    name: 'LOCALLY FAMOUS',
    blurb: 'Word has got round about you. The response time is now excellent.',
    dmgTaken: 1.9, enemyAcc: 1.45, heatGain: 1.7, copRate: 3.2, heatDecay: 0.6,
    startCash: 20, healMul: 0.7, lives: 2,
  },
  {
    id: 'hated',
    name: 'EVERYBODY HATES YOU',
    blurb: 'One week. One life. The whole town has your description.',
    dmgTaken: 2.6, enemyAcc: 1.7, heatGain: 2.1, copRate: 4, heatDecay: 0.45,
    startCash: 0, healMul: 0.55, lives: 1,
  },
];

export const GORE_LEVELS = ['FULL', 'REDUCED', 'OFF'];

const SETTINGS_KEY = 'postal2.settings.v1';
const SAVE_KEY = 'postal2.save.v1';

export const DEFAULT_SETTINGS = {
  difficulty: 'regular',
  sensitivity: 1.0,
  volume: 0.55,
  voices: true,
  gore: 'FULL',
  invertY: false,
  fov: 1.28,
  viewBob: true,
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const got = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    delete got.voiceMode;
    if (typeof got.voices !== 'boolean') got.voices = true;
    return got;
  } catch (e) {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { }
}

export function difficultyById(id) {
  return DIFFICULTIES.find(d => d.id === id) || DIFFICULTIES[1];
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function writeSave(data) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch (e) { }
}

export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { }
}
