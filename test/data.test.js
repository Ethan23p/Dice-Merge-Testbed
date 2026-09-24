const test = require('node:test');
const assert = require('node:assert/strict');
const { load, seq, piece } = require('./load');

const key = (p) => p.cells.map((c) => `${c.dr},${c.dc},${c.value}`).sort().join(' ');

test('rotating four times returns the original piece', () => {
  const { D } = load();
  const L = piece([0, 0, 1], [1, 0, 2], [1, 1, 3]);
  let p = L;
  for (let i = 0; i < 4; i++) p = D.rotatePiece(p);
  assert.equal(key(p), key(L));
});

test('rotation stays normalized to a (0,0) top-left', () => {
  const { D } = load();
  const r = D.rotatePiece(piece([0, 0, 1], [0, 1, 1], [0, 2, 1]));
  assert.equal(Math.min(...r.cells.map((c) => c.dr)), 0);
  assert.deepEqual(r.cells.map((c) => c.dc), [0, 0, 0]);
});

test('merge mass release is never negative', () => {
  const { D } = load();
  D.params.massBase = 20;
  assert.equal(D.resolveClusterMass(3, 2).massReleased, 0);
});

test('mass doubles per tier at the default base', () => {
  const { D } = load();
  assert.deepEqual([1, 2, 3, 4].map(D.massForValue), [1, 2, 4, 8]);
});

test('spawn rolls stay within the value pool', () => {
  const { D } = load();
  D.params.spawnValuePool = 4;
  for (let i = 0; i < 500; i++) {
    const v = D.rollSpawnValue();
    assert.ok(v >= 1 && v <= 4);
  }
});

test('excluding rolls skip excluded values, falling back when all are excluded', () => {
  const { D } = load();
  D.params.spawnValuePool = 3;
  for (let i = 0; i < 200; i++) assert.equal(D.rollSpawnValueExcluding(new Set([1, 2])), 3);
  const v = D.rollSpawnValueExcluding(new Set([1, 2, 3]));
  assert.ok(v >= 1 && v <= 3);
});

test('forcePairInTriple: every triple has one pair; noRepeat governs the rest', () => {
  const { D } = load();
  D.params.forcePairInTriple = true;
  D.params.noRepeatInCluster = true;
  for (let i = 0; i < 500; i++) {
    const p = D.generatePiece();
    const distinct = new Set(p.cells.map((c) => c.value)).size;
    assert.equal(distinct, p.cells.length === 3 ? 2 : p.cells.length);
  }
});

test('piece size follows the weights', () => {
  const { D } = load();
  D.PIECE_SIZE_WEIGHTS.forEach((e) => { e.weight = e.size === 2 ? 1 : 0; });
  for (let i = 0; i < 50; i++) assert.equal(D.generatePiece().cells.length, 2);
});

test('generation is deterministic for a given rng', () => {
  const { D } = load();
  const roll = () => JSON.stringify(D.generatePiece(seq(0.1, 0.7, 0.3, 0.9)));
  assert.equal(roll(), roll());
});
