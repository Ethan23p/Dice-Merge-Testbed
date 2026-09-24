const test = require('node:test');
const assert = require('node:assert/strict');
const { load, seq, board, die, piece, makeState } = require('./load');

function fresh(params = {}) {
  const { D, S } = load();
  Object.assign(D.params, { gravityEnabled: false, forcePairInTriple: false, noRepeatInCluster: false }, params);
  return { D, S };
}

const plain = (b) => JSON.parse(JSON.stringify(b));
const count = (b, value) => b.flat().filter((v) => v === value).length;

test('placement without a merge is a single landing step', () => {
  const { D, S } = fresh();
  const state = makeState(D, ['. . .', '. . .', '. . .'], { queue: [die(2), die(3)] });
  const { steps } = S.placePiece(state, 1, 1);
  assert.equal(steps.length, 1);
  assert.deepEqual(plain(state.board), board('. . .', '. 2 .', '. . .'));
  assert.equal(state.moves, 1);
  assert.equal(state.score, 0);
});

test('placement onto an occupied or out-of-bounds cell is rejected', () => {
  const { D, S } = fresh();
  const state = makeState(D, ['1 .', '. .']);
  const pair = piece([0, 0, 2], [0, 1, 2]);
  assert.equal(S.canPlaceAt(state, pair, 0, 0), false);
  assert.equal(S.canPlaceAt(state, pair, 1, 1), false);
  assert.equal(S.canPlaceAt(state, pair, 1, 0), true);
  state.queue = [pair, die(1)];
  assert.equal(S.placePiece(state, 0, 0).steps.length, 0);
  assert.equal(state.moves, 0);
});

test('three touching same-value dice merge into one die of value+1', () => {
  const { D, S } = fresh();
  const state = makeState(D, ['1 1 .', '. . .', '. . .'], { queue: [die(1), die(6)] });
  const { steps } = S.placePiece(state, 0, 2, { r: 0, c: 2 });
  assert.deepEqual(plain(state.board), board('. . 2', '. . .', '. . .'));
  // mass(1) * 3 - mass(2) = 1 released, x10 score
  assert.equal(state.score, 10);
  assert.deepEqual(plain(steps[1].pops), [{ r: 0, c: 2, massReleased: 1, size: 3 }]);
  assert.equal(steps[1].moves.length, 2);
});

test('two touching dice do not merge', () => {
  const { D, S } = fresh();
  const state = makeState(D, ['1 . .', '. . .', '. . .'], { queue: [die(1), die(6)] });
  S.placePiece(state, 0, 1);
  assert.deepEqual(plain(state.board), board('1 1 .', '. . .', '. . .'));
});

test('a bigger cluster gains one tier but releases more mass', () => {
  const { D, S } = fresh();
  const state = makeState(D, ['1 1 1', '. . .', '. . .'], { queue: [die(1), die(6)] });
  const { steps } = S.placePiece(state, 1, 1, { r: 1, c: 1 });
  assert.deepEqual(plain(state.board), board('. . .', '. 2 .', '. . .'));
  assert.deepEqual(plain(steps[1].pops), [{ r: 1, c: 1, massReleased: 2, size: 4 }]);
  assert.equal(state.score, 20);
});

test('merge paths walk through the cluster one orthogonal hop at a time', () => {
  const { D, S } = fresh();
  const state = makeState(D, ['1 . .', '1 . .', '. . .'], { queue: [die(1), die(6)] });
  const { steps } = S.placePiece(state, 1, 1, { r: 1, c: 1 });
  const paths = steps[1].moves.map((m) => plain(m.path));
  assert.deepEqual(paths.find((p) => p[0].r === 0), [{ r: 0, c: 0 }, { r: 1, c: 0 }, { r: 1, c: 1 }]);
  for (const p of paths) {
    for (let i = 1; i < p.length; i++) {
      assert.equal(Math.abs(p[i].r - p[i - 1].r) + Math.abs(p[i].c - p[i - 1].c), 1);
    }
  }
});

test('merges chain across generations', () => {
  const { D, S } = fresh();
  const state = makeState(D, ['2 2 .', '. 1 1', '. . .'], { queue: [die(1), die(6)] });
  const { steps } = S.placePiece(state, 0, 2, { r: 0, c: 2 });
  // The 1s become a 2 at (0,2), which then joins the other two 2s.
  assert.equal(steps.length, 3);
  assert.deepEqual(plain(state.board), board('. . 3', '. . .', '. . .'));
});

test('separate clusters resolve in the same generation', () => {
  const { D, S } = fresh();
  const state = makeState(D, ['1 2 .', '1 2 .', '. . .'], { queue: [piece([0, 0, 1], [0, 1, 2]), die(6)] });
  const { steps } = S.placePiece(state, 2, 0);
  assert.equal(steps.length, 2);
  assert.equal(steps[1].pops.length, 2);
  assert.deepEqual(plain(state.board), board('. . .', '. . .', '2 3 .'));
});

