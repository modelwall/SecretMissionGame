import test from 'node:test';
import assert from 'node:assert/strict';
import { createSentenceDraw } from '../src/sentence-draw.js';

const baseRoom = (overrides = {}) => ({
  id: '11111111-1111-1111-1111-111111111111',
  code: 'A1B2C3D4',
  status: 'lobby',
  generation: 1,
  is_host: false,
  has_player: true,
  has_submitted: false,
  joined_count: 1,
  submitted_count: 0,
  current_round: 0,
  remaining_count: 48,
  my_sentences: [],
  current_sentences: [],
  history: [],
  ...overrides,
});

function installBrowserStubs() {
  globalThis.location = new URL('http://localhost/?mode=sentences&room=A1B2C3D4');
  globalThis.history = {
    replaceState(_state, _title, value) { globalThis.location = new URL(value, globalThis.location); },
  };
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

function makeController(rpc) {
  const calls = [];
  const db = {
    async rpc(name, args) { calls.push({ name, args }); return rpc(name, args, calls); },
    channel() {
      return {
        on() { return this; },
        subscribe() { return this; },
      };
    },
    removeChannel() {},
  };
  let renders = 0;
  const controller = createSentenceDraw({
    db,
    safe: (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    icon: (name) => `<i>${name}</i>`,
    header: (title) => `<header>${title}</header>`,
    modeNav: (mode) => `<nav>${mode}</nav>`,
    codeOnly: (value) => String(value ?? '').toUpperCase().replace(/[^0-9A-F]/g, '').slice(0, 8),
    onRender: () => { renders += 1; },
    toast: () => {},
    errorMessage: (error) => error?.message || String(error),
  });
  return { controller, calls, get renders() { return renders; } };
}

test('new visitor joins by code after the private status RPC rejects non-members', async () => {
  installBrowserStubs();
  const room = baseRoom();
  const fixture = makeController((name) => {
    if (name === 'sentence_draw_room_status') return { data: null, error: new Error('DRAW_NOT_MEMBER') };
    if (name === 'sentence_draw_join_room') return { data: room, error: null };
    throw new Error(`Unexpected RPC: ${name}`);
  });

  await fixture.controller.enter('a1b2-c3d4');

  assert.deepEqual(fixture.calls.map((call) => call.name), [
    'sentence_draw_room_status', 'sentence_draw_join_room',
  ]);
  assert.equal(fixture.controller.state.roomCode, 'A1B2C3D4');
  assert.match(fixture.controller.view(), /เขียน 3 ประโยคของคุณ/);
  assert.equal(localStorage.getItem('sentence_draw_room_code'), 'A1B2C3D4');
});

test('host draw sends the persisted expected round and renders the shared three-card result', async () => {
  installBrowserStubs();
  const lobby = baseRoom({
    is_host: true, joined_count: 16, submitted_count: 16,
    has_submitted: true,
    my_sentences: [
      { slot: 1, text: 'ของฉันหนึ่ง' },
      { slot: 2, text: 'ของฉันสอง' },
      { slot: 3, text: 'ของฉันสาม' },
    ],
  });
  const roundOne = baseRoom({
    ...lobby,
    status: 'started', current_round: 1, remaining_count: 45,
    current_sentences: [
      { id: 's1', position: 1, text: 'ประโยคเปิดเผยหนึ่ง' },
      { id: 's2', position: 2, text: 'ประโยคเปิดเผยสอง' },
      { id: 's3', position: 3, text: 'ประโยคเปิดเผยสาม' },
    ],
  });
  let statusCalls = 0;
  const fixture = makeController((name, args) => {
    if (name === 'sentence_draw_room_status') {
      statusCalls += 1;
      return { data: lobby, error: null };
    }
    if (name === 'sentence_draw_draw') {
      assert.equal(args.p_expected_round, 0);
      assert.equal(args.p_code, 'A1B2C3D4');
      return { data: roundOne, error: null };
    }
    throw new Error(`Unexpected RPC: ${name}`);
  });

  await fixture.controller.enter('A1B2C3D4');
  assert.equal(statusCalls, 1);
  await fixture.controller.handleClick('sentence-draw');

  const html = fixture.controller.view();
  assert.equal(fixture.controller.state.currentRound, 1);
  assert.equal(fixture.controller.state.remainingCount, 45);
  assert.match(html, /รอบที่ 1/);
  assert.match(html, /ประโยคเปิดเผยหนึ่ง/);
  assert.match(html, /ประโยคเปิดเผยสอง/);
  assert.match(html, /ประโยคเปิดเผยสาม/);
});

test('HTML from sentence text is escaped in private and revealed views', async () => {
  installBrowserStubs();
  const room = baseRoom({
    status: 'started', current_round: 1, remaining_count: 45,
    current_sentences: [{ id: 'x', position: 1, text: '<script>alert(1)</script>' }],
  });
  const fixture = makeController((name) => {
    if (name === 'sentence_draw_room_status') return { data: room, error: null };
    throw new Error(`Unexpected RPC: ${name}`);
  });

  await fixture.controller.enter('A1B2C3D4');
  const html = fixture.controller.view();
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert/);
});
