'use strict';
// 오락실 튜토리얼이 '진짜로 일어난 일'을 알아채는 신호 (튜토리얼이 아니면 아무도 안 듣는다)
const tutorialSignal = (type) => window.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { type } }));

// 점프 대시: 화면·입력·소리. 규칙은 logic.js (LOGIC_JD), 코스는 levels.js. 여기서는 규칙이 알려 주는 일(events)을 보고 소리·효과를 만든다.
const L = LOGIC_JD;
const { VIEW_W, VIEW_H, CEIL, PLAYER_COL, DT } = L;
const CELL = 20, W = VIEW_W * CELL, H = VIEW_H * CELL;       // 논리 크기 360 x 180
const GROUND_Y = H - 2 * CELL;                                // 땅의 윗면 (y=0)
const TUTORIAL = /[?&]tutorial=1/.test(location.search);

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

function fit() {
  const hintH = getComputedStyle($('hint')).display === 'none' ? 0 : $('hint').offsetHeight + 10;
  const scale = Math.min((innerWidth - 16) / W, (innerHeight - 16 - hintH) / H);
  const cssW = Math.max(160, Math.floor(W * scale)), cssH = Math.floor(cssW * H / W);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px'; $('wrap').style.setProperty('--s', String(cssW / W));
  canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
  ctx.imageSmoothingEnabled = false;
  $('hint').style.display = innerWidth < innerHeight && innerWidth < 600 ? '' : 'none';       // 세로 화면(폰)에서만 '가로로 돌려 보세요' 안내
}
addEventListener('resize', fit);
addEventListener('orientationchange', () => setTimeout(fit, 150));

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};

// ---------- 소리: 박자(규칙이 알려 줌)에 맞춰 킥·하이햇·베이스·멜로디를 낸다 ----------
let audio = null;
let muted = store.get('jdMuted') === '1';
function tone(freq, dur, type = 'square', vol = 0.04, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination);
    o.start(t); o.stop(t + dur);
  } catch (_) {}
}
const melody = (notes, step, type = 'square', vol = 0.045) => notes.forEach((f, i) => { if (f) setTimeout(() => tone(f, step * 0.9 / 1000, type, vol), i * step); });
// 레벨마다 다른 음 (낮은 음 = 베이스, 높은 음 = 멜로디). 한 마디 = 4박자 = 8개의 반박
const MUSIC = [
  { bass: [110, 110, 131, 98], lead: [440, 0, 523, 0, 659, 0, 523, 0, 440, 0, 392, 0, 440, 0, 523, 0] },
  { bass: [98, 98, 123, 110], lead: [392, 494, 587, 494, 392, 494, 659, 587, 392, 494, 587, 494, 440, 523, 659, 523] },
  { bass: [82, 82, 98, 73], lead: [330, 0, 392, 494, 0, 392, 330, 0, 294, 0, 370, 440, 0, 370, 294, 0] },
];
const sfx = {
  jump: () => tone(520, 0.09, 'square', 0.03, 380),
  pad: () => tone(300, 0.25, 'triangle', 0.06, 900),
  portal: () => melody([392, 523, 659, 880], 55, 'sawtooth', 0.03),
  die: () => { tone(220, 0.35, 'sawtooth', 0.07, -170); setTimeout(() => tone(90, 0.3, 'square', 0.06, -50), 80); },
  checkpoint: () => melody([784, 1047], 70, 'triangle', 0.05),
  clear: () => melody([523, 659, 784, 1047, 784, 1047, 1319, 1568], 100, 'triangle', 0.06),
  start: () => melody([392, 523], 70, 'triangle', 0.04),
};
function music(e, level) {
  if (muted) return;
  const m = MUSIC[(level.id - 1) % MUSIC.length];
  if (e.t === 'beat') {
    tone(60, 0.16, 'sine', 0.1, -25);                                                 // 킥
    tone(m.bass[e.n % 4 === 0 ? 0 : e.n % 4], 0.3, 'triangle', 0.05);
  } else if (e.t === 'half') {
    if (e.n % 2 === 1) tone(5000, 0.03, 'square', 0.008);                              // 하이햇
    const f = m.lead[e.n % m.lead.length]; if (f) tone(f, 0.12, 'square', 0.014);
  }
}