test('survivor: the held die wins over other piece dice', () => {
  const { D, S } = fresh();
  const state = makeState(D, ['1 . .', '. . .', '. . .'], { queue: [piece([0, 0, 1], [0, 1, 1]), die(6)] });
  S.placePiece(state, 0, 1, { r: 0, c: 2 });
  assert.equal(state.board[0][2], 2);
});

test('survivor: any piece die wins over pre-existing dice', () => {
  const { D, S } = fresh();
  const state = makeState(D, ['1 1 .', '. . .', '. . .'], { queue: [die(1), die(6)] });
  S.placePiece(state, 0, 2);
  assert.equal(state.board[0][2], 2);
});

test('survivor: with no piece die in the cluster, rng picks', () => {
  const pick = (rngValue) => {
    const { D, S } = fresh({ gravityEnabled: true, gravityDirection: 'down' });
    // Placing the 5 lets nothing merge with it; gravity drops the 1s into a row.
    const state = makeState(D, ['1 1 .', '. . .', '. . 1'], { queue: [die(5), die(6)], rng: () => rngValue });
    S.placePiece(state, 0, 2);
    return plain(state.board);
  };
  assert.equal(count(pick(0), 2), 1);
  assert.notDeepEqual(pick(0), pick(0.99));
});

test('gravity packs each line toward the chosen edge', () => {
  const expected = {
    down: board('. . .', '. . .', '1 2 3'),
    up: board('1 2 3', '. . .', '. . .'),
    left: board('1 . .', '2 . .', '3 . .'),
    right: board('. . 1', '. . 2', '. . 3'),
  };
  for (const dir of Object.keys(expected)) {
    const { D, S } = fresh();
    const state = makeState(D, ['1 . .', '. 2 .', '. . 3']);
    const moves = S.shiftBoard(state, dir);
    assert.deepEqual(plain(state.board), expected[dir], dir);
    for (const m of moves) assert.equal(m.path.length, 2);
  }
});

test('gravity keeps relative order within a line', () => {
  const { D, S } = fresh();
  const state = makeState(D, ['1 . 2 . 3', '. . . . .', '. . . . .', '. . . . .', '. . . . .']);
  S.shiftBoard(state, 'right');
  assert.deepEqual(plain(state.board[0]), [0, 0, 1, 2, 3]);
});

test('gravity settles before merging', () => {
  const { D, S } = fresh({ gravityEnabled: true, gravityDirection: 'down' });
  const state = makeState(D, ['. . .', '. . .', '1 . 1'], { queue: [die(1), die(4)] });
  const { steps } = S.placePiece(state, 0, 1, { r: 0, c: 1 });
  // landing, fall, merge
  assert.equal(steps.length, 3);
  assert.deepEqual(plain(steps[1].pops), []);
  assert.equal(steps[2].pops.length, 1);
  assert.deepEqual(plain(state.board), board('. . .', '. . .', '. 2 .'));
});

test('a merge survivor keeps falling after the merge', () => {
  const { D, S } = fresh({ gravityEnabled: true, gravityDirection: 'down' });
  // The 1s fall onto the 2 and merge at (2,1) into a 2; that 2 must then
  // fall no further (it's resting on the floor die) and merge with it.
  const state = makeState(D, ['. . . .', '1 . . .', '. . . .', '. 2 2 .'], { queue: [piece([0, 0, 1], [0, 1, 1]), die(6)] });
  S.placePiece(state, 0, 0, { r: 0, c: 1 });
  assert.equal(state.board.flat().filter(Boolean).length, 1);
  assert.equal(state.board[3].filter((v) => v === 3).length, 1);
});

test('step boards are snapshots, not the live board', () => {
  const { D, S } = fresh();
  const state = makeState(D, ['1 1 .', '. . .', '. . .'], { queue: [die(1), die(6)] });
  const { steps } = S.placePiece(state, 0, 2);
  assert.deepEqual(plain(steps[0].board), board('1 1 1', '. . .', '. . .'));
  assert.notEqual(steps[0].board, state.board);
});

test('filling the board ends the game', () => {
  const { D, S } = fresh();
  const state = makeState(D, ['1 2', '3 .'], { queue: [die(4), die(5)] });
  S.placePiece(state, 1, 1);
  assert.equal(state.gameOver, true);
  assert.equal(S.placePiece(state, 0, 0).steps.length, 0);
});

test('an unplaceable queued piece is swapped for one that fits', () => {
  const { D, S } = fresh();
  const bar = piece([0, 0, 5], [0, 1, 6], [0, 2, 5]);
  const state = makeState(D, ['1 2 .', '3 4 .', '5 6 .'], { queue: [die(1), bar], rng: Math.random });
  S.placePiece(state, 0, 2);
  assert.equal(state.gameOver, false);
  for (const p of state.queue) assert.ok(S.hasAnyValidPlacement(state, p));
});
