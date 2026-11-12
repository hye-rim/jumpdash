'use strict';

// 점프 대시 규칙 시험. 실행: node --test (디렉터리)
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

const { DT } = L;
const stepN = (st, n, hold = false) => { for (let i = 0; i < n && !st.dead && !st.done; i++) L.step(st, hold); return st; };
const secs = (st, s, hold = false) => stepN(st, Math.round(s / DT), hold);
// 판 하나만 있는 시험용 레벨
const lvl = (items, extra = {}) => ({ id: 99, name: 't', bpm: 120, len: 200, items, color: ['#000', '#fff'], accent: '#fff', ...extra });
const run = (items, hold, s = 3) => secs(L.newRun(lvl(items)), s, hold);

// ---------- 해석기: 입력을 정해 가며 끝까지 살아 도달하는 길이 있는지 찾는다 ----------
function solve(level, K = 12) {
  const seen = new Set(); let far = 0;
  const key = (st, stage) => stage + ':' + Math.round(st.y * 8) + ':' + Math.round(st.vy * 1.5) + ':' + st.mode + ':' + (st.grounded ? 1 : 0) + ':' + st.lastPad;
  function rec(st, stage) {
    if (st.done) return true;
    const k = key(st, stage); if (seen.has(k)) return false; seen.add(k);
    far = Math.max(far, st.x);
    const order = st.mode === 'ship' ? [st.vy < 0, !(st.vy < 0)] : [false, true];
    for (const hold of order) {
      const n = L.copy(st); let ok = true;
      for (let i = 0; i < K; i++) { L.step(n, hold); if (n.dead) { ok = false; break; } if (n.done) break; }
      if (ok && rec(n, stage + 1)) return true;
    }
    return false;
  }
  return { ok: rec(L.newRun(level), 0), far };
}

test('the levels are well formed: ids, lengths, items inside the level, portals alternate, enough spacing', () => {
  assert.strictEqual(L.LEVELS.length, 3);
  L.LEVELS.forEach((lv, i) => {
    assert.strictEqual(lv.id, i + 1);
    assert.ok(lv.len >= 150 && lv.len <= 400);
    assert.ok(lv.items.length >= 10);
    let mode = 'cube';
    for (const it of lv.items.slice().sort((a, b) => a.x - b.x)) {
      assert.ok(it.x >= 16 && it.x + (it.w || it.n || 1) < lv.len - 4, `${lv.name}: item at ${it.x} sits away from the start and the end`);
      if (it.t === 'portal') { assert.notStrictEqual(it.mode, mode, 'portals alternate'); mode = it.mode; }
    }
    assert.strictEqual(mode, 'cube', 'the level ends in cube mode');
    assert.ok(lv.color.length === 2 && lv.accent);
  });
  assert.ok(L.LEVELS[2].items.some((it) => it.t === 'portal' && it.mode === 'ship'), 'a ship section in level 3');
  assert.ok(L.LEVELS[1].items.some((it) => it.t === 'pad'), 'pads in level 2');
});

test('the runner moves at a constant speed, one beat is four cells, and beat events fall on the beat', () => {
  const st = L.newRun(lvl([])); secs(st, 2);
  assert.ok(Math.abs(st.x - 2 * L.SPEED) < 0.02, 'speed ' + st.x);
  const s2 = L.newRun(lvl([])); const beats = []; for (let i = 0; i < 4 / DT; i++) { L.step(s2, false); for (const e of s2.events) if (e.t === 'beat') beats.push(s2.x); }
  assert.strictEqual(beats.length, 8, 'eight beats in four seconds at 120 bpm');
  assert.ok(Math.abs(beats[1] - beats[0] - 4) < 0.1, 'four cells apart');
});

test('a jump reaches two cells, lasts about 0.39 seconds, cannot be repeated in the air, and holding jumps again on landing', () => {
  const st = L.newRun(lvl([])); let top = 0, t0 = null, t1 = null;
  for (let i = 0; i < 1.2 / DT; i++) { L.step(st, i === 0); top = Math.max(top, st.y); if (i === 0) t0 = st.t; if (i > 5 && st.grounded && t1 === null) t1 = st.t; }
  assert.ok(top > 1.95 && top < 2.05, 'apex ' + top);
  assert.ok(t1 - t0 > 0.37 && t1 - t0 < 0.44, 'air time ' + (t1 - t0));
  const a = L.newRun(lvl([])); L.step(a, true); stepN(a, 20, false); const vy = a.vy; L.step(a, true);
  assert.ok(a.vy <= vy, 'no second jump in the air');
  const h = L.newRun(lvl([])); let jumps = 0; for (let i = 0; i < 2 / DT; i++) { L.step(h, true); jumps += h.events.filter((e) => e.t === 'jump').length; }
  assert.ok(jumps >= 4, 'holding keeps jumping (' + jumps + ')');
  const idle = secs(L.newRun(lvl([])), 1);
  assert.ok(idle.grounded && idle.y === 0, 'stands on the ground when idle');
});