// ---------- 상태 ----------
let state = 'title';                           // title · play · dying · cleared · paused
let lvIdx = 0, level = L.LEVELS[0];
let run = null;                                // 지금 달리는 판
let attempts = 1, practice = store.get('jdPractice') === '1';
let cp = null, nextCp = 0.25;                  // 연습 모드 체크포인트
let bests = (() => { try { return JSON.parse(store.get('jdBests') || '{}'); } catch (_) { return {}; } })();
let acc = 0, clock = 0, dyingT = 0, flashT = 0, shake = 0, beatPulse = 0, attemptBanner = 0;
let parts = [], trail = [];
const totalBest = () => Object.values(bests).reduce((a, b) => a + (Number(b) || 0), 0);
function saveBest(pct) {
  if (practice || TUTORIAL) return;
  if (pct > (bests[level.id] || 0)) { bests[level.id] = pct; store.set('jdBests', JSON.stringify(bests)); store.set('jdBest', String(totalBest())); }
}

/* @test-hooks:start */
window.__jd = { get run() { return run; }, get state() { return state; }, get attempts() { return attempts; }, L, step: (dt) => update(dt), start: (i, p) => startLevel(i, p), setHold: (v) => { held = v; } };
/* @test-hooks:end */

// ---------- 입력: 화면 어디든 누르면 점프(누르고 있으면 계속) ----------
let held = false, holdBuf = 0;
const keys = new Set();
const JUMP = [' ', 'ArrowUp', 'w', 'W', 'z', 'Z', 'Enter'];
function press() { held = true; holdBuf = 0.07; }
function release() { held = false; }
$('wrap').addEventListener('pointerdown', (e) => {
  if (e.target.closest('#overlay') || e.target.closest('#top')) return;
  e.preventDefault(); try { $('wrap').setPointerCapture(e.pointerId); } catch (_) {}
  press();
});
for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) $('wrap').addEventListener(ev, release);
addEventListener('keydown', (e) => {
  if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') { if (state === 'play') pause(); else if (state === 'paused') resume(); return; }
  if (e.key === 'm' || e.key === 'M') { toggleMute(); return; }
  if (JUMP.includes(e.key)) { e.preventDefault(); if (e.repeat) return; keys.add(e.key); if (state === 'title' || state === 'cleared') return; press(); }
});
addEventListener('keyup', (e) => { if (JUMP.includes(e.key)) { keys.delete(e.key); if (!keys.size) release(); } });
addEventListener('blur', () => { keys.clear(); release(); pause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

// ---------- 흐름 ----------
function startLevel(i, p) {
  lvIdx = i; level = L.LEVELS[i]; if (p !== undefined) practice = !!p;
  attempts = 1; cp = null; nextCp = 0.25; parts = []; trail = [];
  run = L.newRun(level); state = 'play'; attemptBanner = 1.6;
  $('overlay').classList.add('hidden');
  sfx.start();
}
function respawn() {
  attempts++; parts = []; trail = [];
  run = L.newRun(level, cp || undefined); state = 'play'; attemptBanner = 1.2; acc = 0;
}
function die() {
  state = 'dying'; dyingT = practice && cp ? 0.35 : 0.55; shake = 0.3; flashT = 0.15;
  saveBest(Math.floor(L.progress(run) * 100));
  const px = (PLAYER_COL + 0.5) * CELL, py = GROUND_Y - (run.y + 0.5) * CELL;
  for (let i = 0; i < 18; i++) { const a = Math.random() * Math.PI * 2, s = 40 + Math.random() * 110; parts.push({ x: px, y: py, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, t: 0, life: 0.6 + Math.random() * 0.3, size: 3 + Math.random() * 3 }); }
  sfx.die(); tutorialSignal('die');
}
function cleared() {
  state = 'cleared'; saveBest(100); sfx.clear(); tutorialSignal('clear');
  const next = lvIdx + 1 < L.LEVELS.length;
  showOverlay(`
    <h2>🎉 코스 클리어!</h2>
    <div class="big">${level.name}</div>
    <p>${practice ? '연습 모드로 깼어요 (기록에는 안 들어가요)' : '기록 100%'}<br>시도 ${attempts}번</p>
    <div class="opts">${next ? '<button data-act="next">다음 코스</button>' : ''}
    <button data-act="again" class="${next ? 'sub' : ''}">다시 하기</button>
    <button data-act="menu" class="sub">코스 고르기</button></div>`);
}
function pause() {
  if (state !== 'play') return;
  state = 'paused';
  showOverlay('<h2>일시정지</h2><div class="opts"><button data-act="resume">계속하기</button><button data-act="menu" class="sub">코스 고르기</button></div>');
}
function resume() { if (state === 'paused') { state = 'play'; $('overlay').classList.add('hidden'); acc = 0; } }
function showOverlay(html) { $('overlay').innerHTML = html; $('overlay').classList.remove('hidden'); applyOpts(); }
function showTitle() {
  state = 'title';
  const cards = L.LEVELS.map((lv, i) => { const b = bests[lv.id] || 0; return `<button data-level="${i}" class="${b >= 100 ? 'done' : ''}">${lv.id}. ${lv.name}<small>${b >= 100 ? '클리어 ✔' : b > 0 ? '최고 ' + b + '%' : '새 코스'}</small></button>`; }).join('');
  $('overlay').innerHTML = `
    <h1>점프 대시</h1>
    <p>화면을 <b>누르면 점프</b>! 가시를 넘고 블록을 타고 끝까지 가요 🏁<br>누르고 있으면 <b>계속 뛰어요</b>. 박자에 맞춰 달려요</p>
    <div class="levels">${cards}</div>
    <div class="opts"><button class="opt" data-act="practice"></button></div>
    <div class="keys"><span class="pc">⌨️ 스페이스·↑·클릭 점프 · P 일시정지 · M 소리</span></div>`;
  $('overlay').classList.remove('hidden');
  applyOpts();
}
function applyOpts() {
  for (const b of document.querySelectorAll('[data-act=practice]')) { b.classList.toggle('on', practice); b.textContent = `🧪 연습 모드: ${practice ? '켜짐' : '꺼짐'}`; b.title = '켜면 25%마다 자동 저장돼서 죽어도 거기서 다시 시작해요 (기록은 안 남아요)'; }
}
function togglePractice() { practice = !practice; store.set('jdPractice', practice ? '1' : '0'); applyOpts(); tutorialSignal('practice'); }
$('overlay').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  b.blur();
  if (b.dataset.level !== undefined) startLevel(Number(b.dataset.level));
  else if (b.dataset.act === 'next') startLevel(lvIdx + 1);
  else if (b.dataset.act === 'again') startLevel(lvIdx);
  else if (b.dataset.act === 'resume') resume();
  else if (b.dataset.act === 'practice') togglePractice();
  else if (b.dataset.act === 'menu') { showTitle(); }
});

