/*
 * Wiring: DOM events <-> state transitions <-> render. Owns persistence
 * (best score, chosen board size) as the one piece of state that outlives
 * a single game.
 */
(() => {
  const D = DiceMergeData;
  const S = DiceMergeState;
  const R = DiceMergeRender;

  const boardEl = document.getElementById('board');
  const queueEl = document.getElementById('queue');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best-score');
  const newGameBtn = document.getElementById('new-game-btn');
  const settingsBtn = document.getElementById('settings-btn');
  const settingsDialog = document.getElementById('settings-dialog');
  const closeSettingsBtn = document.getElementById('close-settings-btn');
  const boardSizeSelect = document.getElementById('board-size-select');
  const gameOverEl = document.getElementById('game-over');
  const gameOverScoreEl = document.getElementById('game-over-score');
  const playAgainBtn = document.getElementById('play-again-btn');

  const STORAGE_KEY = 'dice-merge-testbed:v1';

  function loadSaved() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch (err) {
      return {};
    }
  }

  function persist(patch) {
    saved = { ...saved, ...patch };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch (err) {
      /* storage unavailable — game still works, just won't remember */
    }
  }

  let saved = loadSaved();
  let config = {
    ...D.DEFAULT_CONFIG,
    boardSize: saved.boardSize || D.DEFAULT_CONFIG.boardSize,
  };
  let bestScore = saved.bestScore || 0;
  let state = S.createState(config);

  function render() {
    R.renderBoard(boardEl, state, handleCellClick);
    R.renderQueue(queueEl, state);
    R.renderScore(scoreEl, state);
    bestEl.textContent = `Best ${bestScore}`;

    if (state.gameOver) {
      if (state.score > bestScore) {
        bestScore = state.score;
        persist({ bestScore });
        bestEl.textContent = `Best ${bestScore}`;
      }
      gameOverScoreEl.textContent = String(state.score);
      gameOverEl.hidden = false;
    } else {
      gameOverEl.hidden = true;
    }
  }

  function handleCellClick(r, c) {
    S.placeDie(state, r, c);
    render();
  }

  function newGame() {
    state = S.createState(config);
    render();
  }

  newGameBtn.addEventListener('click', newGame);
  playAgainBtn.addEventListener('click', newGame);

  settingsBtn.addEventListener('click', () => settingsDialog.showModal());
  closeSettingsBtn.addEventListener('click', () => settingsDialog.close());
  settingsDialog.addEventListener('click', (e) => {
    if (e.target === settingsDialog) settingsDialog.close();
  });

  D.BOARD_SIZE_OPTIONS.forEach((size) => {
    const option = document.createElement('option');
    option.value = String(size);
    option.textContent = `${size} x ${size}`;
    boardSizeSelect.appendChild(option);
  });
  boardSizeSelect.value = String(config.boardSize);
  boardSizeSelect.addEventListener('change', (e) => {
    config = { ...config, boardSize: Number(e.target.value) };
    persist({ boardSize: config.boardSize });
    settingsDialog.close();
    newGame();
  });

  render();
})();