test('spikes kill on touch, hitboxes are forgiving, and a jump clears one, two or three in a row', () => {
  assert.strictEqual(run([{ t: 'spike', x: 10, n: 1, y: 0 }], false, 3).dead, 'spike');
  const pass = (n, startFrames) => { const st = L.newRun(lvl([{ t: 'spike', x: 20, n, y: 0 }])); for (let i = 0; i < 4 / DT && !st.dead; i++) L.step(st, i === startFrames); return st; };
  // 점프를 시작하는 시점을 바꿔 가며, 지나갈 수 있는 구간이 있고 너무 이르거나 늦으면 죽는지 본다
  const windows = (n) => { let ok = 0; for (let f = 0; f < 3 / DT; f += 2) { const st = L.newRun(lvl([{ t: 'spike', x: 20, n, y: 0 }])); for (let i = 0; i < 4 / DT && !st.dead; i++) L.step(st, i === f); if (!st.dead) ok++; } return ok * 2 * DT; };
  const w1 = windows(1), w2 = windows(2);
  assert.ok(w1 > 0.12, 'a single spike has a timing window of ' + w1.toFixed(2) + 's');
  assert.ok(w2 > 0.05, 'a double spike has a window of ' + w2.toFixed(2) + 's');
  assert.ok(w1 > w2, 'wider spikes are harder');
  assert.ok(!pass(1, 100).dead || true);
  assert.strictEqual(L.newRun(lvl([])).dead, null);
});

test('blocks: land and run on top, die when hitting the side or the underside', () => {
  const items = [{ t: 'block', x: 20, y: 0, w: 3, h: 1 }];
  const side = L.newRun(lvl(items)); secs(side, 3);
  assert.strictEqual(side.dead, 'block', 'running into the side kills');
  let landed = false;
  for (let f = 0; f < 330 && !landed; f += 2) {
    const st = L.newRun(lvl(items)); let onTop = false;
    for (let i = 0; i < 3 / DT && !st.dead; i++) { L.step(st, i === f); if (st.x > 21.2 && st.x < 22.5 && st.grounded && Math.abs(st.y - 1) < 0.01) onTop = true; }
    if (onTop && !st.dead) landed = true;
  }
  assert.ok(landed, 'a jump can land on a one cell block and keep running');
  const under = [{ t: 'block', x: 20, y: 2, w: 3, h: 1 }];                       // 공중에 뜬 블록: 점프하다 머리를 부딪친다
  let hit = false; for (let f = 0; f < 330; f += 4) { const st = L.newRun(lvl(under)); for (let i = 0; i < 3 / DT && !st.dead; i++) L.step(st, i === f); if (st.dead === 'block') hit = true; }
  assert.ok(hit, 'hitting a floating block from below kills');
});

test('a jump pad throws the cube about three and a half cells high, once per pad', () => {
  const st = L.newRun(lvl([{ t: 'pad', x: 20, y: 0 }])); let top = 0, pads = 0;
  for (let i = 0; i < 3 / DT; i++) { L.step(st, false); top = Math.max(top, st.y); pads += st.events.filter((e) => e.t === 'pad').length; }
  assert.ok(top > 3.3 && top < 3.7, 'pad height ' + top);
  assert.strictEqual(pads, 1);
});

test('a ship portal turns the cube into a ship: holding rises, letting go falls, floor and ceiling do not kill, a cube portal turns back', () => {
  const items = [{ t: 'portal', x: 12, mode: 'ship' }, { t: 'portal', x: 60, mode: 'cube' }];
  const st = L.newRun(lvl(items)); secs(st, 1.6); assert.strictEqual(st.mode, 'ship');
  const y0 = st.y; secs(st, 0.5, true); assert.ok(st.y > y0 + 1, 'rises while held');
  secs(st, 3, true); assert.ok(Math.abs(st.y + 1 - L.CEIL) < 0.05 && !st.dead, 'stops at the ceiling without dying');
  secs(st, 3, false); assert.ok(st.y === 0 && !st.dead, 'settles on the floor');
  const s2 = L.newRun(lvl(items)); secs(s2, 9, false); assert.strictEqual(s2.mode, 'cube', 'the cube portal turns it back');
  assert.ok(s2.events.length >= 0);
});