// ---------- 갱신: 고정 간격으로 규칙을 돌린다 ----------
function update(dt) {
  clock += dt;
  if (beatPulse > 0) beatPulse = Math.max(0, beatPulse - dt * 3);
  if (shake > 0) shake = Math.max(0, shake - dt);
  if (flashT > 0) flashT -= dt;
  if (attemptBanner > 0) attemptBanner -= dt;
  for (const p of parts) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 300 * dt; }
  parts = parts.filter((p) => p.t < p.life);
  trail = trail.filter((t) => (t.t += dt) < 0.35);
  if (state === 'dying') { dyingT -= dt; if (dyingT <= 0) respawn(); return; }
  if (state !== 'play' || !run) return;
  acc += Math.min(dt, 0.05);
  if (holdBuf > 0) holdBuf = Math.max(0, holdBuf - dt);
  while (acc >= DT && state === 'play') {
    acc -= DT;
    L.step(run, held || holdBuf > 0);
    for (const e of run.events) handle(e);
    if (run.dead) { die(); return; }
    if (run.done) { cleared(); return; }
    if (run.t * 60 % 3 < 1) trail.push({ x: run.x, y: run.y, t: 0, mode: run.mode });
    if (practice && L.progress(run) >= nextCp && (run.grounded || run.mode === 'ship')) { cp = L.copy(run); cp.dead = null; nextCp += 0.25; sfx.checkpoint(); tutorialSignal('checkpoint'); }
  }
}
function handle(e) {
  if (e.t === 'jump') { sfx.jump(); tutorialSignal('jump'); }
  else if (e.t === 'pass') tutorialSignal('pass');
  else if (e.t === 'pad') { sfx.pad(); tutorialSignal('pad'); }
  else if (e.t === 'portal') { sfx.portal(); tutorialSignal('portal'); }
  else if (e.t === 'beat') { beatPulse = 1; music(e, level); }
  else if (e.t === 'half') music(e, level);
}

