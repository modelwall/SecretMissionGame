const MISSIONS = [
'ทำให้เพื่อนพูดคำว่า “หมูกระทะ” โดยที่เราไม่ได้พูดคำนั้นก่อน',
'ทำให้เพื่อน 1 คนร้องเพลงออกมาสักท่อน',
'ทำให้มีคนพูดว่า “อะไรของแกเนี่ย!”',
'ทำให้เพื่อนเล่าเรื่องน่าอายสมัยเรียน',
'ทำให้มีคนชมว่าเราเป็นคนตลก',
'ทำให้เพื่อนพูดชื่อจังหวัดอย่างน้อย 3 จังหวัด',
'ชวนให้เพื่อนเล่าเรื่องการเดินทางที่พีคที่สุด',
'ทำให้เพื่อนพูดว่า “ไม่เชื่อ!”',
'ทำให้เพื่อน 2 คนเถียงกันเล่น ๆ ว่าควรใส่สับปะรดบนพิซซ่าไหม',
'ทำให้เพื่อนเสนอชื่อร้านอาหารสำหรับมื้อถัดไป',
'ทำให้มีคนพูดว่า “เดี๋ยวก่อน!”',
'ทำให้เพื่อนเล่าวีรกรรมที่เคยโดนครูดุ',
'ทำให้เพื่อนเลียนเสียงสัตว์อย่างน้อย 1 ชนิด',
'ทำให้เพื่อนพูดชื่อหนังหรือซีรีส์ที่ดูซ้ำหลายรอบ',
'ทำให้เพื่อนหัวเราะกับมุกแป้กของเรา',
'ทำให้เพื่อนพูดว่า “เอาจริงดิ?”',
'ทำให้เพื่อนบอกฉายาตอนเด็กของตัวเอง',
'ทำให้เพื่อนเล่าเรื่องทำอาหารพัง',
'ทำให้มีคนพูดว่า “เหมือนกันเลย!”',
'ทำให้เพื่อนเลือกว่าจะมีพลังล่องหนหรือบินได้',
'ชวนให้เพื่อนพูดชื่อเพลงที่ฟังแล้วคิดถึงวัยเรียน',
'ทำให้เพื่อนเล่าเรื่องเข้าใจผิดที่ฮาที่สุด',
'ทำให้เพื่อนพูดว่า “โอ๊ย!” เพราะขำ',
'ทำให้เพื่อนแนะนำของกินที่คนอื่นยังไม่เคยลอง',
'ทำให้มีคนทายวันเกิดของเรา (เดือนได้ก็พอ)',
'ทำให้เพื่อนเล่าว่าเคยมีสัตว์เลี้ยงชื่ออะไร',
'ทำให้เพื่อนพูดชื่อการ์ตูนวัยเด็ก',
'ทำให้เพื่อนตั้งชื่อวงดนตรีให้คนในรถ',
'ทำให้มีคนพูดว่า “ไม่ไหวแล้ว” เพราะขำ',
'ทำให้เพื่อนบอกเมนูที่กินได้ทุกวัน',
'ทำให้เพื่อนเล่าเรื่องที่เคยหลงทาง',
'ทำให้เพื่อนตอบว่าอยากย้อนวัยกลับไปอายุเท่าไร',
'ทำให้เพื่อนเลือกหนึ่งอย่างระหว่างทะเลกับภูเขา',
'ทำให้เพื่อนบอกว่าอยากไปเที่ยวประเทศไหนที่สุด',
'ทำให้เพื่อนพูดชื่อคนดังที่อยากเจอ',
'ทำให้เพื่อนเล่าเรื่องของขวัญสุดประหลาดที่เคยได้',
'ทำให้เพื่อนคิดชื่อเล่นใหม่ให้เรา',
'ทำให้เพื่อนเล่าว่าถูกเพื่อนแกล้งเรื่องอะไร',
'ทำให้มีคนพูดว่า “ใครจะไปเชื่อ!”',
'ทำให้เพื่อนบอกว่าอยากลองทำอาชีพอะไรหนึ่งวัน',
'ทำให้เพื่อนเล่าเรื่องฝันประหลาดล่าสุดที่ยังจำได้',
'ทำให้เพื่อนทายว่าในรถนี้ใครน่าจะตื่นสายที่สุด',
'ทำให้มีคนพูดว่า “อย่างปั่น!”',
'ทำให้เพื่อนบอกชื่ออาหารที่ไม่ชอบตอนเด็กแต่โตมาแล้วชอบ',
'ทำให้เพื่อนคิดสโลแกนสั้น ๆ ให้ทริปนี้',
'ทำให้เพื่อนเล่าเรื่องที่ทำแล้วภูมิใจแบบขำ ๆ',
'ทำให้มีคนพูดว่า “จริงเหรอเนี่ย?”',
'ทำให้เพื่อนบอกหนึ่งเรื่องที่คนอื่นมักเข้าใจเขาผิด'
];
const AVATARS=['🐻','🐰','🐸','🐥'];
const COLORS=['pink','purple','yellow'];
const CAR_EMOJI=['🚗','🚙','🚕','🚐'];
const LS_KEY='roadtrip-secret-mission-v1';
let state={view:'home',car:0,player:0,revealed:[],round:0,done:{}};
try{const saved=JSON.parse(localStorage.getItem(LS_KEY)||'{}');state.round=Number.isInteger(saved.round)&&saved.round>=0?saved.round:0;state.done=saved.done&&typeof saved.done==='object'?saved.done:{}}catch(e){}
const $=(sel)=>document.querySelector(sel);
const app=$('#app');
function save(){try{localStorage.setItem(LS_KEY,JSON.stringify({round:state.round,done:state.done}))}catch(e){}}
function shuffle(seed){let a=Array.from({length:MISSIONS.length},(_,i)=>i);let rng=seed>>>0;for(let i=a.length-1;i>0;i--){rng=(Math.imul(1664525,rng)+1013904223)>>>0;const j=rng%(i+1);[a[i],a[j]]=[a[j],a[i]]}return a}
function idx(car,player,card){return car*12+player*3+card}
function key(car,player,card){return `${state.round}:${car}:${player}:${card}`}
function getMission(car,player,card){const ids=shuffle(17791+state.round*1009);return MISSIONS[ids[idx(car,player,card)]]}
function isDone(car,player,card){return !!state.done[key(car,player,card)]}
function countPlayer(car,player){return [0,1,2].filter(i=>isDone(car,player,i)).length}
function countCar(car){return [0,1,2,3].reduce((sum,p)=>sum+countPlayer(car,p),0)}
function render(){
 $('#backBtn').classList.toggle('hidden',state.view==='home');
 if(state.view==='home')return renderHome();
 if(state.view==='car')return renderCar();
 renderPlayer();
}
function renderHome(){
 app.innerHTML=`<div class="eyebrow">✦ THE ROAD TRIP GAME ✦</div>
 <h1 class="heading">Secret <em>Mission!</em></h1>
 <p class="intro">ภารกิจลับสุดป่วน ระหว่างทางก็ฮาได้!<br>เลือกคันรถของตัวเอง แล้วเตรียมปฏิบัติการลับกันเลย 💌</p>
 <div class="hero-art" aria-hidden="true"><div class="hero-copy">4 CARS.<br>16 FRIENDS.<br>48 MISSIONS.<small>let the silly adventure begin!</small></div><div class="star one">✿</div><div class="star two">✦</div><div class="road"></div><div class="car-illustration"><div class="car-top"></div><div class="car-body"></div><div class="car-window"></div><div class="car-window two"></div><div class="wheel one"></div><div class="wheel two"></div></div></div>
 <div class="section-header"><h2 class="section-title">Choose your car 🚘</h2><span class="section-sub">4 TEAMS</span></div>
 <div class="cars">${[0,1,2,3].map(c=>`<button class="car-card" data-car="${c}"><span class="car-no">TEAM 0${c+1}</span><span class="car-label">คันที่ ${c+1}</span><span class="arrow">↗</span><span class="emoji" aria-hidden="true">${CAR_EMOJI[c]}</span><span class="count">${countCar(c)} / 12 missions done</span></button>`).join('')}</div>
 <div class="tip">💡 <b>How to play:</b> แต่ละคันมี Player 1–4 คนละ 3 ภารกิจ เปิดอ่านของตัวเอง แล้วแอบทำให้สำเร็จโดยเพื่อนไม่รู้ตัว!</div>
 <div style="text-align:center"><button class="small-link" id="newRound">↻ เริ่มเกมรอบใหม่ (สุ่มภารกิจใหม่ทั้งหมด)</button></div>`;
 app.querySelectorAll('[data-car]').forEach(b=>b.addEventListener('click',()=>{state.car=Number(b.dataset.car);state.view='car';navigate()}));
 $('#newRound').addEventListener('click',()=>{if(confirm('เริ่มรอบใหม่ใช่ไหม? การ์ดทุกใบจะเปลี่ยน และคะแนนที่ทำสำเร็จจะเริ่มใหม่')){state.round++;state.done={};save();render()}});
}
function renderCar(){const c=state.car;app.innerHTML=`
 <div class="nav-crumb">HOME / TEAM 0${c+1}</div>
 <div class="car-title"><div class="car-icon-big">${CAR_EMOJI[c]}</div><div><h1 class="heading">Car ${c+1} <em>crew!</em></h1><p class="intro">เลือกการ์ดของตัวเอง ห้ามแอบดูของเพื่อนนะ 👀</p></div></div>
 <div class="progress-panel"><div class="progress-head"><span>✨ Mission progress</span><span>${countCar(c)} / 12</span></div><div class="track"><div class="track-fill" style="width:${countCar(c)/12*100}%"></div></div></div>
 <div class="section-header"><h2 class="section-title">Who's playing?</h2><span class="section-sub">4 PLAYERS</span></div>
 <div class="players">${[0,1,2,3].map(p=>`<button class="player-card" data-player="${p}"><span class="player-number">MEMBER 0${p+1}</span><div class="player-title">Player ${p+1}</div><span class="player-avatar" aria-hidden="true">${AVATARS[p]}</span><span class="player-progress">${countPlayer(c,p)} / 3 cards done →</span></button>`).join('')}</div>
 <div class="warning">🔒 <b>Secret zone!</b> เปิดการ์ดทีละคนแล้วปิดก่อนส่งมือถือให้เพื่อน เพื่อไม่ให้ภารกิจลับรั่วไหล</div>`;
 app.querySelectorAll('[data-player]').forEach(b=>b.addEventListener('click',()=>{state.player=Number(b.dataset.player);state.revealed=[false,false,false];state.view='player';navigate()}));
}
function renderPlayer(){const c=state.car,p=state.player;app.innerHTML=`
 <div class="nav-crumb">TEAM 0${c+1} / PLAYER 0${p+1}</div>
 <div class="player-head"><div class="badge-person">${AVATARS[p]}</div><h1 class="heading">Hey, <em>Player ${p+1}!</em></h1><p class="intro">คุณได้รับ 3 ภารกิจลับ 🤫<br>เปิดดูทีละใบ แล้วอย่าให้ใครเห็นนะ!</p></div>
 <div class="stat-summary"><span>✦ ${countPlayer(c,p)} / 3 completed</span><span>🏆 ${countPlayer(c,p)*3} points</span></div>
 <div class="mission-list">${[0,1,2].map(i=>{const opened=state.revealed[i],done=isDone(c,p,i);return `<article class="mission-card ${COLORS[i]} ${done?'done':''}">
 <div class="mission-top"><span class="mission-n">✦ SECRET CARD 0${i+1}</span><span class="state-tag">${done?'✓ DONE':opened?'TOP SECRET':'LOCKED 🔒'}</span></div>
 <div class="mission-body">${opened?`<p class="mission-description">${getMission(c,p,i)}</p><div class="mission-buttons"><button class="card-action" data-flip="${i}">🙈 ซ่อนการ์ด</button><button class="success-button" data-done="${i}">${done?'↶ ยกเลิกสำเร็จ':'✓ ทำสำเร็จแล้ว'}</button></div>`:`<div class="mystery-icon">?</div><button class="card-action" data-flip="${i}">👀 แตะเพื่อเปิดภารกิจ</button>`}</div>
 </article>`}).join('')}</div>
 ${countPlayer(c,p)===3?'<div class="completed-banner">🎉 สุดยอด! ทำภารกิจครบทั้ง 3 ใบแล้ว!</div>':''}
 <p class="bottom-note">จำไว้นะ… ภารกิจจะสำเร็จก็ต่อเมื่อเพื่อนไม่รู้ตัว!<br>ปิดการ์ดก่อนส่งมือถือให้เพื่อนคนถัดไป 💖</p>`;
 app.querySelectorAll('[data-flip]').forEach(b=>b.addEventListener('click',()=>{const i=Number(b.dataset.flip);state.revealed[i]=!state.revealed[i];renderPlayer()}));
 app.querySelectorAll('[data-done]').forEach(b=>b.addEventListener('click',()=>{const i=Number(b.dataset.done),k=key(c,p,i);state.done[k]=!state.done[k];save();renderPlayer()}));
}
function navigate(){render();window.scrollTo({top:0,behavior:'instant'})}
$('#backBtn').addEventListener('click',()=>{if(state.view==='player'){state.revealed=[false,false,false];state.view='car'}else state.view='home';navigate()});
$('#infoBtn').addEventListener('click',()=>$('#infoDialog').showModal());
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>$('#infoDialog').close()));
$('#infoDialog').addEventListener('click',e=>{if(e.target.id==='infoDialog')e.target.close()});
render();
