/**
 * Persistence. The only module that touches localStorage.
 *
 * Everything the session knows lives here, on the user's device -- no relay
 * holds any of it. The interface is deliberately small (get/set/remove/keys) so
 * a different backend can be dropped in later without the engine noticing; the
 * v1.5 user profile is meant to become another key beside the session.
 *
 * Two backends ship now: localStorage, and memory for the session-only key mode
 * where the API key must not survive a refresh.
 */

export const STORAGE_VERSION = 1;
const PREFIX = "tarot:";

/** localStorage throws in some privacy modes; find that out once, up front. */
function localStorageIfUsable() {
  try {
    const probe = `${PREFIX}__probe`;
    globalThis.localStorage.setItem(probe, "1");
    globalThis.localStorage.removeItem(probe);
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/** A Storage-shaped object backed by a Map, for session-only mode. */
export function memoryBackend() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

export function makeStorage(backend = localStorageIfUsable() ?? memoryBackend()) {
  const full = (key) => `${PREFIX}${key}`;

  return {
    /** Whether values will outlive a refresh. The key UI needs to say which. */
    get persistent() {
      return backend === globalThis.localStorage;
    },

    /**
     * Returns null for anything missing, corrupt, or written by a schema
     * version this build does not understand -- a stale session should start a
     * new reading, not crash one.
     */
    get(key, fallback = null) {
      const raw = backend.getItem(full(key));
      if (raw === null) return fallback;
      try {
        const wrapper = JSON.parse(raw);
        if (wrapper?.v !== STORAGE_VERSION) return fallback;
        return wrapper.data;
      } catch {
        return fallback;
      }
    },

    set(key, value) {
      try {
        backend.setItem(full(key), JSON.stringify({ v: STORAGE_VERSION, data: value }));
        return true;
      } catch {
        return false; // quota, or a backend that refuses writes
      }
    },

    remove(key) {
      backend.removeItem(full(key));
    },

    /** Only this app's keys, un-prefixed. */
    keys() {
      const out = [];
      for (let i = 0; i < backend.length; i += 1) {
        const k = backend.key(i);
        if (k?.startsWith(PREFIX)) out.push(k.slice(PREFIX.length));
      }
      return out;
    },

    clearAll() {
      this.keys().forEach((k) => this.remove(k));
    },
  };
}
