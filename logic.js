'use strict';
// 점프 대시 규칙 (DOM 없음). 화면은 game.js, 시험은 test/logic.test.js
// 길이 단위는 '칸'(한 칸 = 한 변이 1인 정사각형). 땅의 윗면이 y=0, 위로 갈수록 y 가 커진다. 플레이어는 일정한 속도로 오른쪽으로 달리고, 버튼 하나(점프·상승)만 쓴다.
// 위치·속도는 모두 '고정 시간 간격'(DT)으로 계산한다 → 같은 입력이면 항상 같은 결과라서, 시험에서 해석기(솔버)로 판이 깰 수 있는지 확인한다.
const LOGIC_JD = (() => {
  const LV = (typeof module !== 'undefined' && module.exports) ? require('./levels.js') : LEVELS_JD;
  const { LEVELS, VIEW_W, VIEW_H, CEIL, START_X, PLAYER_COL } = LV;
  const DT = 1 / 120;
  const SPEED = 8;                       // 칸/초. 120 BPM 에서 한 박자(0.5초)가 4칸
  const GRAV = 105, JUMP_V = 20.95;      // 점프: 꼭대기 2.0칸(계산 간격 때문에 생기는 오차를 맞춘 값), 공중에 약 0.4초(3.2칸 이동)
  const PAD_V = 27;                      // 점프 패드: 꼭대기 약 3.5칸
  const SHIP_UP = 38, SHIP_DOWN = 34, SHIP_MAXV = 9;
  const MAXFALL = 26;
  const HB = { l: 0.14, r: 0.86, b: 0.06, t: 0.88 };       // 장애물에 닿는 판정 (몸을 조금 작게 쳐서 아슬아슬하게 피해도 안 죽는다)
  const SPIKE = { l: 0.28, r: 0.72, h: 0.52 };
  const PAD = { l: 0.1, r: 0.9, h: 0.3 };

  // 레벨의 물건들을 칸(열)별로 찾기 쉽게 정리한다 (한 번만)
  const prepared = new WeakMap();
  function prepare(level) {
    if (prepared.has(level)) return prepared.get(level);
    const cols = new Map();
    const add = (c, o) => { if (!cols.has(c)) cols.set(c, []); cols.get(c).push(o); };
    const objs = [];
    for (const it of level.items) {
      if (it.t === 'spike') {
        for (let k = 0; k < (it.n || 1); k++) { const o = { kind: 'spike', x: it.x + k, y: it.y || 0, down: !!it.down }; objs.push(o); add(Math.floor(o.x), o); }
      } else if (it.t === 'block') {
        const o = { kind: 'block', x: it.x, y: it.y || 0, w: it.w || 1, h: it.h || 1 }; objs.push(o);
        for (let c = Math.floor(o.x); c < o.x + o.w; c++) add(c, o);
      } else if (it.t === 'pad') {
        const o = { kind: 'pad', x: it.x, y: it.y || 0, id: objs.length }; objs.push(o); add(Math.floor(o.x), o);
      } else if (it.t === 'portal') {
        const o = { kind: 'portal', x: it.x, mode: it.mode, id: objs.length }; objs.push(o);
      }
    }
    const portals = objs.filter((o) => o.kind === 'portal').sort((a, b) => a.x - b.x);
    const ends = objs.filter((o) => o.kind === 'spike' || o.kind === 'block').map((o) => o.x + (o.w || 1)).sort((a, b) => a - b);
    const p = { cols, portals, objs, ends };
    prepared.set(level, p);
    return p;
  }
  const colItems = (p, c) => p.cols.get(c) || [];

  function newRun(level, from) {
    const st = { level, x: START_X, y: 0, vy: 0, mode: 'cube', grounded: true, t: 0, dead: null, done: false, lastPad: -1, pi: 0, jumps: 0, rot: 0, events: [], beat: -1, half: -1, hold: false, passed: 0 };
    if (from) Object.assign(st, from, { events: [], dead: null, done: false });
    return st;
  }
  // 한 걸음(DT). hold: 이 순간 버튼을 누르고 있나
  function step(st, hold) {
    if (st.dead || st.done) return st;
    const p = prepare(st.level);
    st.events.length = 0;
    st.hold = !!hold;
    const py0 = st.y;
    st.x += SPEED * DT;
    st.t += DT;
    // 박자: 박자와 반 박자마다 소리를 낼 수 있게 알려 준다 (한 박자 = 4칸)
    const bps = st.level.bpm / 60, beat = Math.floor(st.t * bps), half = Math.floor(st.t * bps * 2);
    if (beat !== st.beat) { st.beat = beat; st.events.push({ t: 'beat', n: beat }); }
    if (half !== st.half) { st.half = half; st.events.push({ t: 'half', n: half }); }
    // 모드 바꾸기: 포털을 지나면 바뀐다
    while (st.pi < p.portals.length && st.x + HB.r >= p.portals[st.pi].x) { const pt = p.portals[st.pi]; st.pi++; if (st.mode !== pt.mode) { st.mode = pt.mode; st.events.push({ t: 'portal', mode: pt.mode }); if (pt.mode === 'ship') { st.grounded = false; } } }
    if (st.mode === 'cube') {
      if (st.grounded && hold) { st.vy = JUMP_V; st.grounded = false; st.jumps++; st.events.push({ t: 'jump' }); }
      st.vy = Math.max(-MAXFALL, st.vy - GRAV * DT);
    } else {
      st.vy += (hold ? SHIP_UP : -SHIP_DOWN) * DT;
      st.vy = Math.max(-SHIP_MAXV, Math.min(SHIP_MAXV, st.vy));
    }
    st.y += st.vy * DT;
    st.grounded = false;
    // 땅과 천장
    if (st.y <= 0) { st.y = 0; if (st.vy < 0) st.vy = 0; st.grounded = true; }
    if (st.mode === 'ship' && st.y + 1 >= CEIL) { st.y = CEIL - 1; if (st.vy > 0) st.vy = 0; }
    // 블록: 위에 내려앉으면 서고, 옆이나 아래에 부딪히면 죽는다
    const c0 = Math.floor(st.x + HB.l), c1 = Math.floor(st.x + HB.r);
    for (let c = c0; c <= c1; c++) for (const o of colItems(p, c)) {
      if (o.kind !== 'block') continue;
      const top = o.y + o.h;
      if (st.x + HB.r <= o.x || st.x + HB.l >= o.x + o.w) continue;
      if (st.y >= top || st.y + HB.t <= o.y) continue;                      // 겹치지 않음
      if (py0 >= top - 0.22 && st.vy <= 0.001) { st.y = top; st.vy = 0; st.grounded = true; }         // 위에 내려앉음
      else { st.dead = 'block'; return st; }
    }
    // 가시·패드
    for (let c = c0; c <= c1; c++) for (const o of colItems(p, c)) {
      if (o.kind === 'spike') {
        const sx0 = o.x + SPIKE.l, sx1 = o.x + SPIKE.r;
        const sy0 = o.down ? o.y - SPIKE.h : o.y, sy1 = o.down ? o.y : o.y + SPIKE.h;
        if (st.x + HB.r > sx0 && st.x + HB.l < sx1 && st.y + HB.t > sy0 && st.y + HB.b < sy1) { st.dead = 'spike'; return st; }
      } else if (o.kind === 'pad') {
        if (o.id !== st.lastPad && st.x + HB.r > o.x + PAD.l && st.x + HB.l < o.x + PAD.r && st.y < o.y + PAD.h && st.y + HB.t > o.y) { st.vy = PAD_V; st.grounded = false; st.lastPad = o.id; st.events.push({ t: 'pad' }); }
      }
    }
    if (st.mode === 'cube') {
      if (!st.grounded) st.rot += 450 * DT; else st.rot = Math.round(st.rot / 90) * 90;
    } else st.rot = -st.vy * 4;
    // 장애물(가시·블록)을 하나 지났다 (점수 대신 튜토리얼 신호로 쓴다)
    while (st.passed < p.ends.length && st.x > p.ends[st.passed] + 0.3) { st.passed++; st.events.push({ t: 'pass', n: st.passed }); }
    if (st.x >= st.level.len) { st.done = true; st.events.push({ t: 'done' }); }
    return st;
  }
  const progress = (st) => Math.max(0, Math.min(1, (st.x - START_X) / (st.level.len - START_X)));
  const copy = (st) => ({ ...st, events: [] });

  return { DT, SPEED, GRAV, JUMP_V, PAD_V, SHIP_UP, SHIP_DOWN, SHIP_MAXV, HB, SPIKE, PAD, LEVELS, VIEW_W, VIEW_H, CEIL, START_X, PLAYER_COL, prepare, colItems, newRun, step, progress, copy };
})();
if (typeof module !== 'undefined') module.exports = LOGIC_JD;
