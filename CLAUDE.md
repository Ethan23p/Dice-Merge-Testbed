# Dice Merge Testbed

A mobile-first dice-merging puzzle game: drag polyomino pieces of dice onto a
grid; 3+ orthogonally touching same-value dice merge into one die of value+1.
Plain HTML/CSS/JS with no dependencies. Open `index.html` directly in a
browser to run it; `npm test` runs the logic tests (`node:test`), and
`npm run build` produces the single-file artifact.

## Layout

Scripts load in order from `index.html`; each module is an IIFE exposing one
global (`DiceMerge*`), and later modules read earlier ones.

| File | Global | Role |
|---|---|---|
| `src/data.js` | `DiceMergeData` | Static tables + pure functions: pips, colors, mass law, spawn rolls, piece generation, `params` (live balance knobs) |
| `src/config.js` | `DiceMergeConfig` | Tuning schema + store behind the Tuning panel (see below) |
| `src/state.js` | `DiceMergeState` | Game state as plain data; `placePiece` returns a `steps` timeline; `settle()` is the gravity/merge fixed-point loop |
| `src/render.js` | `DiceMergeRender` | State → DOM. No game rules |
| `src/physics.js` | `DiceMergePhysics` | Damped spring (rAF), used by drag snapback |
| `src/animate.js` | `DiceMergeAnimate` | Plays a `steps` timeline on the board |
| `src/main.js` | `start()` | Wiring: DOM events, drag/tap controller, persistence, Settings dialog, Tuning panel UI |

## Conventions

- **Logic stays out of the DOM.** `state.js` and `data.js` never touch the
  DOM; `animate.js` never branches on *why* a step happened (merge vs.
  gravity look the same to it).
- **Mass drives feel.** Durations/intensities that should reflect weight go
  through `D.scaleWithMass`, not per-value multipliers.
- **Comments explain why**, often at length — match the existing density and
  voice when editing.

## Tuning config (`config.js`)

Every tunable is a `SCHEMA` entry with `initial` (shipped value), plus a
persisted per-player `default` and `current`. Types: numeric slider (default),
`'bool'`, or `'select'` (with `options`). `apply` routes the value to
`D.params`, a `PIECE_SIZE_WEIGHTS` entry, a `--cfg-*` CSS variable, or
nothing (`'main'`, read via `CFG.get` at use time).

- To change a shipped default, change `initial` in the schema (and the
  matching `D.params` literal in `data.js` so the two don't disagree).
  Players who already have a stored `current`/`default` for that id keep it
  until they reset.
- The same config item can have several UI copies (Tuning panel, pinned HUD,
  Settings dialog). All register in `main.js`'s `rowRegistry` by id so a
  change in one updates the others — new copies must register too.
- The Settings dialog shows board size (starts a new game) and the Gravity
  toggle + direction (applies on the next placement).

## The published artifact

The game is also published as a single-file Claude artifact, "Dice Merge":
https://claude.ai/artifact/RLGAVNurn5e1xk1hGLK2ft

The repo is the only source. `npm run build` inlines `styles.css` and
`src/*.js` into `dist/dice-merge.html` (gitignored); publish that file to the
URL above (it declares the `downloads` capability, used by config export).
`main.js` already handles the artifact runtime (`window.claude.hot` state
carry-over, `downloads`) and falls back cleanly in a plain browser.

## Git

`main` is the default branch. Work happens on `claude/*` branches merged via PR.
