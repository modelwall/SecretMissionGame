import { createClient } from '@supabase/supabase-js';
import { createSentenceDraw } from './sentence-draw.js';
import { capacityForTeam, isValidMissionSettings } from './room-settings.js';
import { createResilientStorage, createSessionRetry, isAnonPermissionError } from './session.js';
import './style.css';

const $app = document.querySelector('#app');
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const isConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY && !SUPABASE_URL.includes('YOUR-PROJECT') && !SUPABASE_KEY.includes('YOUR_'));
const db = isConfigured ? createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true, autoRefreshToken: true, detectSessionInUrl: false,
    storage: createResilientStorage(() => globalThis.localStorage),
  },
}) : null;
// Some in-app browsers block localStorage; the room code in the URL still works.
const readLocal = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const writeLocal = (key, value) => { try { localStorage.setItem(key, value); } catch { /* Keep playing without it. */ } };
const removeLocal = (key) => { try { localStorage.removeItem(key); } catch { /* Nothing stored. */ } };
// A request that still ran without a session gets one retry after re-auth. A
// brand-new anonymous user cannot act as the old one, so reload to re-enter the
// room (Sentence Draw then recovers the player with its browser token).
const authed = createSessionRetry(async () => {
  const before = state.user?.id;
  await ensureAuth();
  if (before && state.user?.id !== before) location.reload();
});
const rpc = (name, args) => authed(() => db.rpc(name, args));
const CARD_STICKERS = ['🎮', '🧩', '🎯'];
const CARS = [
  { n: 1, color: 'blue', label: 'Blue Cruiser', emoji: '🚙' },
  { n: 2, color: 'yellow', label: 'Sunset Van', emoji: '🚐' },
  { n: 3, color: 'green', label: 'Trail Crew', emoji: '🛻' },
  { n: 4, color: 'orange', label: 'Road Runners', emoji: '🏎️' },
  { n: 5, color: 'blue', label: 'Sky Riders', emoji: '🚗' },
  { n: 6, color: 'yellow', label: 'Happy Camper', emoji: '🚎' },
  { n: 7, color: 'green', label: 'Forest Gang', emoji: '🚙' },
  { n: 8, color: 'orange', label: 'Turbo Friends', emoji: '🏁' },
];
const state = {
  screen: 'welcome', mode: 'missions', busy: false, user: null, roomCode: '', roomId: '',
  seats: [], selectedCar: 1, selectedSeat: null, player: null, nickname: '',
  players: [], assignments: [], tab: 'cards',
  playerLimit: 16, teamCount: 4, missionsPerPlayer: 3, teamNames: [],
  draftPlayerLimit: '16', draftTeamCount: '4', draftMissionsPerPlayer: '3',
  draftTeamNames: Array(8).fill(''),
  live: 'connecting', flipped: new Set(), confirming: null, confirmingReroll: null, latestReveal: null, error: '',
};
let liveChannel = null;
let fetching = false;
let fetchQueued = false;
let refreshTimer = null;

const safe = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[c]);
const codeOnly = (v) => String(v ?? '').toUpperCase().replace(/[^0-9A-F]/g, '').slice(0, 8);
const doneCount = (playerId) => state.assignments.filter(a => a.player_id === playerId && a.completed_at).length;
const totalDone = (car) => state.assignments.filter(a => a.completed_at &&
  state.players.find(p => p.id === a.player_id)?.car_number === car).length;
const activeCars = () => CARS.slice(0, state.teamCount);
const teamCapacity = (car) => capacityForTeam(state.playerLimit,state.teamCount,car);
const carName = (n) => state.teamNames[Number(n)-1]?.trim() || `Car ${n}`;
const carDisplay = (n) => carName(n) === `Car ${n}` ? `Car ${n}` : `Car ${n} · ${carName(n)}`;
const draftTeamNameInputs = (count) => Array.from({length:count},(_,i)=>`
  <label class="team-name-field"><span>Car ${i+1}</span>
    <input name="team_name_${i+1}" type="text" maxlength="24"
      autocomplete="off" placeholder="เช่น รถเอิ้ก" value="${safe(state.draftTeamNames[i]||'')}" />
  </label>`).join('');
