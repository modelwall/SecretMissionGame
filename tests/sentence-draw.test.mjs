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
  player_limit: 16,
  sentences_per_player: 3,
  draw_size: 3,
  total_count: 48,
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

test('the same browser reuses its room membership token when auth membership is missing', async () => {
  installBrowserStubs();
  const room = baseRoom();
  const fixture = makeController((name) => {
    if (name === 'sentence_draw_room_status') return { data: null, error: new Error('DRAW_NOT_MEMBER') };
    if (name === 'sentence_draw_join_room') return { data: room, error: null };
    throw new Error(`Unexpected RPC: ${name}`);
  });

  await fixture.controller.enter('A1B2C3D4');
  fixture.controller.leave();
  await fixture.controller.enter('A1B2C3D4');

  const tokens = fixture.calls
    .filter((call) => call.name === 'sentence_draw_join_room')
    .map((call) => call.args.p_member_token);
  assert.equal(tokens.length, 2);
  assert.match(tokens[0], /^[0-9a-f]{64}$/);
  assert.equal(tokens[1], tokens[0]);
});

test('a realtime refresh preserves unsaved sentence drafts', async () => {
  installBrowserStubs();
  let statusCalls = 0;
  const fixture = makeController((name) => {
    if (name === 'sentence_draw_room_status') {
      statusCalls += 1;
      return { data: baseRoom({ joined_count: statusCalls }), error: null };
    }
    if (name === 'sentence_draw_join_room') return { data: baseRoom({ joined_count: statusCalls }), error: null };
    throw new Error(`Unexpected RPC: ${name}`);
  });
  await fixture.controller.enter('A1B2C3D4');

  const fields = ['ประโยคที่กำลังพิมพ์', 'ยังไม่ส่ง', 'ห้ามหาย'].map((value, index) => ({
    value,
    dataset: { sentenceInput: String(index) },
  }));
  const counters = fields.map(() => ({ textContent: '' }));
  const submit = { disabled: false };
  const form = {
    querySelectorAll: () => fields,
    querySelector(selector) {
      if (selector === '[data-sentence-submit]') return submit;
      const index = Number(selector.match(/"(\d+)"/)?.[1]);
      return counters[index];
    },
  };
  fields[0].matches = () => true;
  fields[0].closest = () => form;

  fixture.controller.handleInput(fields[0]);
  await fixture.controller.refresh();

  assert.deepEqual(fixture.controller.state.mySentences, fields.map((field) => field.value));
  assert.equal(fixture.controller.state.joinedCount, 2);
  assert.match(localStorage.getItem('sentence_draw_draft:A1B2C3D4:1'), /ห้ามหาย/);
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
    if (name === 'sentence_draw_join_room') return { data: lobby, error: null };
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
    if (name === 'sentence_draw_join_room') return { data: room, error: null };
    throw new Error(`Unexpected RPC: ${name}`);
  });

  await fixture.controller.enter('A1B2C3D4');
  const html = fixture.controller.view();
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert/);
});

test('room UI follows host-selected player and sentence counts', async () => {
  installBrowserStubs();
  const room = baseRoom({
    player_limit: 5,
    sentences_per_player: 2,
    total_count: 10,
    joined_count: 3,
    submitted_count: 2,
    remaining_count: 10,
  });
  const fixture = makeController((name) => {
    if (name === 'sentence_draw_room_status') return { data: room, error: null };
    if (name === 'sentence_draw_join_room') return { data: room, error: null };
    throw new Error(`Unexpected RPC: ${name}`);
  });

  await fixture.controller.enter('A1B2C3D4');
  const html = fixture.controller.view();
  assert.equal(fixture.controller.state.playerLimit, 5);
  assert.equal(fixture.controller.state.sentencesPerPlayer, 2);
  assert.equal(fixture.controller.state.mySentences.length, 2);
  assert.match(html, /เขียน 2 ประโยคของคุณ/);
  assert.match(html, /3<small>\/5<\/small>/);
  assert.match(html, /4<small>\/10<\/small>/);
});

test('host-selected settings are sent to the create-room RPC', async () => {
  installBrowserStubs();
  const originalFormData = globalThis.FormData;
  globalThis.FormData = class {
    constructor(form) { this.values = form.values; }
    get(name) { return this.values[name] ?? null; }
    has(name) { return Boolean(this.values[name]); }
  };
  try {
    const fixture = makeController((name, args) => {
      assert.equal(name, 'sentence_draw_create_room');
      assert.deepEqual(args, {
        p_host_contributes: false,
        p_player_limit: 5,
        p_sentences_per_player: 2,
        p_draw_size: 10,
      });
      return { data: baseRoom({ player_limit: 5, sentences_per_player: 2, draw_size: 10, total_count: 10, remaining_count: 10, is_host: true, has_player: false }), error: null };
    });

    await fixture.controller.handleSubmit({
      id: 'sentence-create-form',
      values: { player_limit: '5', sentences_per_player: '2', draw_size: '10' },
    });
    assert.equal(fixture.controller.state.playerLimit, 5);
    assert.equal(fixture.controller.state.drawSize, 10);
  } finally {
    globalThis.FormData = originalFormData;
  }
});

