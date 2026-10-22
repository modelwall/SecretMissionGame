// In-app browsers (LINE, Discord, ...) sometimes lose or block localStorage.
// supabase-js then finds no session and silently sends the anon key, so every
// RPC fails with "permission denied for function ...". These helpers keep the
// session for the life of the page and recover it if a request still ran as anon.

// Browser storage stays the source of truth whenever it returns a value; the
// in-memory copy is only used when it returns nothing or cannot be accessed.
export function createResilientStorage(getLocalStorage) {
  const memory = new Map();
  const local = () => {
    try { return getLocalStorage() || null; } catch { return null; }
  };
  return {
    getItem(key) {
      try {
        const value = local()?.getItem(key);
        if (value !== null && value !== undefined) return value;
      } catch { /* Fall back to the in-memory copy. */ }
      return memory.has(key) ? memory.get(key) : null;
    },
    setItem(key, value) {
      memory.set(key, value);
      try { local()?.setItem(key, value); } catch { /* Keep the in-memory copy. */ }
    },
    removeItem(key) {
      memory.delete(key);
      try { local()?.removeItem(key); } catch { /* Nothing else to clear. */ }
    },
  };
}

// PostgREST reports a request made with the anon key as a permission error,
// because every table and RPC is granted to authenticated users only.
export function isAnonPermissionError(error) {
  return error?.code === '42501' || /permission denied for (function|table)/i.test(error?.message || '');
}

// Parallel requests share one recovery so they never sign in two new users.
export function createSessionRetry(recoverSession) {
  let recovering = null;
  const recover = () => {
    recovering ??= Promise.resolve().then(recoverSession).finally(() => { recovering = null; });
    return recovering;
  };
  return async (run) => {
    const first = await run();
    if (!isAnonPermissionError(first?.error)) return first;
    await recover();
    return run();
  };
}