const errorMessage = (err) => {
  const text = (err?.message || String(err || '')).trim();
  if (text.includes('ROOM_NOT_FOUND')) return 'ไม่พบห้องนี้ ลองตรวจรหัสห้องอีกครั้ง';
  if (text.includes('SEAT_TAKEN') || text.includes('unique constraint')) return 'ที่นั่งนี้มีคนเลือกไปแล้ว ลองเลือกตำแหน่งอื่น';
  if (text.includes('INVALID_NICKNAME')) return 'กรุณาตั้งชื่อเล่น 2–24 ตัวอักษร';
  if (text.includes('NOT_YOUR_MISSION')) return 'สามารถกดสำเร็จได้เฉพาะภารกิจของตัวเอง';
  if (text.includes('MISSION_ALREADY_COMPLETED')) return 'ภารกิจนี้สำเร็จแล้ว ไม่สามารถเปลี่ยนได้';
  if (text.includes('REROLL_ALREADY_USED')) return 'การ์ดนี้ใช้สิทธิ์สุ่มใหม่แล้ว';
  if (text.includes('NO_AVAILABLE_MISSIONS')) return 'ไม่มีโจทย์สำรองในห้อง การ์ดเดิมยังอยู่และไม่เสียสิทธิ์';
  if (text.includes('REROLL_CONFLICT')) return 'สถานะการ์ดเปลี่ยนไป กรุณาลองใหม่';
  if (text.includes('NOT_ENOUGH_MISSIONS')) return 'ภารกิจในระบบไม่เพียงพอ กรุณาติดต่อผู้ดูแล';
  if (text.includes('DRAW_ROOM_NOT_FOUND')) return 'ไม่พบห้องสุ่มประโยคนี้ ลองตรวจรหัสอีกครั้ง';
  if (text.includes('ROOM_FULL') || text.includes('DRAW_ROOM_FULL')) return 'ห้องนี้มีผู้เล่นครบตามจำนวนที่โฮสต์ตั้งไว้แล้ว';
  if (text.includes('INVALID_TEAM_NAMES')) return 'ชื่อรถต้องไม่ซ้ำกัน และมีความยาวไม่เกิน 24 ตัวอักษร';
  if (text.includes('INVALID_ROOM_SETTINGS')) return 'ค่าห้องไม่ถูกต้อง กรุณาตรวจจำนวนผู้เล่น ทีม และโจทย์อีกครั้ง';
  if (text.includes('INVALID_DRAW_SETTINGS')) return 'ค่าห้องไม่ถูกต้อง กรุณาตรวจจำนวนผู้เล่น ประโยคต่อคน และจำนวนที่เปิดต่อรอบอีกครั้ง';
  if (text.includes('DRAW_ROOM_STARTED') || text.includes('DRAW_SUBMISSIONS_LOCKED')) return 'เกมเริ่มแล้ว ไม่สามารถเข้าห้องหรือแก้ประโยคได้';
  if (text.includes('DRAW_NOT_PLAYER')) return 'โฮสต์ต้องเข้าร่วมเป็นผู้เล่นก่อนจึงจะส่งประโยคได้';
  if (text.includes('DRAW_NOT_HOST')) return 'เฉพาะโฮสต์ของห้องเท่านั้นที่สั่งสุ่มหรือรีเซ็ตได้';
  if (text.includes('DRAW_NOT_READY')) return 'ต้องมีผู้เล่นส่งประโยคแล้วอย่างน้อย 1 คนก่อนเริ่ม';
  if (text.includes('DRAW_FINISHED')) return 'สุ่มครบทุกประโยคแล้ว';
  if (text.includes('INVALID_SENTENCES')) return 'จำนวนประโยคไม่ครบ หรือมีประโยคยาวเกิน 200 ตัวอักษร';
  if (text.includes('INVALID_MEMBER_TOKEN') || text.includes('SECURE_STORAGE_UNAVAILABLE')) return 'เบราว์เซอร์นี้ไม่สามารถบันทึก session ของผู้เล่นได้ กรุณาเปิดใช้งานพื้นที่จัดเก็บของเว็บไซต์';
  if (text.includes('DRAW_NOT_MEMBER')) return 'คุณยังไม่ได้เข้าร่วมห้องสุ่มประโยคนี้';
  if (text.includes('Anonymous sign-ins are disabled')) return 'ยังไม่ได้เปิด Anonymous Sign-Ins ใน Supabase';
  if (text.includes('Could not find the function')) return 'ฐานข้อมูลยังไม่พร้อม กรุณารัน migration ล่าสุดใน Supabase';
  if (isAnonPermissionError(err)) return 'การเชื่อมต่อหลุด กรุณาโหลดหน้าใหม่ หรือเปิดลิงก์ใน Safari / Chrome';
  if (text.includes('Failed to fetch') || text.includes('NetworkError')) return 'ไม่สามารถเชื่อมต่ออินเทอร์เน็ต ลองใหม่อีกครั้ง';
  return text || 'เกิดข้อผิดพลาด กรุณาลองใหม่';
};
const icon = (name, size=20) => {
  const paths = {
    arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    back: '<path d="m14 6-6 6 6 6M8 12h12"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    tick: '<path d="m5 12 4 4L19 6"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    trophy: '<path d="M8 21h8m-4-4v4M7 4h10v6a5 5 0 0 1-10 0V4ZM7 6H4v2a4 4 0 0 0 4 4M17 6h3v2a4 4 0 0 1-4 4"/>',
    shuffle: '<path d="m18 14 4 4-4 4M2 18h2c4 0 5-6 9-6h9M18 2l4 4-4 4M2 6h2c4 0 5 6 9 6"/>',
    sparkle: '<path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5L12 2Z"/>',
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.sparkle}</svg>`;
};

const heroCar = () => `<svg class="hero-car-art" viewBox="0 0 360 225" role="img" aria-label="กลุ่มเพื่อนออกทริปด้วยรถสีฟ้า" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="181" cy="202" rx="145" ry="14" fill="#16324A" opacity=".12"/>
  <path d="M84 116c7-34 30-53 62-54h89c23 0 42 22 53 54l22 8c12 4 19 13 19 25v24c0 10-7 16-17 16H61c-10 0-17-7-17-17v-21c0-16 13-29 40-35z" fill="#55B8D7" stroke="#16324A" stroke-width="5" stroke-linejoin="round"/>
  <path d="M122 72h111c16 0 28 19 37 46H99c5-25 13-46 23-46z" fill="#DDF4F8" stroke="#16324A" stroke-width="5" stroke-linejoin="round"/>
  <path d="M181 72v46" stroke="#16324A" stroke-width="5"/>
  <circle cx="142" cy="93" r="17" fill="#F3B881"/><path d="M126 90c1-15 8-23 18-23 10 0 17 7 18 20-9-6-20-6-36 3z" fill="#263F53"/>
  <circle cx="219" cy="92" r="17" fill="#C88962"/><path d="M202 90c2-16 10-23 20-21 8 1 14 8 14 19-10-5-21-5-34 2z" fill="#5A3D30"/>
  <circle cx="137" cy="94" r="2.2" fill="#16324A"/><circle cx="148" cy="94" r="2.2" fill="#16324A"/><path d="M139 102q4 4 8 0" stroke="#16324A" stroke-width="2" fill="none"/>
  <circle cx="214" cy="93" r="2.2" fill="#16324A"/><circle cx="225" cy="93" r="2.2" fill="#16324A"/><path d="M216 101q4 4 8 0" stroke="#16324A" stroke-width="2" fill="none"/>
  <rect x="157" y="139" width="58" height="25" rx="8" fill="#F6C84E" stroke="#16324A" stroke-width="4"/><path d="m174 146 0 11 10-5.5z" fill="#16324A"/><circle cx="197" cy="151" r="4" fill="#16324A"/>
  <rect x="51" y="150" width="34" height="12" rx="5" fill="#F6C84E" stroke="#16324A" stroke-width="3"/><rect x="286" y="150" width="34" height="12" rx="5" fill="#F6C84E" stroke="#16324A" stroke-width="3"/>
  <circle cx="105" cy="187" r="27" fill="#16324A"/><circle cx="105" cy="187" r="13" fill="#F4F6F8"/><circle cx="270" cy="187" r="27" fill="#16324A"/><circle cx="270" cy="187" r="13" fill="#F4F6F8"/>
  <path d="M39 80h24M51 68v24M310 66l10-10m-4 18 17-3" stroke="#F26B4A" stroke-width="5" stroke-linecap="round"/>
  <path d="M298 25v48" stroke="#16324A" stroke-width="4"/><path d="M299 26h34l-9 10 9 10h-34z" fill="#F26B4A" stroke="#16324A" stroke-width="3" stroke-linejoin="round"/>
</svg>`;
const header = (title = 'Road Trip Club', back = false) => `<header class="topbar container">
  <button class="logo-button" data-action="home" aria-label="หน้าหลัก"><span class="logo-mark">🎮</span><span class="brand">SECRET<span>MISSION</span></span></button>
  ${back ? `<button class="text-button muted" data-action="home">${icon('back',16)} หน้าแรก</button>` : `<span class="topbar-badge">✦ ${safe(title)}</span>`}
</header>`;
const modeNav = (active) => `<nav class="mode-nav" aria-label="เลือกโหมดเกม">
  <button class="${active==='missions'?'active':''}" data-action="select-mode" data-mode="missions"><span>🎮</span><b>Secret Mission</b><small>การ์ดภารกิจ</small></button>
  <button class="${active==='sentences'?'active':''}" data-action="select-mode" data-mode="sentences"><span>💬</span><b>Secret Sentence Draw</b><small>สุ่มประโยคลับ</small></button>
</nav>`;
const wave = () => `<div class="blob-decoration b1"></div><div class="blob-decoration b2"></div>`;
const button = (label,action, extra='',attrs='') => `<button class="btn ${extra}" data-action="${action}" ${attrs}>${label}</button>`;
const stepLabel = (n, txt) => `<div class="eyebrow"><span class="step-dot">${n}</span>${txt}</div>`;
const loadingBtn = (label) => `<button class="btn primary" disabled><span class="spinner"></span>${label}</button>`;
const sentenceDraw = createSentenceDraw({
  db: db && { rpc, channel: (name) => db.channel(name), removeChannel: (channel) => db.removeChannel(channel) },
  safe, icon, header, modeNav, codeOnly, onRender: () => render(), toast, errorMessage,
});

function welcomeView() {
  const storedCode = new URLSearchParams(location.search).get('room') || '';
  return `${header('PLAY TOGETHER')}
  <main class="container welcome-main">
    ${modeNav('missions')}
    <section class="welcome-hero">
      <div class="float-sticker sticker-star">🏁</div><div class="float-sticker sticker-crew">🧑‍🤝‍🧑</div>
      <div class="hero-illustration">${heroCar()}</div>
      <span class="mini-kicker">READY · SET · ROAD TRIP</span>
      <h1>Secret <span>Mission!</span></h1>
      <p>เกมภารกิจลับบนรถ ชวนเพื่อนทำเรื่องฮา ๆ<br>แล้วลุ้นไปด้วยกันตลอดทริป</p>
      <div class="stats-strip"><span>🚙 <b>1–8</b> Cars</span><span>🧑‍🤝‍🧑 <b>2–24</b> Players</span><span>🎮 <b>1–6</b> Missions</span></div>
    </section>
    <section class="welcome-actions">
      <div class="actions-heading"><span>🚦</span><div><h2>พร้อมออกทริปกันยัง?</h2><p>สร้างห้องใหม่ หรือใส่โค้ดห้องของเพื่อน</p></div></div>
      <form id="mission-create-form" class="room-settings-form">
        <div class="settings-heading"><b>ตั้งค่าห้องของคุณ</b><small>ปรับได้ก่อนสร้างห้อง</small></div>
        <div class="settings-grid">
          <label><span>ผู้เล่นทั้งหมด</span><input name="player_limit" type="number" min="2" max="24" value="${safe(state.draftPlayerLimit)}" required></label>
          <label><span>จำนวนรถ / ทีม</span><input name="team_count" type="number" min="1" max="8" value="${safe(state.draftTeamCount)}" required></label>
          <label><span>โจทย์ต่อคน</span><input name="missions_per_player" type="number" min="1" max="6" value="${safe(state.draftMissionsPerPlayer)}" required></label>
        </div>
        <div class="team-names-panel">
          <div class="settings-heading"><b>🚙 ตั้งชื่อรถแต่ละคัน</b><small>ปล่อยว่างเพื่อใช้ชื่อ Car 1, Car 2… ตามเดิม</small></div>
          <div id="team-name-fields" class="team-name-grid">${draftTeamNameInputs(Math.min(8,Math.max(1,Number(state.draftTeamCount)||4)))}</div>
        </div>
        <p class="settings-note">ชื่อรถจะแสดงให้เพื่อนทุกคนเห็นตอนเลือกที่นั่งและดูคะแนน · โจทย์ไม่ซ้ำกันในห้อง</p>
        <button class="btn primary big" type="submit" ${state.busy ? 'disabled' : ''}>${state.busy ? '<span class="spinner"></span>กำลังสร้างห้อง...' : `สร้างห้องใหม่ ${icon('arrow',20)}`}</button>
      </form>
      <div class="or-line"><span>หรือเข้าร่วมกับเพื่อน</span></div>
      <form id="join-room-form" class="code-form">
        <label for="room-code">ROOM CODE</label>
        <div class="code-input-row"><input id="room-code" name="code" type="text" inputmode="text" maxlength="8" value="${safe(codeOnly(storedCode))}" placeholder="เช่น 1A2B3C4D" autocomplete="off" required />
        <button class="btn navy" type="submit" ${state.busy ? 'disabled' : ''}>เข้าห้อง ${icon('arrow',18)}</button></div>
      </form>
    </section>
    <div class="footer-note">📱 เล่นจากมือถือใครมือถือมัน · คะแนนอัปเดตให้ทั้งกลุ่ม</div>
  </main>`;
}
function setupView() {
  return `${header('SETUP REQUIRED')}
    <main class="container setup-area"><div class="card-paper setup-card"><span class="giant-emoji">🛠️</span><h1>อีกนิดเดียวก็เล่นได้!</h1>
    <p>เว็บพร้อมแล้ว แต่ต้องเชื่อมกับ Supabase ก่อนจึงจะเล่นแบบ Multiplayer ได้</p>
    <ol><li>สร้าง Supabase Project</li><li>เปิด Anonymous Sign-Ins</li><li>รัน <code>schema.sql</code> → <code>sentence_draw_migration.sql</code> → <code>flexible_room_settings_migration.sql</code> → <code>sentence_draw_session_fix_migration.sql</code> → <code>sentence_draw_flexible_draw_migration.sql</code></li><li>เพิ่ม Environment Variables สองตัวใน Vercel แล้ว Deploy ใหม่</li></ol>
    <div class="mini-code">VITE_SUPABASE_URL<br>VITE_SUPABASE_ANON_KEY</div>
    <p class="small-note">ดูขั้นตอนละเอียดในไฟล์ README.md ที่มาพร้อมโปรเจกต์</p></div></main>`;
}
// Players whose sign-in fails on load should get a retry, not the developer setup steps.
function connectErrorView() {
  return `${header('CONNECTION')}
    <main class="container setup-area"><div class="card-paper setup-card"><span class="giant-emoji">📶</span><h1>เชื่อมต่อเกมไม่สำเร็จ</h1>
    <p>${safe(state.error)}</p>
    <button class="btn primary big" data-action="reload">ลองใหม่อีกครั้ง</button>
    <p class="small-note">ถ้าเปิดจาก LINE / Discord แล้วยังไม่ได้ ให้กดเมนู ⋯ แล้วเลือกเปิดใน Safari หรือ Chrome</p></div></main>`;
}
function seatsView() {
  const selected = activeCars().find(c=>c.n === state.selectedCar) || activeCars()[0];
  const capacity = teamCapacity(selected.n);
  const occupied = new Set(state.seats.map(s => `${s.car}-${s.seat}`));
  return `${header('PICK YOUR SEAT',true)}<main class="container select-main">
    ${stepLabel('01','CHOOSE YOUR CAR')}
    <div class="section-heading"><h1>รถคันไหนของเธอ? <span>🚗</span></h1><p>เลือกคันรถที่นั่งอยู่ แล้วเลือก Player ของตัวเอง</p></div>
    <div class="room-code-bar"><div><span>ROOM CODE</span><strong>${safe(state.roomCode)}</strong></div>
      <button class="copy-code" data-action="share" aria-label="คัดลอกลิงก์เชิญ">${icon('copy',17)} แชร์ห้อง</button></div>
    <div class="room-config-summary"><span>🧑‍🤝‍🧑 ${state.playerLimit} คน</span><span>🚙 ${state.teamCount} ทีม</span><span>🎮 ${state.missionsPerPlayer} โจทย์/คน</span></div>
    <div class="car-grid">${activeCars().map(c=>{
      const used=state.seats.filter(x=>x.car===c.n).length;
      return `<button class="car-option theme-${c.color} ${state.selectedCar===c.n?'active':''}" data-action="select-car" data-car="${c.n}">
        <span class="car-option-top"><span>${c.emoji}</span><span class="seat-occupancy">${used}/${teamCapacity(c.n)} คน</span></span>
        <span class="mini-car">🚙</span><b>${safe(carName(c.n))}</b><small>Car ${c.n} · ${safe(c.label)}</small>
      </button>`;
    }).join('')}</div>
    <div class="selection-panel"><div class="section-heading compact">${stepLabel('02',`CAR ${selected.n} · ${safe(carName(selected.n))} · SELECT PLAYER`)}<h2>แล้วเธอเป็น Player ไหน?</h2><p>ช่องที่มีเพื่อนเลือกแล้วจะถูกล็อกไว้</p></div>
      <div class="seats-grid">${Array.from({length:capacity},(_,index)=>index+1).map(i=>{
        const isTaken = occupied.has(`${state.selectedCar}-${i}`);
        return `<button class="seat-option ${isTaken?'taken':''} ${state.selectedSeat===i?'selected':''}" data-action="select-seat" data-seat="${i}" ${isTaken?'disabled':''}>
          <span class="seat-number">${isTaken?'🔒':'⭐'}</span><b>Player ${i}</b><small>${isTaken?'มีเจ้าของแล้ว':state.selectedSeat===i?'เลือกแล้ว ✓':'ว่าง · แตะเพื่อเลือก'}</small></button>`;
      }).join('')}</div>
      ${state.selectedSeat && !occupied.has(`${state.selectedCar}-${state.selectedSeat}`) ? `<form id="join-seat-form" class="join-name-form"><label for="nickname">ชื่อเล่นของคุณ</label>
        <input id="nickname" name="nickname" type="text" maxlength="24" minlength="2" placeholder="เช่น เอิ้ก, อ้อ, เบ้บ" required autocomplete="nickname" value="${safe(state.nickname)}" />
        <button class="btn primary big" type="submit" ${state.busy?'disabled':''}>${state.busy?'กำลังรับภารกิจ...':`รับการ์ดภารกิจ ${state.missionsPerPlayer} ใบ`} ${icon('arrow',19)}</button></form>`:
        `<div class="seat-hint">👆 เลือก Player ที่ยังว่างเพื่อรับภารกิจลับของตัวเอง</div>`}
    </div><p class="footer-note">📱 1 Player ต่อ 1 มือถือ · กดสำเร็จแล้วเพื่อนจะเห็นโจทย์</p>
  </main>`;
}
function missionCard(a, i) {
  const isDone = Boolean(a.completed_at);
  const isOpen = isDone || state.flipped.has(a.id);
  return `<article class="mission-card ${isDone?'done':''} tone-${i%3}">
    <div class="mission-card-top"><span>MISSION ${String(a.card_number).padStart(2,'0')}</span><span class="mission-card-status">${isDone?'✓ COMPLETED':isOpen?'TOP SECRET':'✦ SECRET CARD'}</span></div>
    ${!isOpen ? `<button class="card-cover" data-action="flip" data-id="${a.id}" aria-label="เปิดการ์ดภารกิจ ${a.card_number}">
      <span class="card-art">${CARD_STICKERS[i%3]}</span><span class="card-sparkle">✧ ✦ ✧</span>
      <span class="reveal-label">${icon('lock',16)} แตะเพื่อเปิดโจทย์ลับ</span><small>การ์ดใบนี้เห็นได้เฉพาะคุณ</small>
      </button>` : `<div class="card-content"><span class="card-art small">${CARD_STICKERS[i%3]}</span><p>${safe(a.mission_text)}</p>
      ${isDone ? `<div class="card-done-line">${icon('tick',16)} เปิดเผยโจทย์ให้เพื่อนทั้งห้องแล้ว</div>` : `<div class="card-actions">
        <button data-action="flip" data-id="${a.id}" class="text-button">${icon('lock',14)} ซ่อนการ์ด</button>
        <button data-action="ask-reroll" data-id="${a.id}" class="btn outline compact-btn" ${a.rerolled_at?'disabled':''}>${icon('shuffle',14)} Reroll ${a.rerolled_at?'0/1':'1/1'}</button>
        <button data-action="ask-complete" data-id="${a.id}" class="btn dark compact-btn">ทำสำเร็จแล้ว ${icon('tick',16)}</button></div>`}
      </div>`}
  </article>`;
}
function scoreboard() {
  return `<section class="scoreboard"><div class="head-row"><div><span class="eyebrow-text">THE RACE IS ON</span><h2>Leaderboard 🏆</h2></div><span class="live-indicator ${state.live==='connected'?'online':''}"><span></span>${state.live==='connected'?'LIVE':'SYNCING'}</span></div>
   <div class="score-cars">${activeCars().map(c=>{
     const count = totalDone(c.n); const joined=state.players.filter(p=>p.car_number===c.n).length;
     const target=teamCapacity(c.n)*state.missionsPerPlayer;
     return `<div class="score-car theme-${c.color}"><div class="score-car-top"><span>${c.emoji} ${safe(carDisplay(c.n))}</span><strong>${count}<small>/${target}</small></strong></div>
      <div class="progress-track"><span style="width:${target ? count/target*100 : 0}%"></span></div>
      <small>${joined} / ${teamCapacity(c.n)} Players joined</small></div>`;
   }).join('')}</div></section>`;
}
function missionFeed() {
  const finished=state.assignments.filter(a=>a.completed_at)
    .map(a=>({...a,who:state.players.find(p=>p.id===a.player_id)}))
    .sort((a,b)=>new Date(b.completed_at)-new Date(a.completed_at));
  return `<section class="feed-section"><div class="head-row"><div><span class="eyebrow-text">REVEALED TO EVERYONE</span><h2>ภารกิจที่โป๊ะแตก 🎯</h2></div><span class="feed-count">${finished.length} สำเร็จ</span></div>
   ${finished.length ? `<div class="feed-list">${finished.map((a,i)=>`<div class="feed-item"><span class="feed-sticker">${CARD_STICKERS[i%3]}</span>
       <div class="feed-detail"><div class="feed-meta"><strong>${safe(a.who?.nickname||'Player')}</strong><span>${safe(carDisplay(a.who?.car_number??'?'))} · Player ${a.who?.seat_number??'?'}</span></div>
       <p>${safe(a.mission_text)}</p><small>${new Date(a.completed_at).toLocaleString('th-TH',{dateStyle:'short',timeStyle:'short'})}</small></div><span class="feed-check">${icon('tick',15)}</span></div>`).join('')}</div>` : `<div class="empty-feed"><span>🕹️</span><h3>ยังไม่มีคนเปิดเผยภารกิจ</h3><p>พอมีใครกด “ทำสำเร็จแล้ว” โจทย์นั้นจะปรากฏตรงนี้ให้เพื่อนทุกคนเห็นทันที</p></div>`}
  </section>`;
}
function roster() {
  return `<section class="roster-section"><div class="head-row"><div><span class="eyebrow-text">WHO'S ON BOARD?</span><h2>สมาชิกทั้ง ${state.teamCount} คัน 🚙</h2></div></div>
    ${activeCars().map(c=>`<div class="roster-car"><h3>${c.emoji} ${safe(carDisplay(c.n))} <span>${state.players.filter(p=>p.car_number===c.n).length}/${teamCapacity(c.n)} คน</span></h3>
      <div class="roster-list">${Array.from({length:teamCapacity(c.n)},(_,index)=>index+1).map(seat=>{
         const p=state.players.find(x=>x.car_number===c.n&&x.seat_number===seat);
         return `<div class="roster-player"><span class="roster-avatar">${p?'🙂':'◌'}</span><span class="roster-name">${p?safe(p.nickname):`Player ${seat} · ยังว่าง`}</span>
         <span class="roster-progress">${p?`${doneCount(p.id)} / ${state.missionsPerPlayer} ✓`:'—'}</span></div>`;
       }).join('')}</div></div>`).join('')}</section>`;
}
function confirmation() {
  if(!state.confirming) return '';
  const a=state.assignments.find(x=>x.id===state.confirming);
  if(!a) return '';
  return `<div class="dialog-backdrop" role="presentation"><div class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
    <div class="dialog-emoji">🎉</div><h2 id="confirm-title">ทำภารกิจสำเร็จแล้วใช่ไหม?</h2>
    <p>กดตกลงแล้ว <b>ทุกคนในห้องจะเห็นโจทย์นี้ทันที</b> และไม่สามารถยกเลิกการเปิดเผยได้</p>
    <div class="dialog-task">“${safe(a.mission_text)}”</div>
    <div class="dialog-buttons"><button class="btn outline" data-action="cancel-complete">ยังไม่ใช่</button>
      <button class="btn primary" data-action="confirm-complete" ${state.busy?'disabled':''}>${state.busy?'กำลังบันทึก...':'ยืนยันสำเร็จ ✓'}</button></div>
  </div></div>`;
}
function rerollConfirmation() {
  if(!state.confirmingReroll)return '';
  const a=state.assignments.find(x=>x.id===state.confirmingReroll && x.player_id===state.player?.id);
  if(!a || a.completed_at || a.rerolled_at)return '';
  return `<div class="dialog-backdrop" role="presentation"><div class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="reroll-title">
    <div class="dialog-emoji">🎲</div><h2 id="reroll-title">สุ่มภารกิจใหม่?</h2>
    <p>การ์ดใบนี้เปลี่ยนได้ <b>1 ครั้งเท่านั้น</b> เมื่อยืนยันแล้วกลับไปโจทย์เดิมไม่ได้</p>
    <div class="dialog-task">“${safe(a.mission_text)}”</div>
    <div class="dialog-buttons"><button class="btn outline" data-action="cancel-reroll">ใช้โจทย์เดิม</button>
      <button class="btn primary" data-action="confirm-reroll" ${state.busy?'disabled':''}>${state.busy?'กำลังสุ่ม...':'ยืนยันสุ่มใหม่ 🎲'}</button></div>
  </div></div>`;
}
function gameView() {
  const mine=state.assignments.filter(a=>a.player_id===state.player?.id).sort((a,b)=>a.card_number-b.card_number);
  const done=mine.filter(a=>a.completed_at).length;
  return `${header('MULTIPLAYER LIVE')}
    <main class="container game-main">
      <div class="game-welcome"><div><span class="eyebrow-text">HELLO, SECRET AGENT ✌</span><h1>Hey, ${safe(state.player?.nickname || 'Player')}!</h1>
         <p>${safe(carDisplay(state.player?.car_number))} · Player ${state.player?.seat_number} <span class="little-divider">✳</span> ${done}/${state.missionsPerPlayer} missions done</p></div>
         <div class="avatar-bubble">🕵️</div></div>
      <div class="room-banner"><div><small>YOUR TRIP ROOM</small><strong>${safe(state.roomCode)}</strong></div><button data-action="share" class="light-pill">${icon('copy',16)} เชิญเพื่อน</button></div>
      <div class="tabbar" role="tablist"><button role="tab" class="${state.tab==='cards'?'active':''}" data-action="tab" data-tab="cards">🎮 การ์ดของฉัน <span>${done}/${state.missionsPerPlayer}</span></button>
        <button role="tab" class="${state.tab==='board'?'active':''}" data-action="tab" data-tab="board">🏆 Live Board <span>${state.assignments.filter(x=>x.completed_at).length}</span></button></div>
      ${state.tab === 'cards' ? `<div class="my-missions-header">${stepLabel('✦','TOP SECRET · FOR YOUR EYES ONLY')}<h2>ภารกิจของเธอ <span>${state.missionsPerPlayer} ใบ</span></h2><p>ภารกิจที่ยังไม่สำเร็จเป็นความลับของเธอคนเดียว พอสำเร็จ เพื่อนทุกคนจะเห็นโจทย์ใน Live Board!</p></div>
         <div class="mission-stack">${mine.length===state.missionsPerPlayer ? mine.map(missionCard).join('') : `<div class="empty-feed"><span>📦</span><p>กำลังเตรียมการ์ดของคุณ ลองโหลดหน้าใหม่อีกครั้ง</p></div>`}</div>
         <div class="progress-summary"><div><span>YOUR PROGRESS</span><strong>${done} / ${state.missionsPerPlayer} completed</strong></div>
            <div class="progress-track"><span style="width:${done/state.missionsPerPlayer*100}%"></span></div></div>
         <button class="btn outline board-cta" data-action="tab" data-tab="board">ดูภารกิจที่เพื่อนทำสำเร็จ ${icon('arrow',18)}</button>` : `${scoreboard()}${missionFeed()}${roster()}`}
      <div class="game-bottom"><span>🚗</span> KEEP IT FUN, KEEP IT SECRET <span>🏁</span><p>คนขับตั้งใจขับรถนะ ให้ผู้โดยสารเป็นคนเล่น</p>
        <button class="subtle-link" data-action="home">เปลี่ยนห้อง / กลับหน้าแรก</button></div>
    </main>${confirmation()}${rerollConfirmation()}`;
}
function revealNotice() {
  const a=state.latestReveal;
  if(!a) return '';
  // Re-renders replace the toast; continue its 300ms slide-in instead of replaying it.
  const elapsed=Date.now()-a.shownAt;
  return `<aside class="reveal-toast" role="status" aria-live="polite" style="${elapsed<300?`animation-delay:-${elapsed}ms`:'animation:none'}">
    <div class="reveal-emoji">🎉</div>
    <div class="reveal-copy"><strong>มีคนเปิดเผยโจทย์ใหม่!</strong>
      <small>${safe(a.who)} · ${safe(carDisplay(a.car))} ทำสำเร็จแล้ว</small>
      <p>“${safe(a.text)}”</p>
      <button data-action="tab" data-tab="board">ไปดู Live Board →</button></div>
    <button class="reveal-close" aria-label="ปิดการแจ้งเตือน" data-action="dismiss-reveal">${icon('close',15)}</button>
  </aside>`;
}
function render() {
  const content = state.screen==='setup' ? setupView()
    : state.screen==='offline' ? connectErrorView()
    : state.screen==='sentence' ? sentenceDraw.view()
    : state.screen==='seats' ? seatsView()
    : state.screen==='game' ? gameView()
    : state.mode==='sentences' ? sentenceDraw.view() : welcomeView();
  $app.innerHTML = `${wave()}${content}${state.screen==='game'?revealNotice():''}`;
}
function toast(message, bad=false) {
  document.querySelector('.toast')?.remove();
  const el=document.createElement('div');el.className=`toast ${bad?'bad':''}`;
  el.setAttribute('role','status');el.textContent=message;document.body.append(el);
  setTimeout(()=>el.remove(),4200);
}
async function withBusy(fn) {
  if (state.busy) return;
  state.busy=true; render();
  try { await fn(); } catch(err) { console.error(err); toast(errorMessage(err),true); }
  finally { state.busy=false;render(); }
}
async function ensureAuth() {
  const { data:{session}, error:e1 }=await db.auth.getSession();
  if(e1) throw e1;
  if(session?.user) {state.user=session.user;return;}
  const {data,error}=await db.auth.signInAnonymously();
  if(error) throw error;
  state.user=data.user;
}
async function loadRoom(code) {
  const normalized=codeOnly(code);
  if(normalized.length!==8) throw new Error('รหัสห้องต้องเป็นตัวเลขหรือ A–F จำนวน 8 ตัว');
  const {data:room,error:e1}=await rpc('trip_room_status',{p_code:normalized});
  if(e1) throw e1;
  state.roomCode=room.code;state.roomId=room.id;state.seats=room.seats||[];
  state.playerLimit=Number(room.player_limit||16);state.teamCount=Number(room.team_count||4);
  state.teamNames=Array.isArray(room.team_names) ? room.team_names : [];
  state.missionsPerPlayer=Number(room.missions_per_player||3);
  if(state.selectedCar>state.teamCount)state.selectedCar=1;
  const {data:me,error:e2}=await authed(()=>db.from('trip_players').select('*').eq('room_id',room.id).eq('user_id',state.user.id).maybeSingle());
  if(e2) throw e2;
  state.player=me || null;
  writeLocal('trip_room_code',room.code);
  const currentUrl=new URL(location.href);currentUrl.searchParams.set('room',room.code);history.replaceState(null,'',currentUrl);
  if(me) {state.screen='game';await refreshData();subscribeToRoom();}
  else {stopSubscription();state.screen='seats';state.selectedSeat=null;}
  render();
}
async function refreshSeats() {
  if(!state.roomCode) return;
  const {data,error}=await rpc('trip_room_status',{p_code:state.roomCode});
  if(error) throw error;
  state.seats=data.seats||[];
  state.playerLimit=Number(data.player_limit||state.playerLimit);state.teamCount=Number(data.team_count||state.teamCount);
  state.teamNames=Array.isArray(data.team_names) ? data.team_names : [];
  state.missionsPerPlayer=Number(data.missions_per_player||state.missionsPerPlayer);render();
}
async function refreshData() {
  if(!db || state.screen!=='game' || !state.roomId) return;
  if(fetching) {fetchQueued=true;return;}
  fetching=true;
  const roomId=state.roomId;
  try {
    const [pr,ar]=await Promise.all([
      authed(()=>db.from('trip_players').select('id,room_id,user_id,nickname,car_number,seat_number').eq('room_id',roomId)),
      authed(()=>db.from('trip_assignments').select('id,room_id,player_id,card_number,mission_text,completed_at,rerolled_at').eq('room_id',roomId)),
    ]);
    if(pr.error) throw pr.error;
    if(ar.error) throw ar.error;
    if(state.roomId!==roomId) return;
    // On subsequent updates, announce newly finished missions to everyone,
    // even if they are looking at their own cards instead of the Live Board.
    const hadSnapshot=state.players.length>0 || state.assignments.length>0;
    const existingDone=new Set(state.assignments.filter(a=>a.completed_at).map(a=>a.id));
    const revealed=hadSnapshot ? (ar.data||[])
      .filter(a=>a.completed_at && !existingDone.has(a.id))
      .sort((a,b)=>new Date(b.completed_at)-new Date(a.completed_at))[0] : null;
    state.players=pr.data||[];
    state.assignments=ar.data||[];
    if(revealed) {
      const who=state.players.find(p=>p.id===revealed.player_id);
      state.latestReveal={id:revealed.id,text:revealed.mission_text,
        who:who?.nickname||'Player',car:who?.car_number||'?',shownAt:Date.now()};
      setTimeout(()=>{
        if(state.latestReveal?.id===revealed.id) {
          state.latestReveal=null;
          if(state.screen==='game') render();
        }
      },7500);
    }
    const updatedMe=state.players.find(p=>p.user_id===state.user?.id);
    if(updatedMe) state.player=updatedMe;
    render();
  } catch(err) {console.warn('Refresh failed:',err);}
  finally {fetching=false;if(fetchQueued){fetchQueued=false;setTimeout(refreshData,200);}}
}
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer=setTimeout(refreshData,170);
}
function stopSubscription() {
  if(liveChannel && db) db.removeChannel(liveChannel);
  liveChannel=null;state.live='connecting';
}
function subscribeToRoom() {
  stopSubscription();
  if(!state.roomId) return;
  const id=state.roomId;
  liveChannel=db.channel(`roadtrip-room-${id}-${Math.random().toString(16).slice(2,8)}`)
    .on('postgres_changes',{event:'*',schema:'public',table:'trip_assignments',filter:`room_id=eq.${id}`},scheduleRefresh)
    .on('postgres_changes',{event:'*',schema:'public',table:'trip_players',filter:`room_id=eq.${id}`},scheduleRefresh)
    .subscribe(status=>{
      const next=status==='SUBSCRIBED'?'connected':'connecting';
      if(state.live!==next){state.live=next;if(state.screen==='game')render();}
      if(status==='SUBSCRIBED') scheduleRefresh();
    });
}
async function shareInvite() {
  const url=new URL(location.href);url.searchParams.set('room',state.roomCode);
  const message=`เข้ามาเล่น Secret Mission กัน! 🚗🎮\nรหัสห้อง ${state.roomCode}\n${url.toString()}`;
  if(navigator.share) {
    try {await navigator.share({title:'Secret Mission Road Trip',text:`มาเล่นเกมกัน! รหัส ${state.roomCode}`,url:url.toString()});return;}
    catch(e){if(e?.name==='AbortError')return;}
  }
  try {await navigator.clipboard.writeText(message);toast('คัดลอกลิงก์เชิญเพื่อนแล้ว! ✨');}
  catch {toast(`Room code: ${state.roomCode}`);}
}
function backHome() {
  const wasSentence=state.screen==='sentence'||state.mode==='sentences';
  stopSubscription();sentenceDraw.leave();state.screen='welcome';state.mode=wasSentence?'sentences':'missions';state.roomId='';state.roomCode='';state.player=null;
  state.players=[];state.assignments=[];state.teamNames=[];state.confirming=null;state.confirmingReroll=null;state.latestReveal=null;state.flipped.clear();
  removeLocal('trip_room_code');
  history.replaceState(null,'',state.mode==='sentences'?`${location.pathname}?mode=sentences`:location.pathname);
  render();
}
$app.addEventListener('click',async(e)=>{
  const el=e.target.closest('[data-action]');if(!el||state.busy||sentenceDraw.isBusy())return;
  const action=el.dataset.action;
  if(action==='home')return backHome();
  if(action==='reload')return location.reload();
  if(action==='select-mode'){
    stopSubscription();sentenceDraw.leave();
    state.mode=el.dataset.mode==='sentences'?'sentences':'missions';state.screen='welcome';
    history.replaceState(null,'',state.mode==='sentences'?`${location.pathname}?mode=sentences`:location.pathname);
    render();return;
  }
  if(await sentenceDraw.handleClick(action))return;
  if(action==='dismiss-reveal'){state.latestReveal=null;render();return;}
  if(action==='share')return shareInvite();
  if(action==='select-car'){state.selectedCar=Number(el.dataset.car);state.selectedSeat=null;render();return;}
  if(action==='select-seat'){state.selectedSeat=Number(el.dataset.seat);render();return;}
  if(action==='tab'){state.tab=el.dataset.tab;render();window.scrollTo({top:0,behavior:'smooth'});return;}
  if(action==='flip'){
    const id=el.dataset.id;
    state.flipped.has(id)?state.flipped.delete(id):state.flipped.add(id);
    render();return;
  }
  if(action==='ask-reroll'){
    const a=state.assignments.find(x=>x.id===el.dataset.id && x.player_id===state.player?.id);
    if(!a || a.completed_at || a.rerolled_at)return;
    state.confirmingReroll=a.id;render();return;
  }
  if(action==='cancel-reroll'){state.confirmingReroll=null;render();return;}
  if(action==='confirm-reroll'){
    const id=state.confirmingReroll;
    const a=state.assignments.find(x=>x.id===id && x.player_id===state.player?.id);
    if(!a || a.completed_at || a.rerolled_at){state.confirmingReroll=null;render();return;}
    await withBusy(async()=>{
      const {data,error}=await rpc('trip_reroll_mission',{p_assignment_id:id});
      if(error) throw error;
      const index=state.assignments.findIndex(x=>x.id===id);
      if(index>=0)state.assignments[index]={...state.assignments[index],mission_text:data.mission_text,rerolled_at:data.rerolled_at};
      state.flipped.delete(id);
      state.confirmingReroll=null;
      await refreshData();
      toast('ได้รับโจทย์ใหม่แล้ว! การ์ดนี้สุ่มซ้ำไม่ได้ 🎲');
    });return;
  }
  if(action==='ask-complete'){state.confirming=el.dataset.id;render();return;}
  if(action==='cancel-complete'){state.confirming=null;render();return;}
  if(action==='confirm-complete'){
    await withBusy(async()=>{
      const {error}=await rpc('trip_complete_mission',{p_assignment_id:state.confirming});
      if(error) throw error;
      state.confirming=null;
      await refreshData();
      toast('สำเร็จแล้ว! โจทย์เปิดเผยให้เพื่อนทั้งห้อง 🎉');
    });return;
  }
});
$app.addEventListener('submit',async(e)=>{
  if(e.target.id.startsWith('sentence-')){e.preventDefault();await sentenceDraw.handleSubmit(e.target);return;}
  if(e.target.id==='mission-create-form'){
    e.preventDefault();const formData=new FormData(e.target);
    const playerLimit=Number(formData.get('player_limit'));
    const teamCount=Number(formData.get('team_count'));
    const missionsPerPlayer=Number(formData.get('missions_per_player'));
    if(!isValidMissionSettings(playerLimit,teamCount,missionsPerPlayer)){
      toast('ตั้งค่าได้สูงสุด 24 คน, 8 ทีม, 6 โจทย์ต่อคน และรวมไม่เกิน 72 โจทย์',true);return;
    }
    const teamNames=Array.from({length:teamCount},(_,i)=>String(formData.get(`team_name_${i+1}`)||'').trim()||`Car ${i+1}`);
    if(new Set(teamNames.map(name=>name.toLocaleLowerCase())).size!==teamCount){
      toast('ชื่อรถห้ามซ้ำกัน กรุณาตั้งชื่อแต่ละคันให้ต่างกัน',true);return;
    }
    await withBusy(async()=>{
      const {data,error}=await rpc('trip_create_named_room',{
        p_player_limit:playerLimit,p_team_count:teamCount,
        p_missions_per_player:missionsPerPlayer,p_team_names:teamNames,
      });if(error)throw error;
      await loadRoom(data.code);
      toast('สร้างห้องแล้ว! แชร์โค้ดให้เพื่อนได้เลย 🎈');
    });return;
  }
  if(e.target.id==='join-room-form'){
    e.preventDefault();const code=new FormData(e.target).get('code');
    await withBusy(()=>loadRoom(code));
  }
  if(e.target.id==='join-seat-form'){
    e.preventDefault();const nickname=String(new FormData(e.target).get('nickname')||'').trim();
    await withBusy(async()=>{
      const {error}=await rpc('trip_join_seat',{
        p_code:state.roomCode,p_car:state.selectedCar,p_seat:state.selectedSeat,p_nickname:nickname,
      });
      if(error){if(error.message?.includes('SEAT_TAKEN'))await refreshSeats();throw error;}
      state.tab='cards';await loadRoom(state.roomCode);
       toast(`ยินดีต้อนรับ! รับภารกิจลับ ${state.missionsPerPlayer} ใบแล้ว 🎮`);
    });
  }
});
$app.addEventListener('input',(e)=>{
  if(e.target.closest('#mission-create-form')){
    if(e.target.name==='player_limit')state.draftPlayerLimit=e.target.value;
    if(e.target.name==='missions_per_player')state.draftMissionsPerPlayer=e.target.value;
    if(e.target.name==='team_count'){
      state.draftTeamCount=e.target.value;
      const count=Number(e.target.value);
      if(Number.isInteger(count) && count>=1 && count<=8){
        const fields=document.querySelector('#team-name-fields');
        if(fields)fields.innerHTML=draftTeamNameInputs(count);
      }
    }
    const match=e.target.name?.match(/^team_name_([1-8])$/);
    if(match)state.draftTeamNames[Number(match[1])-1]=e.target.value;
    return;
  }
  if(e.target.id==='nickname'){state.nickname=e.target.value;return;}
  sentenceDraw.handleInput(e.target);
});

async function init() {
  if(!isConfigured){state.screen='setup';render();return;}
  render();
  try {
    await ensureAuth();
    const params=new URLSearchParams(location.search);
    state.mode=params.get('mode')==='sentences'?'sentences':'missions';
    const queryCode=params.get('room');
    if(state.mode==='sentences'){
      const target=queryCode||readLocal('sentence_draw_room_code');
      if(target){
        state.screen='sentence';
        try{await sentenceDraw.enter(target);}catch(err){console.warn(err);backHome();toast(errorMessage(err),true);}
      } else render();
    } else {
      const target=queryCode||readLocal('trip_room_code');
      if(target){try{await loadRoom(target);}catch(err){console.warn(err);backHome();toast(errorMessage(err),true);}}
      else render();
    }
  } catch(err){console.error(err);state.error=errorMessage(err);state.screen='offline';render();}
  setInterval(()=>{
    if(document.visibilityState==='visible' && state.screen==='game') refreshData();
    if(document.visibilityState==='visible' && sentenceDraw.inRoom()) sentenceDraw.refresh();
    if(document.visibilityState==='visible' && state.screen==='seats') {
      rpc('trip_room_status',{p_code:state.roomCode}).then(({data})=>{
        if(data && state.screen==='seats' && JSON.stringify(data.seats)!==JSON.stringify(state.seats)){
          state.seats=data.seats;state.playerLimit=Number(data.player_limit||state.playerLimit);
          state.teamCount=Number(data.team_count||state.teamCount);
           state.teamNames=Array.isArray(data.team_names) ? data.team_names : [];
           state.missionsPerPlayer=Number(data.missions_per_player||state.missionsPerPlayer);
          // Re-rendering mid-typing would close the phone keyboard; join-seat still rechecks the seat.
          if(document.activeElement?.id!=='nickname') render();
        }
      });
    }
  },15000);
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible' && state.screen==='game') scheduleRefresh();
    if(document.visibilityState==='visible' && sentenceDraw.inRoom()) sentenceDraw.refresh();
  });
}
init();