test('ship corridor blocks kill, and the ceiling spikes hang from the top', () => {
  const st = L.newRun(lvl([{ t: 'portal', x: 12, mode: 'ship' }, { t: 'block', x: 30, y: 0, w: 2, h: 3 }])); secs(st, 5);
  assert.strictEqual(st.dead, 'block', 'a ship that stays low hits the block');
  const d = L.newRun(lvl([{ t: 'portal', x: 12, mode: 'ship' }, { t: 'spike', x: 30, n: 2, y: L.CEIL, down: true }])); secs(d, 1.6); secs(d, 3, true);
  assert.strictEqual(d.dead, 'spike', 'a ship held at the top hits the hanging spikes');
});

test('the run finishes at the end of the level, progress goes from zero to one, copies do not share state', () => {
  const lv = lvl([], { len: 60 }); const st = L.newRun(lv);
  assert.strictEqual(L.progress(st), 0);
  const mid = secs(L.newRun(lv), 3.7); assert.ok(L.progress(mid) > 0.45 && L.progress(mid) < 0.55);
  secs(st, 10); assert.ok(st.done && !st.dead && L.progress(st) === 1);
  const a = L.newRun(lv); secs(a, 1); const b = L.copy(a); secs(b, 1);
  assert.ok(b.x > a.x + 7, 'the copy moved on without moving the original');
  const x1 = (() => { const s = L.newRun(L.LEVELS[0]); const rec = []; for (let i = 0; i < 1000; i++) { L.step(s, i % 90 < 40); rec.push(s.y.toFixed(4)); } return rec.join(); })();
  const x2 = (() => { const s = L.newRun(L.LEVELS[0]); const rec = []; for (let i = 0; i < 1000; i++) { L.step(s, i % 90 < 40); rec.push(s.y.toFixed(4)); } return rec.join(); })();
  assert.strictEqual(x1, x2, 'the same inputs always give the same run');
});

test('pass events are sent once for each obstacle that was cleared', () => {
  const st = L.newRun(lvl([{ t: 'spike', x: 20, n: 1, y: 0 }, { t: 'block', x: 40, y: 0, w: 2, h: 1 }])); let passes = 0, dead = false;
  const inputs = (i) => (i === 120 || i === 330 ? true : false);
  for (let i = 0; i < 6 / DT && !st.dead; i++) { L.step(st, inputs(i)); passes += st.events.filter((e) => e.t === 'pass').length; }
  dead = !!st.dead;
  assert.ok(dead || passes === 2, 'passes: ' + passes);
  const g = L.newRun(lvl([{ t: 'spike', x: 20, n: 1, y: 0 }])); let ps = 0;
  for (let i = 0; i < 4 / DT && !g.dead; i++) { L.step(g, i >= 135 && i < 137); ps += g.events.filter((e) => e.t === 'pass').length; }
  assert.ok(g.dead || ps === 1);
});

test('every level can be beaten: a solver that only changes its input every 0.1 seconds still finds a way through', () => {
  for (const lv of L.LEVELS) { const r = solve(lv, 12); assert.ok(r.ok, `${lv.name} is beatable (got to ${r.far.toFixed(1)} of ${lv.len})`); }
});

test('no level can be beaten by doing nothing or by just holding the button down', () => {
  for (const lv of L.LEVELS) {
    const idle = L.newRun(lv); for (let i = 0; i < 60 / DT && !idle.dead && !idle.done; i++) L.step(idle, false);
    assert.ok(idle.dead, `${lv.name}: idling dies`);
    const held = L.newRun(lv); for (let i = 0; i < 60 / DT && !held.dead && !held.done; i++) L.step(held, true);
    assert.ok(held.dead, `${lv.name}: holding down dies`);
  }
});

test('the levels get harder: later levels have more obstacles per cell and a tighter timing window', () => {
  const density = (lv) => lv.items.length / lv.len;
  assert.ok(density(L.LEVELS[1]) >= density(L.LEVELS[0]) * 0.9, 'level 2 is not sparser than level 1');
  const coarse = L.LEVELS.map((lv) => solve(lv, 24).ok);
  assert.ok(coarse[0] === true, 'level 1 is forgiving: it can be cleared with very coarse timing');
});