// ---------- 그리기 ----------
const lerpColor = (a, b, k) => { const pa = [1, 3, 5].map((i) => parseInt(a.substr(i, 2), 16)), pb = [1, 3, 5].map((i) => parseInt(b.substr(i, 2), 16)); return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * k).toString(16).padStart(2, '0')).join(''); };
const sx = (cx, cam) => Math.round((cx - cam) * CELL);          // 칸 → 화면 x
const sy = (cy) => Math.round(GROUND_Y - cy * CELL);            // 높이 → 화면 y (위쪽이 작다)
function drawBackground(cam) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, level.color[0]); g.addColorStop(1, level.color[1]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // 박자에 맞춰 반짝이는 막대들 (멀리 있어서 천천히 지나간다)
  ctx.fillStyle = `rgba(255,255,255,${0.04 + beatPulse * 0.06})`;
  const off = (cam * 0.3 * CELL) % 90;
  for (let i = -1; i < 6; i++) ctx.fillRect(Math.round(i * 90 - off), 0, 26, GROUND_Y);
  // 가까운 격자
  ctx.strokeStyle = `rgba(255,255,255,${0.05 + beatPulse * 0.05})`; ctx.lineWidth = 1;
  const goff = (cam * CELL) % CELL;
  ctx.beginPath(); for (let x = -goff; x < W; x += CELL) { ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, GROUND_Y); } ctx.stroke();
}
function drawGround(cam) {
  ctx.fillStyle = '#06080f'; ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
  ctx.fillStyle = level.accent; ctx.fillRect(0, GROUND_Y, W, 2);
  ctx.fillStyle = 'rgba(255,255,255,.12)';
  const goff = (cam * CELL) % CELL;
  for (let x = -goff; x < W; x += CELL) ctx.fillRect(Math.round(x), GROUND_Y + 6, 1, H - GROUND_Y - 6);
  ctx.fillRect(0, GROUND_Y + CELL, W, 1);
}
function drawObjects(cam) {
  const p = L.prepare(level);
  const c0 = Math.floor(cam) - 1, c1 = Math.ceil(cam + VIEW_W) + 1;
  const seen = new Set();
  for (let c = c0; c <= c1; c++) for (const o of L.colItems(p, c)) {
    if (seen.has(o)) continue; seen.add(o);
    if (o.kind === 'block') {
      const x = sx(o.x, cam), y = sy(o.y + o.h), w = o.w * CELL, h = o.h * CELL;
      ctx.fillStyle = '#0a0e1c'; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = level.accent; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
      ctx.fillStyle = 'rgba(255,255,255,.12)'; for (let k = 1; k < o.w; k++) ctx.fillRect(x + k * CELL, y + 2, 1, h - 4); for (let k = 1; k < o.h; k++) ctx.fillRect(x + 2, y + k * CELL, w - 4, 1);
    } else if (o.kind === 'spike') {
      const x = sx(o.x, cam), base = sy(o.y), up = !o.down, hh = CELL - 2;
      ctx.fillStyle = '#e8f0ff'; ctx.beginPath(); ctx.moveTo(x + 1, base); ctx.lineTo(x + CELL / 2, base + (up ? -hh : hh)); ctx.lineTo(x + CELL - 1, base); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ff4a6a'; ctx.beginPath(); ctx.moveTo(x + 5, base); ctx.lineTo(x + CELL / 2, base + (up ? -hh + 3 : hh - 3)); ctx.lineTo(x + CELL - 5, base); ctx.closePath(); ctx.fill();
    } else if (o.kind === 'pad') {
      const x = sx(o.x, cam), y = sy(o.y);
      ctx.fillStyle = 'rgba(255,220,60,.35)'; ctx.fillRect(x + 1, y - 8, CELL - 2, 8);
      ctx.fillStyle = '#ffd23a'; ctx.fillRect(x + 2, y - 5, CELL - 4, 5); ctx.fillStyle = '#fff6b0'; ctx.fillRect(x + 4, y - 5, CELL - 8, 2);
    }
  }
  for (const pt of p.portals) {                                               // 포털: 세로로 긴 고리
    const x = sx(pt.x, cam) + 4;
    if (x < -30 || x > W + 30) continue;
    const ship = pt.mode === 'ship', col = ship ? '#ff7ac0' : '#7dff9a';
    ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(x, sy(2.5), 5 + beatPulse * 2, 42, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(x, sy(2.5), 3, 36, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = col; ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(ship ? '우주선' : '네모', x, sy(2.5) - 48);
  }
  const fx = sx(level.len, cam);                                              // 결승선
  if (fx < W + 20) { for (let i = 0; i < 9; i++) { ctx.fillStyle = i % 2 ? '#fff' : '#111'; ctx.fillRect(fx, i * CELL, 8, CELL); ctx.fillStyle = i % 2 ? '#111' : '#fff'; ctx.fillRect(fx + 8, i * CELL, 8, CELL); } }
}
function drawPlayer(cam) {
  if (!run || (state === 'dying' && run.dead)) return;
  const cx = (PLAYER_COL + 0.5) * CELL, cy = sy(run.y + 0.5);
  ctx.save(); ctx.translate(cx, cy);
  const ship = run.mode === 'ship';
  if (ship) {
    ctx.rotate(-Math.max(-0.5, Math.min(0.5, run.vy / 18)));
    ctx.fillStyle = '#ff7ac0'; ctx.beginPath(); ctx.moveTo(-11, 5); ctx.lineTo(12, 3); ctx.lineTo(8, -2); ctx.lineTo(-9, -2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffd0ea'; ctx.fillRect(-4, -9, 10, 8);
    ctx.fillStyle = '#1a1030'; ctx.fillRect(-1, -7, 2, 2); ctx.fillRect(3, -7, 2, 2);
    ctx.fillStyle = `rgba(255,150,60,${0.6 + 0.4 * Math.sin(clock * 40)})`; ctx.fillRect(-16, 1, 6, 3);
  } else {
    ctx.rotate(run.rot * Math.PI / 180);
    ctx.fillStyle = '#ffd23a'; ctx.fillRect(-9, -9, 18, 18);
    ctx.fillStyle = '#fff3a0'; ctx.fillRect(-9, -9, 18, 3); ctx.fillRect(-9, -9, 3, 18);
    ctx.strokeStyle = '#8a5a00'; ctx.lineWidth = 2; ctx.strokeRect(-9, -9, 18, 18);
    ctx.fillStyle = '#1a1030'; ctx.fillRect(-5, -4, 3, 4); ctx.fillRect(3, -4, 3, 4); ctx.fillRect(-4, 4, 9, 2);
  }
  ctx.restore();
}
function drawTrail(cam) {
  for (const t of trail) { const k = t.t / 0.35, x = sx(t.x, cam) + CELL / 2, y = sy(t.y + 0.5); ctx.globalAlpha = (1 - k) * 0.5; ctx.fillStyle = t.mode === 'ship' ? '#ff9ad0' : '#ffd23a'; const s = 8 * (1 - k) + 2; ctx.fillRect(x - s / 2, y - s / 2, s, s); }
  ctx.globalAlpha = 1;
}
function drawHud() {
  const pct = run ? Math.floor(L.progress(run) * 100) : 0;
  ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(W / 2 - 80, 5, 160, 6);
  ctx.fillStyle = level.accent; ctx.fillRect(W / 2 - 80, 5, Math.round(160 * (run ? L.progress(run) : 0)), 6);
  if (practice) for (const q of [0.25, 0.5, 0.75]) { ctx.fillStyle = cp && L.progress(cp) >= q ? '#7dff9a' : '#fff'; ctx.fillRect(W / 2 - 80 + 160 * q - 1, 3, 2, 10); }
  ctx.fillStyle = '#fff'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(`${pct}%`, W / 2 + 86, 9);
  ctx.textAlign = 'left'; ctx.fillText(`${level.id}. ${level.name}`, 6, 9);
  if (practice) { ctx.fillStyle = '#7dff9a'; ctx.fillText('연습', 6, 22); }
}
function draw() {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const cam = run ? run.x - PLAYER_COL : 0;
  ctx.save();
  if (shake > 0) ctx.translate((Math.random() - 0.5) * shake * 16, (Math.random() - 0.5) * shake * 16);
  drawBackground(cam); drawGround(cam); drawObjects(cam); drawTrail(cam); drawPlayer(cam);
  for (const p of parts) { const k = p.t / p.life; ctx.globalAlpha = 1 - k; ctx.fillStyle = '#ffd23a'; ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size); }
  ctx.globalAlpha = 1;
  ctx.restore();
  if (flashT > 0) { ctx.fillStyle = `rgba(255,255,255,${flashT * 3})`; ctx.fillRect(0, 0, W, H); }
  if (state === 'play' || state === 'dying' || state === 'paused') drawHud();
  if (attemptBanner > 0 && state === 'play') { ctx.globalAlpha = Math.min(1, attemptBanner); ctx.fillStyle = '#fff'; ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(`시도 ${attempts}`, W / 2, GROUND_Y - 80); ctx.globalAlpha = 1; }
}

let last = 0;
function frame(ts) {
  const dt = Math.min(0.05, (ts - (last || ts)) / 1000);
  last = ts;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}
function toggleMute() { muted = !muted; store.set('jdMuted', muted ? '1' : '0'); $('muteBtn').textContent = muted ? '🔇' : '🔊'; }
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('pauseBtn').onclick = (e) => { e.currentTarget.blur(); state === 'paused' ? resume() : pause(); };
$('muteBtn').textContent = muted ? '🔇' : '🔊';

fit();
showTitle();
requestAnimationFrame(frame);
