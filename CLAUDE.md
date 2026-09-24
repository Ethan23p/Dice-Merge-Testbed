# Dice Merge Testbed

A mobile-first dice-merging puzzle game: drag polyomino pieces of dice onto a
grid; 3+ orthogonally touching same-value dice merge into one die of value+1.
Plain HTML/CSS/JS — no build step, no dependencies, no test suite. Open
`index.html` directly in a browser to run it.

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
| `src/main.js` | — | Wiring: DOM events, drag/tap controller, persistence, Settings dialog, Tuning panel UI |

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

It is a **hand-maintained port**, not a build output. When a change should
reach it, read the live artifact, apply the equivalent edit, and republish to
that URL. Known differences from the repo:

- All modules inlined in one `<script>`; `main.js`'s body lives in
  `start(hotData)` with `window.claude.hot` snapshot/restore.
- Own dark "felt" theme and Fredoka/Manrope fonts; some class names differ
  (`.queue` vs `.queue-panel`, `.btn-primary` vs `.dialog-close`).
- Different storage keys (`dice-merge:v3`, `dice-merge:config:v1`).
- Config export falls back to the artifact `downloads` capability instead of
  a Blob link.

## Git

`main` is the default branch. Work happens on `claude/*` branches merged via PR.
