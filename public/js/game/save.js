// Save game in localStorage. Every read/write is guarded (private mode, blocked storage).
const KEY = 'etl-save-v1';

export function emptySave() {
  return {
    version: 1,
    character: null,          // character params (see docs/ARCHITECTURE.md)
    introSeen: false,         // Grumm's first rant
    currentTask: null,        // region id Grumm sent you to
    regions: {},              // id -> { arrived, solved: { challengeId: true }, talked: { npcId: true }, artefact: bool, returned: bool }
    artefacts: [],            // artefact ids carried or delivered
    learned: {},              // conceptId -> { title, record, region, at }  (the book's Learned pages)
    endingSeen: false,
  };
}

let cache = null;

export function getSave() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? { ...emptySave(), ...JSON.parse(raw) } : emptySave();
    cache.learned = cache.learned || {};
  } catch {
    cache = emptySave();
  }
  return cache;
}

export function updateSave(mutator) {
  const s = getSave();
  mutator(s);
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable: keep in memory */ }
  return s;
}

export function regionState(id) {
  const s = getSave();
  // fill in anything missing (older or hand-edited saves)
  s.regions[id] = { arrived: false, artefact: false, returned: false, ...(s.regions[id] || {}) };
  const rs = s.regions[id];
  if (!rs.solved || typeof rs.solved !== 'object') rs.solved = {};
  if (!rs.talked || typeof rs.talked !== 'object') rs.talked = {};
  return rs;
}

export function isLearned(concept) {
  return !!getSave().learned?.[concept];
}

export function learn(concept, entry) {
  return updateSave((s) => {
    s.learned = s.learned || {};
    if (!s.learned[concept]) s.learned[concept] = { ...entry, at: new Date().toISOString() };
  });
}

export function resetSave() {
  cache = emptySave();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  return cache;
}
