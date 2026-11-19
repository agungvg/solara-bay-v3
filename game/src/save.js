// Solara Bay — save.js (v3 rewrite)
// One small localStorage slot for the player's progress. Every read and
// write is guarded: private mode and some embedded browsers throw on
// localStorage access, and a corrupt or hand-edited save must never crash
// the boot — it just reads as "no save".
//
// The shape written to disk is:
//   { money, missionIndex, playerPos: { x, y, z }, wanted, health, savedAt }

const SAVE_KEY = 'solara-bay-save-v3';

// How each field is cleaned. A field that fails its check falls back to
// its default instead of failing the whole save.
const SCHEMA = {
  money:        { fallback: 0,   scrub: (v) => Number.isFinite(v) ? v : 0 },
  missionIndex: { fallback: 0,   scrub: (v) => Number.isFinite(v) ? Math.floor(v) : 0 },
  wanted:       { fallback: 0,   scrub: (v) => Number.isFinite(v) ? Math.max(0, Math.min(5, Math.floor(v))) : 0 },
  health:       { fallback: 100, scrub: (v) => Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 100 },
};

function scrubNumber(raw, rule) {
  if (raw === null || raw === undefined || typeof raw !== 'number') return rule.fallback;
  return rule.scrub(raw);
}

function scrubPos(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const axis = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return { x: axis(src.x), y: axis(src.y), z: axis(src.z) };
}

// Turn any caller-supplied object (or a parsed save) into a clean,
// complete save record. Unknown extra keys are dropped. When keepStamp is
// set, a valid savedAt from the input is preserved instead of stamped
// with "now" — loading a save should not rewrite its timestamp.
function sanitize(input, keepStamp) {
  const src = input && typeof input === 'object' ? input : {};
  const out = {};
  for (const key of Object.keys(SCHEMA)) {
    out[key] = scrubNumber(src[key], SCHEMA[key]);
  }
  out.playerPos = scrubPos(src.playerPos);
  const priorStamp = typeof src.savedAt === 'number' && Number.isFinite(src.savedAt) ? src.savedAt : 0;
  out.savedAt = keepStamp && priorStamp > 0 ? priorStamp : Date.now();
  return out;
}

function storeUsable() {
  try {
    if (typeof localStorage === 'undefined' || localStorage === null) return false;
    return true;
  } catch (err) {
    return false;
  }
}

export function createSave() {
  function save(record) {
    if (!storeUsable()) return false;
    let ok = false;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(sanitize(record)));
      ok = true;
    } catch (err) {
      ok = false;
    }
    return ok;
  }

  function load() {
    if (!storeUsable()) return null;
    try {
      const text = localStorage.getItem(SAVE_KEY);
      if (!text) return null;
      const data = JSON.parse(text);
      if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
      return sanitize(data, true);
    } catch (err) {
      return null; // unreadable or corrupt JSON counts as no save
    }
  }

  function hasSave() {
    // A broken save is the same as no save — prove it by loading.
    const record = load();
    return record !== null;
  }

  function clear() {
    if (!storeUsable()) return false;
    let ok = false;
    try {
      localStorage.removeItem(SAVE_KEY);
      ok = true;
    } catch (err) {
      ok = false;
    }
    return ok;
  }

  const api = { save, load, hasSave, clear };
  return api;
}

// The key itself is exported too, so the integrator can show a
// "continue" affordance without guessing the slot name.
export const SAVE_STORAGE_KEY = SAVE_KEY;