test('a draw size larger than the room total is rejected before calling the server', async () => {
  installBrowserStubs();
  const originalFormData = globalThis.FormData;
  globalThis.FormData = class {
    constructor(form) { this.values = form.values; }
    get(name) { return this.values[name] ?? null; }
    has(name) { return Boolean(this.values[name]); }
  };
  try {
    const fixture = makeController((name) => { throw new Error(`Unexpected RPC: ${name}`); });
    await fixture.controller.handleSubmit({
      id: 'sentence-create-form',
      values: { player_limit: '5', sentences_per_player: '2', draw_size: '11' },
    });
    assert.equal(fixture.calls.length, 0);
  } finally {
    globalThis.FormData = originalFormData;
  }
});

test('room UI follows the host-selected draw size beyond three', async () => {
  installBrowserStubs();
  const room = baseRoom({
    is_host: true,
    draw_size: 5,
    joined_count: 4,
    submitted_count: 4,
    has_submitted: true,
  });
  const fixture = makeController((name) => {
    if (name === 'sentence_draw_room_status' || name === 'sentence_draw_join_room') return { data: room, error: null };
    throw new Error(`Unexpected RPC: ${name}`);
  });

  await fixture.controller.enter('A1B2C3D4');
  const html = fixture.controller.view();
  assert.equal(fixture.controller.state.drawSize, 5);
  assert.match(html, /สูงสุด 5 ใบ\/รอบ/);
  assert.match(html, /เริ่มสุ่ม 5 ประโยค/);
});

test('a round with more than three sentences renders every card with cycling tones', async () => {
  installBrowserStubs();
  const room = baseRoom({
    is_host: true,
    status: 'started',
    draw_size: 5,
    current_round: 1,
    total_count: 12,
    remaining_count: 7,
    current_sentences: [1, 2, 3, 4, 5].map((position) => ({ id: `s${position}`, position, text: `ประโยคที่เปิด ${position}` })),
  });
  const fixture = makeController((name) => {
    if (name === 'sentence_draw_room_status' || name === 'sentence_draw_join_room') return { data: room, error: null };
    throw new Error(`Unexpected RPC: ${name}`);
  });

  await fixture.controller.enter('A1B2C3D4');
  const html = fixture.controller.view();
  assert.equal(html.match(/class="sentence-reveal-card/g)?.length, 5);
  assert.doesNotMatch(html, /reveal-tone-[3-9]/);
  assert.match(html, /ประโยคที่เปิด 5/);
  assert.match(html, /สุ่มต่ออีก 5 ประโยค/);
});

test('host can start while some joined players have not submitted yet', async () => {
  installBrowserStubs();
  const room = baseRoom({
    is_host: true,
    joined_count: 4,
    submitted_count: 1,
    has_submitted: true,
  });
  const fixture = makeController((name) => {
    if (name === 'sentence_draw_room_status' || name === 'sentence_draw_join_room') return { data: room, error: null };
    throw new Error(`Unexpected RPC: ${name}`);
  });

  await fixture.controller.enter('A1B2C3D4');
  const html = fixture.controller.view();
  const drawButton = html.match(/<button[^>]*data-action="sentence-draw"[^>]*>/)?.[0] || '';
  assert.doesNotMatch(drawButton, /disabled/);
  assert.match(html, /3 ประโยค พร้อมเปิดรอบแรก/);
  assert.match(html, /ยังมี 3 คนที่ยังไม่ส่ง/);
});

test('host cannot start before anyone has submitted', async () => {
  installBrowserStubs();
  const room = baseRoom({ is_host: true, joined_count: 3, submitted_count: 0 });
  const fixture = makeController((name) => {
    if (name === 'sentence_draw_room_status' || name === 'sentence_draw_join_room') return { data: room, error: null };
    throw new Error(`Unexpected RPC: ${name}`);
  });

  await fixture.controller.enter('A1B2C3D4');
  const html = fixture.controller.view();
  const drawButton = html.match(/<button[^>]*data-action="sentence-draw"[^>]*>/)?.[0] || '';
  assert.match(drawButton, /disabled/);
});

test('players who have not submitted are warned that the host may start early', async () => {
  installBrowserStubs();
  const room = baseRoom({ joined_count: 3, submitted_count: 1 });
  const fixture = makeController((name) => {
    if (name === 'sentence_draw_room_status' || name === 'sentence_draw_join_room') return { data: room, error: null };
    throw new Error(`Unexpected RPC: ${name}`);
  });

  await fixture.controller.enter('A1B2C3D4');
  assert.match(fixture.controller.view(), /โฮสต์เริ่มเกมได้ทุกเมื่อ/);
});

test('host can start early when at least two joined players have all submitted', async () => {
  installBrowserStubs();
  const room = baseRoom({
    is_host: true,
    player_limit: 16,
    sentences_per_player: 2,
    total_count: 32,
    joined_count: 2,
    submitted_count: 2,
    remaining_count: 32,
    has_submitted: true,
  });
  const fixture = makeController((name) => {
    if (name === 'sentence_draw_room_status') return { data: room, error: null };
    if (name === 'sentence_draw_join_room') return { data: room, error: null };
    throw new Error(`Unexpected RPC: ${name}`);
  });

  await fixture.controller.enter('A1B2C3D4');
  const html = fixture.controller.view();
  assert.match(html, /4 ประโยค พร้อมเปิดรอบแรก/);
  const drawButton = html.match(/<button[^>]*data-action="sentence-draw"[^>]*>/)?.[0] || '';
  assert.doesNotMatch(drawButton, /disabled/);
  assert.match(html, /รอเพิ่มอีกสูงสุด 14 คน/);
});
