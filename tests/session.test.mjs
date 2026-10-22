import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createResilientStorage,
  createSessionRetry,
  isAnonPermissionError,
} from '../src/session.js';

test('a session survives a webview storage that accepts writes but loses them', () => {
  const lossy = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const storage = createResilientStorage(() => lossy);
  storage.setItem('sb-auth', 'session-a');
  assert.equal(storage.getItem('sb-auth'), 'session-a');
});

test('a session survives another webview instance clearing the shared storage', () => {
  const shared = new Map();
  const local = {
    getItem: (key) => shared.get(key) ?? null,
    setItem: (key, value) => shared.set(key, value),
    removeItem: (key) => shared.delete(key),
  };
  const storage = createResilientStorage(() => local);
  storage.setItem('sb-auth', 'session-a');
  shared.clear();
  assert.equal(storage.getItem('sb-auth'), 'session-a');
});

test('stored values still win while browser storage works, and removal clears both copies', () => {
  const shared = new Map();
  const local = {
    getItem: (key) => shared.get(key) ?? null,
    setItem: (key, value) => shared.set(key, value),
    removeItem: (key) => shared.delete(key),
  };
  const storage = createResilientStorage(() => local);
  storage.setItem('sb-auth', 'session-a');
  shared.set('sb-auth', 'session-rotated-by-another-tab');
  assert.equal(storage.getItem('sb-auth'), 'session-rotated-by-another-tab');
  storage.removeItem('sb-auth');
  assert.equal(storage.getItem('sb-auth'), null);
  assert.equal(shared.has('sb-auth'), false);
});

test('blocked browser storage (access throws) falls back to memory', () => {
  const storage = createResilientStorage(() => { throw new Error('SecurityError'); });
  storage.setItem('sb-auth', 'session-a');
  assert.equal(storage.getItem('sb-auth'), 'session-a');
  storage.removeItem('sb-auth');
  assert.equal(storage.getItem('sb-auth'), null);
});

test('only anon permission failures are treated as a lost session', () => {
  assert.equal(isAnonPermissionError({ code: '42501', message: 'permission denied for function trip_room_status' }), true);
  assert.equal(isAnonPermissionError({ message: 'permission denied for table trip_players' }), true);
  assert.equal(isAnonPermissionError({ message: 'DRAW_NOT_HOST' }), false);
  assert.equal(isAnonPermissionError(null), false);
});

test('a request that ran without a session recovers the session and retries once', async () => {
  let recovered = 0;
  const responses = [
    { data: null, error: { code: '42501', message: 'permission denied for function trip_room_status' } },
    { data: { ok: true }, error: null },
  ];
  const authed = createSessionRetry(async () => { recovered += 1; });
  const result = await authed(async () => responses.shift());
  assert.deepEqual(result, { data: { ok: true }, error: null });
  assert.equal(recovered, 1);
});

test('parallel requests that lose the session share one recovery', async () => {
  let recovered = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const authed = createSessionRetry(async () => { recovered += 1; await gate; });
  const denied = { data: null, error: { code: '42501', message: 'permission denied for table trip_players' } };
  const make = () => { let calls = 0; return async () => (calls++ ? { data: [], error: null } : denied); };
  const both = Promise.all([authed(make()), authed(make())]);
  await new Promise((resolve) => setImmediate(resolve));
  release();
  const results = await both;
  assert.equal(recovered, 1);
  assert.deepEqual(results.map((r) => r.error), [null, null]);
});

test('other errors are returned untouched without touching the session', async () => {
  let recovered = 0;
  const authed = createSessionRetry(async () => { recovered += 1; });
  const failure = { data: null, error: { code: 'P0001', message: 'ROOM_FULL' } };
  assert.equal(await authed(async () => failure), failure);
  assert.equal(recovered, 0);
});
