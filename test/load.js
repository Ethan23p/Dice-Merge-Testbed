// Loads the browser-global modules into a Node vm context so the pure
// game logic can be tested without a DOM.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function load(files = ['data.js', 'state.js']) {
  const context = vm.createContext({});
  for (const file of files) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8');
    vm.runInContext(src, context, { filename: file });
  }
  return vm.runInContext('({ D: DiceMergeData, S: DiceMergeState })', context);
}

// Deterministic rng cycling through the given values.
function seq(...values) {
  let i = 0;
  return () => values[i++ % values.length];
}

// Parses rows like '1 . 2' into a board ('.' = empty).
function board(...rows) {
  return rows.map((row) => row.trim().split(/\s+/).map((v) => (v === '.' ? 0 : Number(v))));
}

const die = (value) => ({ cells: [{ dr: 0, dc: 0, value }] });

function piece(...cells) {
  return { cells: cells.map(([dr, dc, value]) => ({ dr, dc, value })) };
}

function makeState(D, rows, { queue = [die(6), die(6)], rng = seq(0.5) } = {}) {
  const b = board(...rows);
  if (b.some((row) => row.length !== b.length)) throw new Error('boards must be square');
  return {
    config: { ...D.DEFAULT_CONFIG, boardSize: b.length },
    board: b,
    queue,
    score: 0,
    moves: 0,
    gameOver: false,
    rng,
  };
}

module.exports = { load, seq, board, die, piece, makeState };
