// Server-side copy of the region content (content/regions/<id>.json).
// The rubric, guard list and offline keyword groups are read from here, never from the client.
// Files are re-read whenever their mtime (or size) changes, so content can be edited while the server runs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Region ids double as file names: keep them to a safe character set (no dots, no slashes).
export const REGION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function isValidRegionId(id) {
  return typeof id === 'string' && REGION_ID_RE.test(id);
}

export function defaultRegionsDir(env = process.env) {
  return env.REGIONS_DIR ? path.resolve(env.REGIONS_DIR) : path.join(ROOT, 'content', 'regions');
}

export function createRegionStore({ dir = defaultRegionsDir(), logger = console } = {}) {
  const cache = new Map(); // id -> { mtimeMs, size, region }

  function load(id, file, st) {
    const hit = cache.get(id);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.region;
    let region;
    try {
      region = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!region || typeof region !== 'object' || Array.isArray(region)) throw new Error('not a JSON object');
    } catch (err) {
      // A half-saved edit should not take the region down: keep serving the last good copy.
      logger.warn?.(`[regions] could not load ${path.basename(file)}: ${err.message}${hit ? ' (keeping the previous version)' : ''}`);
      return hit ? hit.region : null;
    }
    if (typeof region.id !== 'string' || !region.id) region.id = id;
    cache.set(id, { mtimeMs: st.mtimeMs, size: st.size, region });
    return region;
  }

  function getRegion(id) {
    if (!isValidRegionId(id)) return null;
    const file = path.join(dir, `${id}.json`);
    let st;
    try {
      st = fs.statSync(file);
    } catch {
      cache.delete(id);
      return null;
    }
    if (!st.isFile()) return null;
    return load(id, file, st);
  }

  function listRegions() {
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      return [];
    }
    return names
      .filter((n) => n.endsWith('.json'))
      .map((n) => n.slice(0, -5))
      .filter(isValidRegionId)
      .sort()
      .map(getRegion)
      .filter(Boolean);
  }

  return { dir, getRegion, listRegions };
}

// Small helpers shared by the routes.
export function findChallenge(region, challengeId) {
  if (!region) return null;
  const c = (Array.isArray(region.challenges) ? region.challenges : []).find((x) => x && x.id === challengeId);
  if (c) return c;
  // Fundamentals (basic concepts) of kind "explain" are graded like explain challenges; their authored
  // "wrong" lines play the part of an explain challenge's "retry" lines.
  const f = (Array.isArray(region.fundamentals) ? region.fundamentals : []).find((x) => x && x.id === challengeId);
  if (!f || !f.check || f.check.kind !== 'explain') return f ? { ...f, type: 'fundamental' } : null;
  return {
    id: f.id, type: 'explain', giver: f.giver, title: f.title,
    question: f.check.question, rubric: f.check.rubric, passBar: f.check.passBar, offline: f.check.offline,
    retry: f.wrong, success: f.success,
  };
}

// The inhabitant (or station) that gives a challenge: { name, species, role }.
export function findSpeaker(region, giverId) {
  const who = (region?.inhabitants || []).find((i) => i && i.id === giverId);
  if (who) return { name: who.name || who.id, species: who.species || null, role: who.role || null };
  const station = (region?.stations || []).find((s) => s && s.id === giverId);
  if (station) return { name: station.label || station.id, species: null, role: station.look || null };
  return { name: 'the villager', species: null, role: null };
}
