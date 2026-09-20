/*
 * Game state as plain data plus pure(ish) functions that transform it.
 * State shape:
 *   {
 *     config: { boardSize, queueLength },
 *     board: number[][]   // 0 = empty, N = die showing value N
 *     queue: number[]      // upcoming die values, queue[0] is placed next
 *     score: number,
 *     moves: number,
 *     gameOver: boolean,
 *     lastMerges: { r, c, value }[]  // for the renderer/animations to react to
 *     rng: () => number
 *   }
 * No part of this file touches the DOM.
 */
const DiceMergeState = (() => {
  const D = DiceMergeData;

  function createState(config = D.DEFAULT_CONFIG, rng = Math.random) {
    const size = config.boardSize;
    const board = Array.from({ length: size }, () => Array(size).fill(0));
    const queue = Array.from({ length: config.queueLength }, () =>
      D.rollSpawnValue(rng)
    );
    return {
      config: { ...config },
      board,
      queue,
      score: 0,
      moves: 0,
      gameOver: false,
      lastMerges: [],
      rng,
    };
  }

  function inBounds(state, r, c) {
    const size = state.config.boardSize;
    return r >= 0 && r < size && c >= 0 && c < size;
  }

  function isFull(state) {
    return state.board.every((row) => row.every((v) => v !== 0));
  }

  // Repeatedly merges the cell at (r, c) with any equal-valued orthogonal
  // neighbor, incrementing its value each time, until nothing adjacent
  // matches anymore. Produces a chain-reaction feel from one placement.
  function resolveMerges(state, r, c) {
    let scoreGained = 0;
    const merges = [];
    let changed = true;
    while (changed) {
      changed = false;
      const value = state.board[r][c];
      if (!value) break;
      for (const [dr, dc] of D.DIRECTIONS) {
        const nr = r + dr;
        const nc = c + dc;
        if (inBounds(state, nr, nc) && state.board[nr][nc] === value) {
          state.board[nr][nc] = 0;
          state.board[r][c] = value + 1;
          scoreGained += D.scoreForMerge(value + 1);
          merges.push({ r, c, value: value + 1 });
          changed = true;
          break;
        }
      }
    }
    return { scoreGained, merges };
  }

  function placeDie(state, r, c) {
    if (state.gameOver) return state;
    if (!inBounds(state, r, c)) return state;
    if (state.board[r][c] !== 0) return state;

    const value = state.queue[0];
    state.board[r][c] = value;

    const { scoreGained, merges } = resolveMerges(state, r, c);
    state.score += scoreGained;
    state.lastMerges = merges;
    state.moves += 1;

    state.queue.shift();
    state.queue.push(D.rollSpawnValue(state.rng));

    if (isFull(state)) {
      state.gameOver = true;
    }

    return state;
  }

  return { createState, placeDie, resolveMerges, isFull, inBounds };
})();
