// Save game in localStorage. Every read/write is guarded (private mode, blocked storage).
const KEY = 'etl-save-v1';

export function emptySave() {
  return {
    version: 1,
    character: null,          // character params (see docs/ARCHITECTURE.md)
    introSeen: false,         // the scientist's first rant
    currentTask: null,        // region id he sent you to
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
  // fill in anything missing (older or hand-edited saves), in place: scenes keep this object for the whole visit
  if (!s.regions[id] || typeof s.regions[id] !== 'object') s.regions[id] = {};
  const rs = s.regions[id];
  for (const k of ['arrived', 'artefact', 'returned']) if (typeof rs[k] !== 'boolean') rs[k] = !!rs[k];
  if (!rs.solved || typeof rs.solved !== 'object') rs.solved = {};
  if (!rs.talked || typeof rs.talked !== 'object') rs.talked = {};
  return rs;
}

// regions whose artefact Becancourt has (what the HUD's ✦ n/3 counts)
export const deliveredArtefacts = () => Object.entries(getSave().regions || {}).filter(([, r]) => r?.returned).map(([id]) => id);

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
  // the player's notes, book chat and unfinished code/explanations belong to the save too
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && /^etl-(notes|book|code|explain)-/.test(k)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch { /* storage unavailable */ }
  return cache;
}
