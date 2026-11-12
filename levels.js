'use strict';
// 점프 대시의 코스. 길이 단위는 '칸'. 땅의 윗면이 y=0, 위쪽이 +. 달리는 속도는 8칸/초, 120 BPM 이라 한 박자가 4칸이다.
//   S(x, n)   바닥 가시 n 개(옆으로 이어짐)      D(x, n)   천장에 매달린 가시
//   B(x,w,h,y) 블록(위에 서도 되고 옆·아래에 부딪히면 죽는다)   P(x, y) 점프 패드(밟으면 높이 튄다)
//   PORT(x, mode) 포털: 'ship' 이면 우주선(누르면 오르고 떼면 내려간다), 'cube' 면 다시 점프하는 네모
const LEVELS_JD = (() => {
  const VIEW_W = 18, VIEW_H = 9, CEIL = 7, START_X = 0, PLAYER_COL = 5;
  const S = (x, n = 1, y = 0) => ({ t: 'spike', x, n, y });
  const D = (x, n = 1) => ({ t: 'spike', x, n, y: CEIL, down: true });
  const B = (x, w, h, y = 0) => ({ t: 'block', x, y, w, h });
  const P = (x, y = 0) => ({ t: 'pad', x, y });
  const PORT = (x, mode) => ({ t: 'portal', x, mode });
  // 우주선 구간: 일정 간격마다 위아래에서 블록이 나오고 그 사이로 지나간다. centers 는 틈의 가운데 높이, gap 은 틈의 크기
  function corridor(x0, step, centers, gap = 3.2, w = 2) {
    const out = [];
    centers.forEach((c, i) => {
      const x = x0 + i * step, lo = c - gap / 2, hi = c + gap / 2;
      if (lo > 0.3) out.push(B(x, w, lo));
      if (CEIL - hi > 0.3) out.push(B(x, w, CEIL - hi, hi));
    });
    return out;
  }
  const LEVELS = [
    {
      id: 1, name: '첫걸음', bpm: 120, len: 176, color: ['#1a2a6a', '#3a6adf'], accent: '#7fe0ff', hint: '가시를 넘고 낮은 블록 위로 올라가요',
      items: [
        S(24), S(36), S(48, 2), B(60, 2, 1), S(72), S(77), B(88, 3, 1), S(100, 2), B(112, 2, 1), S(120), S(125), S(130),
        B(140, 4, 1), S(152, 2), S(164),
      ],
    },
    {
      id: 2, name: '점프 패드', bpm: 120, len: 232, color: ['#3a1a5a', '#c04ad0'], accent: '#ffb0f0', hint: '노란 패드를 밟으면 높이 튀어요',
      items: [
        S(22, 2), P(34), S(35, 2), B(52, 2, 1), B(55, 2, 2), B(58, 2, 3), S(66), P(76), B(78, 4, 2), S(92, 2), B(104, 3, 2), S(112), S(117),
        P(128), S(129, 2), B(144, 2, 1), S(150, 2), B(158, 3, 1), S(166), B(172, 4, 2), S(184, 2), S(192), S(197), P(206), S(207, 2), S(222),
      ],
    },
    {
      id: 3, name: '우주선', bpm: 120, len: 320, color: ['#0a3a3a', '#1ac0a0'], accent: '#8fffe0', hint: '포털을 지나면 우주선! 누르면 오르고 떼면 내려가요',
      items: [
        S(22), S(34, 2), B(48, 2, 1), PORT(60, 'ship'),
        ...corridor(72, 8, [3.5, 3.0, 4.0, 3.2, 4.2, 3.0, 3.8, 3.4, 4.0, 3.0, 3.6, 4.0]),
        D(122, 3), S(130, 2), PORT(172, 'cube'),
        S(184), S(190, 2), P(200), S(201, 2), B(214, 2, 1), S(222), S(227), B(238, 3, 2), S(246, 2), S(254), P(264), S(265, 2), S(280), S(285), S(290, 2), S(302),
      ],
    },
  ];
  return { LEVELS, VIEW_W, VIEW_H, CEIL, START_X, PLAYER_COL };
})();
if (typeof module !== 'undefined') module.exports = LEVELS_JD;
