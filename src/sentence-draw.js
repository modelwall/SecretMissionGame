import { isValidSentenceSettings } from './room-settings.js';

const emptySentences = (count) => Array.from({ length: count }, () => '');

export function createSentenceDraw({
  db, safe, icon, header, modeNav, codeOnly, onRender, toast, errorMessage,
}) {
  const state = {
    busy: false,
    roomCode: '',
    roomId: '',
    status: 'lobby',
    generation: 1,
    isHost: false,
    hasPlayer: false,
    hasSubmitted: false,
    joinedCount: 0,
    submittedCount: 0,
    currentRound: 0,
    playerLimit: 16,
    sentencesPerPlayer: 3,
    drawSize: 3,
    totalCount: 48,
    remainingCount: 48,
    mySentences: emptySentences(3),
    draftDirty: false,
    currentSentences: [],
    history: [],
    live: 'connecting',
    confirmReset: false,
  };
  let channel = null;
  let refreshTimer = null;
  let refreshing = false;
  let refreshQueued = false;
  const volatileMemberTokens = new Map();

  const storageGet = (key) => {
    try { return localStorage.getItem(key); } catch { return null; }
  };
  const storageSet = (key, value) => {
    try { localStorage.setItem(key, value); } catch { /* Keep working without persistent storage. */ }
  };
  const storageRemove = (key) => {
    try { localStorage.removeItem(key); } catch { /* Keep working without persistent storage. */ }
  };
  const memberTokenKey = (code) => `sentence_draw_member_token:${code}`;
  const draftKey = (code, generation) => `sentence_draw_draft:${code}:${generation}`;

  const createMemberToken = () => {
    const bytes = new Uint8Array(32);
    if (!globalThis.crypto?.getRandomValues) throw new Error('SECURE_STORAGE_UNAVAILABLE');
    globalThis.crypto.getRandomValues(bytes);
    return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  };

  const memberTokenFor = (code) => {
    const key = memberTokenKey(code);
    const stored = storageGet(key) || volatileMemberTokens.get(code);
    if (/^[0-9a-f]{64}$/.test(stored || '')) return stored;
    const token = createMemberToken();
    volatileMemberTokens.set(code, token);
    storageSet(key, token);
    return token;
  };

  const readDraft = (code, generation, count) => {
    try {
      const parsed = JSON.parse(storageGet(draftKey(code, generation)) || 'null');
      if (!Array.isArray(parsed) || parsed.length !== count) return null;
      return parsed.map((value) => String(value).slice(0, 200));
    } catch { return null; }
  };

  const writeDraft = () => {
    if (!state.roomCode || state.status !== 'lobby' || !state.hasPlayer) return;
    storageSet(draftKey(state.roomCode, state.generation), JSON.stringify(state.mySentences));
  };

  const clearDraft = (code = state.roomCode, generation = state.generation) => {
    if (code) storageRemove(draftKey(code, generation));
  };

  const isEditingDraft = () => typeof document !== 'undefined'
    && document.activeElement?.matches?.('[data-sentence-input]');

  const normalizedSentences = (items, count) => {
    const result = emptySentences(count);
    (items || []).forEach((item) => {
      const index = Number(item.slot) - 1;
      if (index >= 0 && index < count) result[index] = item.text || '';
    });
    return result;
  };

  const applyRoom = (room, { preserveDraft = true } = {}) => {
    const previousCode = state.roomCode;
    const previousGeneration = state.generation;
    const previousDraft = state.mySentences;
    const previousDirty = state.draftDirty;
    state.roomCode = room.code;
    state.roomId = room.id;
    state.status = room.status;
    state.generation = Number(room.generation || 1);
    state.isHost = Boolean(room.is_host);
    state.hasPlayer = Boolean(room.has_player);
    state.hasSubmitted = Boolean(room.has_submitted);
    state.joinedCount = Number(room.joined_count || 0);
    state.submittedCount = Number(room.submitted_count || 0);
    state.currentRound = Number(room.current_round || 0);
    state.playerLimit = Number(room.player_limit || 16);
    state.sentencesPerPlayer = Number(room.sentences_per_player || 3);
    state.drawSize = Number(room.draw_size || 3);
    state.totalCount = Number(room.total_count || (state.playerLimit * state.sentencesPerPlayer));
    state.remainingCount = Number(room.remaining_count ?? state.totalCount);
    const serverSentences = normalizedSentences(room.my_sentences, state.sentencesPerPlayer);
    const sameDraft = previousCode === state.roomCode && previousGeneration === state.generation;
    const cachedDraft = preserveDraft && state.status === 'lobby' && state.hasPlayer
      ? readDraft(state.roomCode, state.generation, state.sentencesPerPlayer)
      : null;
    if (preserveDraft && sameDraft && previousDirty && state.status === 'lobby' && state.hasPlayer) {
      state.mySentences = previousDraft.slice(0, state.sentencesPerPlayer);
      while (state.mySentences.length < state.sentencesPerPlayer) state.mySentences.push('');
      state.draftDirty = true;
    } else if (cachedDraft) {
      state.mySentences = cachedDraft;
      state.draftDirty = cachedDraft.some((value, index) => value !== serverSentences[index]);
    } else {
      state.mySentences = serverSentences;
      state.draftDirty = false;
    }
    if (state.status !== 'lobby') clearDraft();
    state.currentSentences = room.current_sentences || [];
    state.history = room.history || [];
  };

  const runBusy = async (task) => {
    if (state.busy) return;
    state.busy = true;
    onRender();
    try {
      await task();
    } catch (error) {
      console.error(error);
      toast(errorMessage(error), true);
    } finally {
      state.busy = false;
      onRender();
    }
  };

  const setRoomUrl = () => {
    const url = new URL(location.href);
    url.searchParams.set('mode', 'sentences');
    url.searchParams.set('room', state.roomCode);
    history.replaceState(null, '', url);
    localStorage.setItem('sentence_draw_room_code', state.roomCode);
  };

  const stop = () => {
    clearTimeout(refreshTimer);
    if (channel && db) db.removeChannel(channel);
    channel = null;
    state.live = 'connecting';
  };

  const refresh = async () => {
    if (!state.roomCode || refreshing) {
      if (refreshing) refreshQueued = true;
      return;
    }
    refreshing = true;
    const code = state.roomCode;
    try {
      const { data, error } = await db.rpc('sentence_draw_room_status', { p_code: code });
      if (error) throw error;
      if (state.roomCode !== code) return;
      applyRoom(data);
      if (!isEditingDraft()) onRender();
    } catch (error) {
      console.warn('Sentence Draw refresh failed:', error);
      state.live = 'connecting';
      onRender();
    } finally {
      refreshing = false;
      if (refreshQueued) {
        refreshQueued = false;
        setTimeout(refresh, 200);
      }
    }
  };

  const scheduleRefresh = () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 140);
  };

  const subscribe = () => {
    stop();
    if (!state.roomId) return;
    const id = state.roomId;
    channel = db.channel(`sentence-draw-${id}-${Math.random().toString(16).slice(2, 8)}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'sentence_draw_public_state',
        filter: `session_id=eq.${id}`,
      }, scheduleRefresh)
      .subscribe((status) => {
        const next = status === 'SUBSCRIBED' ? 'connected' : 'connecting';
        if (state.live !== next) {
          state.live = next;
          if (!isEditingDraft()) onRender();
        }
        if (status === 'SUBSCRIBED') scheduleRefresh();
      });
  };

  const openRoom = (room) => {
    applyRoom(room);
    setRoomUrl();
    subscribe();
    onRender();
  };

  const enter = async (code) => {
    const normalized = codeOnly(code);
    if (normalized.length !== 8) throw new Error('รหัสห้องต้องเป็นตัวเลขหรือ A–F จำนวน 8 ตัว');

    let response = await db.rpc('sentence_draw_room_status', { p_code: normalized });
    let joinedWithToken = false;
    if (response.error?.message?.includes('DRAW_NOT_MEMBER')) {
      response = await db.rpc('sentence_draw_join_room', {
        p_code: normalized,
        p_member_token: memberTokenFor(normalized),
      });
      joinedWithToken = true;
    }
    if (response.error) throw response.error;
    if (response.data.has_player && !joinedWithToken
      && !/^[0-9a-f]{64}$/.test(storageGet(memberTokenKey(normalized)) || '')) {
      response = await db.rpc('sentence_draw_join_room', {
        p_code: normalized,
        p_member_token: memberTokenFor(normalized),
      });
      if (response.error) throw response.error;
    }
    openRoom(response.data);
  };

  const create = async (hostContributes, playerLimit, sentencesPerPlayer, drawSize) => {
    const { data, error } = await db.rpc('sentence_draw_create_room', {
      p_host_contributes: hostContributes,
      p_player_limit: playerLimit,
      p_sentences_per_player: sentencesPerPlayer,
      p_draw_size: drawSize,
    });
    if (error) throw error;
    let room = data;
    if (room.has_player) {
      const attached = await db.rpc('sentence_draw_join_room', {
        p_code: room.code,
        p_member_token: memberTokenFor(room.code),
      });
      if (attached.error) throw attached.error;
      room = attached.data;
    }
    openRoom(room);
  };

  const leave = () => {
    stop();
    state.roomCode = '';
    state.roomId = '';
    state.confirmReset = false;
    state.currentSentences = [];
    state.history = [];
    state.mySentences = emptySentences(state.sentencesPerPlayer);
    state.draftDirty = false;
    localStorage.removeItem('sentence_draw_room_code');
  };

  const share = async () => {
    const url = new URL(location.href);
    url.searchParams.set('mode', 'sentences');
    url.searchParams.set('room', state.roomCode);
    const text = `มาร่วมสุ่มประโยคลับกัน! รหัสห้อง ${state.roomCode}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Secret Sentence Draw', text, url: url.toString() });
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      toast('คัดลอกลิงก์เชิญแล้ว!');
    } catch {
      toast(`Room code: ${state.roomCode}`);
    }
  };

  const landingView = () => {
    const storedCode = new URLSearchParams(location.search).get('room') || '';
    return `${header('CHOOSE A GAME')}
      <main class="container sentence-landing">
        ${modeNav('sentences')}
        <section class="sentence-intro">
          <div class="sentence-intro-icon">💬</div>
          <span class="mini-kicker">FLEXIBLE PLAYERS · PRIVATE SENTENCES · NO REPEATS</span>
          <h1>สุ่มประโยค<span>ลับ</span></h1>
          <p>โฮสต์กำหนดจำนวนคน ประโยคต่อคน<br>และจำนวนประโยคที่เปิดพร้อมกันในแต่ละรอบแบบไม่ซ้ำ</p>
        </section>
        <section class="welcome-actions sentence-actions">
          <div class="actions-heading"><span>🎲</span><div><h2>สร้างห้องใหม่</h2><p>ผู้สร้างห้องจะเป็นโฮสต์และควบคุมการสุ่ม</p></div></div>
          <form id="sentence-create-form">
            <div class="settings-grid sentence-settings-grid">
              <label><span>ผู้เล่นสูงสุด</span><input name="player_limit" type="number" min="2" max="24" value="16" required></label>
              <label><span>ประโยคต่อคน</span><input name="sentences_per_player" type="number" min="1" max="6" value="3" required></label>
              <label><span>เปิดต่อรอบ</span><input name="draw_size" type="number" min="1" max="144" value="3" required></label>
            </div>
            <p class="settings-note">เปิดต่อรอบได้ตั้งแต่ 1 ถึงจำนวนประโยคทั้งหมด (ผู้เล่น × ประโยคต่อคน) · เริ่มได้ทันทีเมื่อมีคนส่งประโยคแล้วอย่างน้อย 1 คน</p>
            <label class="host-choice"><input type="checkbox" name="host_contributes" checked><span><b>ฉันร่วมส่งประโยคด้วย</b><small>นับเป็น 1 คนจากจำนวนที่ตั้งไว้</small></span></label>
            <button class="btn primary big" type="submit" ${state.busy ? 'disabled' : ''}>${state.busy ? '<span class="spinner"></span>กำลังสร้างห้อง...' : `สร้างห้องสุ่มประโยค ${icon('arrow', 20)}`}</button>
          </form>
          <div class="or-line"><span>หรือเข้าห้องของเพื่อน</span></div>
          <form id="sentence-join-form" class="code-form">
            <label for="sentence-room-code">ROOM CODE</label>
            <div class="code-input-row"><input id="sentence-room-code" name="code" type="text" maxlength="8" value="${safe(codeOnly(storedCode))}" placeholder="เช่น 1A2B3C4D" autocomplete="off" required>
            <button class="btn navy" type="submit" ${state.busy ? 'disabled' : ''}>เข้าห้อง ${icon('arrow', 18)}</button></div>
          </form>
        </section>
        <p class="footer-note">🔒 ก่อนเปิดเผย คุณจะเห็นเฉพาะประโยคของตัวเอง</p>
      </main>`;
  };

  const progressView = () => {
    const allSubmitted = state.submittedCount > 0 && state.submittedCount === state.joinedCount;
    return `<section class="sentence-progress card-paper">
      <div class="head-row"><div><span class="eyebrow-text">LOBBY PROGRESS</span><h2>${allSubmitted ? 'พร้อมเริ่มสุ่มแล้ว!' : 'กำลังรอทุกคน'}</h2></div>
        <span class="live-indicator ${state.live === 'connected' ? 'online' : ''}"><span></span>${state.live === 'connected' ? 'LIVE' : 'SYNCING'}</span></div>
      <div class="sentence-count-grid">
        <div><strong>${state.joinedCount}<small>/${state.playerLimit}</small></strong><span>ผู้เล่นเข้าห้อง</span></div>
        <div><strong>${state.submittedCount}<small>/${state.playerLimit}</small></strong><span>ส่งครบ ${state.sentencesPerPlayer} ประโยค</span></div>
        <div><strong>${state.submittedCount * state.sentencesPerPlayer}<small>/${state.totalCount}</small></strong><span>ประโยคพร้อมสุ่ม</span></div>
      </div>
      <div class="lobby-progress-track"><span style="width:${state.submittedCount / state.playerLimit * 100}%"></span></div>
    </section>`;
  };

  const submissionView = () => {
    if (!state.hasPlayer) {
      return `<section class="control-only-card card-paper"><span>🎛️</span><h2>โหมดโฮสต์อย่างเดียว</h2>
        <p>คุณยังไม่ถูกนับในผู้เล่น ${state.playerLimit} คน หากต้องการร่วมส่งประโยคด้วย สามารถเข้าร่วมได้ก่อนห้องเต็ม</p>
        <button class="btn outline" data-action="sentence-join-player" ${state.joinedCount >= state.playerLimit || state.busy ? 'disabled' : ''}>เข้าร่วมเป็นผู้เล่น</button></section>`;
    }

    return `<section class="sentence-form-card card-paper">
      <div class="sentence-form-heading"><div><span class="eyebrow-text">PRIVATE · ONLY YOU CAN SEE</span><h2>${state.hasSubmitted ? 'ประโยคของคุณส่งแล้ว ✓' : `เขียน ${state.sentencesPerPlayer} ประโยคของคุณ`}</h2></div><span class="private-badge">${icon('lock', 14)} ส่วนตัว</span></div>
      <p>แก้ไขได้จนกว่าโฮสต์จะเริ่มสุ่ม สูงสุดประโยคละ 200 ตัวอักษร</p>
      <form id="sentence-submission-form">
        ${state.mySentences.map((sentence, index) => `<label class="sentence-field"><span>ประโยคที่ ${index + 1}<small data-count-for="${index}">${[...sentence].length}/200</small></span>
          <textarea name="sentence" data-sentence-input="${index}" maxlength="200" rows="3" placeholder="พิมพ์ประโยคลับ..." required>${safe(sentence)}</textarea></label>`).join('')}
        <button class="btn primary big" data-sentence-submit type="submit" ${state.busy ? 'disabled' : ''}>${state.hasSubmitted ? 'บันทึกการแก้ไข' : `ส่งประโยคทั้ง ${state.sentencesPerPlayer} ข้อ`} ${icon('tick', 18)}</button>
      </form>
      ${state.hasSubmitted ? '<div class="private-confirmation">✓ บันทึกแล้ว · คนอื่นยังมองไม่เห็นข้อความของคุณ</div>' : ''}
    </section>`;
  };

  const lobbyView = () => {
    // Only complete submissions enter the pool, so the host may start as soon as one exists.
    const readyCount = state.submittedCount * state.sentencesPerPlayer;
    const ready = readyCount > 0;
    const waitingForSubmissions = Math.max(state.joinedCount - state.submittedCount, 0);
    const availableSlots = state.playerLimit - state.joinedCount;
    const hostNote = !ready
      ? 'ต้องมีผู้เล่นส่งประโยคแล้วอย่างน้อย 1 คนจึงจะเริ่มได้'
      : waitingForSubmissions
        ? `เริ่มได้เลย แต่ยังมี ${waitingForSubmissions} คนที่ยังไม่ส่ง ประโยคของคนที่ยังไม่ส่งจะไม่ถูกนำมาสุ่ม · เมื่อเริ่มแล้วจะปิดรับผู้เล่นและแก้ไขไม่ได้`
        : `เริ่มได้เลย${availableSlots ? ` หรือรอเพิ่มอีกสูงสุด ${availableSlots} คน` : ''} · เมื่อเริ่มแล้วจะปิดรับผู้เล่นและแก้ไขไม่ได้`;
    const playerNote = state.hasSubmitted
      ? '⏳ ส่งประโยคแล้วรอโฮสต์เริ่มเกม หน้านี้จะอัปเดตอัตโนมัติ'
      : '⚠️ โฮสต์เริ่มเกมได้ทุกเมื่อ ถ้ายังไม่ส่งตอนเริ่ม ประโยคของคุณจะไม่ถูกนำมาสุ่ม';
    return `${progressView()}
      ${submissionView()}
      ${state.isHost ? `<section class="host-controls card-paper"><span class="host-badge">HOST CONTROL</span>
        <h2>${ready ? `${readyCount} ประโยค พร้อมเปิดรอบแรก` : 'รอผู้เล่นส่งประโยค'}</h2>
        <p>${hostNote}</p>
        <button class="btn primary big" data-action="sentence-draw" ${!ready || state.busy ? 'disabled' : ''}>${state.busy ? '<span class="spinner"></span>กำลังสุ่ม...' : `เริ่มสุ่ม ${Math.min(state.drawSize,readyCount || state.drawSize)} ประโยค ${icon('shuffle', 20)}`}</button>
      </section>` : `<div class="waiting-callout">${playerNote}</div>`}`;
  };

  const drawView = () => {
    const finished = state.status === 'finished';
    return `<section class="draw-stage">
      <div class="draw-stage-head"><div><span class="eyebrow-text">SECRET SENTENCE DRAW</span><h1>${finished ? `ครบทั้ง ${state.totalCount} ประโยคแล้ว!` : `รอบที่ ${state.currentRound}`}</h1></div>
        <div class="remaining-pill"><strong>${state.remainingCount}</strong><span>เหลือ</span></div></div>
      <div class="sentence-reveal-grid">
        ${state.currentSentences.map((item, index) => `<article class="sentence-reveal-card reveal-tone-${index % 3}"><span>${String(index + 1).padStart(2, '0')}</span><p>${safe(item.text)}</p></article>`).join('')}
      </div>
      ${finished ? `<div class="finished-callout">🏁 สุ่มครบ ${state.currentRound} รอบแล้ว ทุกประโยคถูกเปิดเผยครั้งเดียว</div>` : ''}
      ${state.isHost ? `<section class="host-draw-controls">
        ${!finished ? `<button class="btn primary big" data-action="sentence-draw" ${state.busy ? 'disabled' : ''}>${state.busy ? '<span class="spinner"></span>กำลังสุ่ม...' : `สุ่มต่ออีก ${Math.min(state.drawSize,state.remainingCount)} ประโยค ${icon('shuffle', 20)}`}</button>` : ''}
        <button class="btn outline board-cta" data-action="sentence-reset-open">เริ่มเกมใหม่ / รีเซ็ต</button>
      </section>` : `<div class="waiting-callout">${finished ? 'เกมจบแล้ว 🎉' : 'รอโฮสต์สุ่มรอบถัดไป หน้านี้จะอัปเดตอัตโนมัติ'}</div>`}
      ${state.isHost && state.history.length ? `<details class="round-history"><summary>ดูประวัติ ${state.history.length} รอบ</summary>
        <div>${state.history.map((round) => `<section><h3>รอบที่ ${round.round}</h3><ol>${(round.sentences || []).map((item) => `<li>${safe(item.text)}</li>`).join('')}</ol></section>`).join('')}</div></details>` : ''}
    </section>`;
  };

  const resetDialog = () => state.confirmReset ? `<div class="dialog-backdrop" role="presentation"><div class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="reset-title">
    <div class="dialog-emoji">↻</div><h2 id="reset-title">เริ่มเกมใหม่ใช่ไหม?</h2>
    <p>ประโยคและประวัติการสุ่มของโหมดนี้จะถูกล้าง ผู้เล่นทั้ง ${state.joinedCount} คนจะยังอยู่ในห้องและต้องส่งประโยคใหม่</p>
    <div class="dialog-buttons"><button class="btn outline" data-action="sentence-reset-cancel">ยกเลิก</button>
      <button class="btn primary" data-action="sentence-reset-confirm" ${state.busy ? 'disabled' : ''}>ยืนยันรีเซ็ต</button></div>
  </div></div>` : '';

  const roomView = () => `${header('SECRET SENTENCE DRAW', true)}
    <main class="container sentence-room">
      <div class="sentence-room-title"><div><span class="eyebrow-text">${state.isHost ? 'YOU ARE THE HOST' : 'PLAYER MODE'}</span><h1>สุ่มประโยคลับ <span>💬</span></h1></div>
        <span class="live-indicator ${state.live === 'connected' ? 'online' : ''}"><span></span>${state.live === 'connected' ? 'LIVE' : 'SYNCING'}</span></div>
      <div class="room-banner"><div><small>ROOM CODE</small><strong>${safe(state.roomCode)}</strong></div><button data-action="sentence-share" class="light-pill">${icon('copy', 16)} เชิญเพื่อน</button></div>
      <div class="room-config-summary"><span>🧑‍🤝‍🧑 ${state.playerLimit} คน</span><span>💬 ${state.sentencesPerPlayer} ประโยค/คน</span><span>🎲 สูงสุด ${state.drawSize} ใบ/รอบ</span></div>
      ${state.status === 'lobby' ? lobbyView() : drawView()}
      <div class="game-bottom"><span>💬</span> PRIVATE FIRST, FUN TOGETHER <span>🎲</span>
        <button class="subtle-link" data-action="home">ออกจากห้อง / กลับหน้าแรก</button></div>
    </main>${resetDialog()}`;

  const view = () => state.roomCode ? roomView() : landingView();

  const handleClick = async (action) => {
    if (!action.startsWith('sentence-')) return false;
    if (state.busy && !action.endsWith('cancel')) return true;

    if (action === 'sentence-share') await share();
    if (action === 'sentence-reset-open') { state.confirmReset = true; onRender(); }
    if (action === 'sentence-reset-cancel') { state.confirmReset = false; onRender(); }
    if (action === 'sentence-join-player') {
      await runBusy(async () => {
        const { data, error } = await db.rpc('sentence_draw_join_room', {
          p_code: state.roomCode,
          p_member_token: memberTokenFor(state.roomCode),
        });
        if (error) throw error;
        applyRoom(data, { preserveDraft: false });
        state.draftDirty = false;
        clearDraft();
        toast(`เข้าร่วมเป็นผู้เล่นแล้ว ส่ง ${state.sentencesPerPlayer} ประโยคได้เลย`);
      });
    }
    if (action === 'sentence-draw') {
      await runBusy(async () => {
        const { data, error } = await db.rpc('sentence_draw_draw', {
          p_code: state.roomCode, p_expected_round: state.currentRound,
        });
        if (error) throw error;
        applyRoom(data);
      });
    }
    if (action === 'sentence-reset-confirm') {
      await runBusy(async () => {
        const { data, error } = await db.rpc('sentence_draw_reset', { p_code: state.roomCode });
        if (error) throw error;
        state.confirmReset = false;
        applyRoom(data);
        toast('เริ่มเกมใหม่แล้ว ทุกคนส่งประโยคชุดใหม่ได้เลย');
      });
    }
    return true;
  };

  const handleSubmit = async (form) => {
    if (!form.id.startsWith('sentence-')) return false;
    if (form.id === 'sentence-create-form') {
      const data = new FormData(form);
      const playerLimit = Number(data.get('player_limit'));
      const sentencesPerPlayer = Number(data.get('sentences_per_player'));
      const drawSize = Number(data.get('draw_size'));
      if (!isValidSentenceSettings(playerLimit, sentencesPerPlayer, drawSize)) {
        toast('ตั้งค่าได้ 2–24 คน, 1–6 ประโยคต่อคน และเปิดต่อรอบได้ไม่เกินจำนวนประโยคทั้งหมด (ผู้เล่น × ประโยคต่อคน)', true);
        return true;
      }
      await runBusy(() => create(data.has('host_contributes'), playerLimit, sentencesPerPlayer, drawSize));
    }
    if (form.id === 'sentence-join-form') {
      const code = new FormData(form).get('code');
      await runBusy(() => enter(code));
    }
    if (form.id === 'sentence-submission-form') {
      const sentences = new FormData(form).getAll('sentence').map((value) => String(value).trim());
      if (sentences.length !== state.sentencesPerPlayer || sentences.some((text) => !text || [...text].length > 200)) {
        toast(`กรุณากรอกทั้ง ${state.sentencesPerPlayer} ประโยค ประโยคละไม่เกิน 200 ตัวอักษร`, true);
        return true;
      }
      await runBusy(async () => {
        const { data, error } = await db.rpc('sentence_draw_save_submission', {
          p_code: state.roomCode, p_sentences: sentences,
        });
        if (error) throw error;
        applyRoom(data, { preserveDraft: false });
        state.draftDirty = false;
        clearDraft();
        toast(`บันทึก ${state.sentencesPerPlayer} ประโยคแล้ว ข้อความยังเป็นส่วนตัว`);
      });
    }
    return true;
  };

  const handleInput = (target) => {
    if (!target.matches('[data-sentence-input]')) return false;
    const form = target.closest('form');
    const fields = [...form.querySelectorAll('[data-sentence-input]')];
    state.mySentences = fields.map((field) => field.value);
    state.draftDirty = true;
    writeDraft();
    fields.forEach((field) => {
      const count = [...field.value].length;
      form.querySelector(`[data-count-for="${field.dataset.sentenceInput}"]`).textContent = `${count}/200`;
    });
    const submit = form.querySelector('[data-sentence-submit]');
    submit.disabled = fields.length !== state.sentencesPerPlayer || fields.some((field) => !field.value.trim() || [...field.value].length > 200);
    return true;
  };

  return {
    state, view, enter, refresh, stop, leave, handleClick, handleSubmit, handleInput,
    isBusy: () => state.busy,
  };
}
