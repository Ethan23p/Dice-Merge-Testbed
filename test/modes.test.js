const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadAll() {
  const context = vm.createContext({
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { documentElement: { style: { setProperty: () => {} } } },
  });
  for (const file of ['data.js', 'config.js', 'modes.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8'), context);
  }
  return vm.runInContext('({ D: DiceMergeData, CFG: DiceMergeConfig, M: DiceMergeModes })', context);
}

test('every pinned rule is a real config item', () => {
  const { CFG, M } = loadAll();
  for (const mode of M.MODES) {
    for (const id of Object.keys(mode.rules)) assert.ok(CFG.item(id), `${mode.id}: ${id}`);
  }
});

test('a preset pins its rules over the player\'s, and Custom releases them', () => {
  const { D, CFG, M } = loadAll();
  CFG.set('mergeMinCluster', 5);
  CFG.set('gravityEnabled', false);
  CFG.setOverrides(M.byId('stacked').rules);
  assert.equal(D.params.mergeMinCluster, 3);
  assert.equal(D.params.gravityEnabled, true);
  assert.equal(D.params.gravityDirection, 'up');
  assert.equal(D.params.maxPieceSize, 2);

  // Tuning edits while a preset is active don't leak into it...
  CFG.set('mergeMinCluster', 4);
  assert.equal(D.params.mergeMinCluster, 3);

  // ...but are kept for Custom.
  CFG.setOverrides(M.byId('custom').rules);
  assert.equal(D.params.mergeMinCluster, 4);
  assert.equal(D.params.gravityEnabled, false);
});

test('max cluster size 2 never rolls a 3-cell piece; 3 does', () => {
  const { D } = loadAll();
  D.params.maxPieceSize = 2;
  for (let i = 0; i < 300; i++) assert.ok(D.generatePiece().cells.length <= 2);
  D.params.maxPieceSize = 3;
  const sizes = new Set(Array.from({ length: 300 }, () => D.generatePiece().cells.length));
  assert.ok(sizes.has(3));
});

test('descriptions come from the resolved rules', () => {
  const { CFG, M } = loadAll();
  const get = CFG.get;
  assert.equal(M.describe(M.resolve(M.byId('stacked'), 5, get)), '4×4 · gravity up · pieces up to 2 · merge 3');
  assert.equal(M.describe(M.resolve(M.byId('packed'), 5, get)), '5×5 · no gravity · pieces up to 3 · merge 3');
  CFG.set('mergeMinCluster', 2);
  assert.equal(M.describe(M.resolve(M.byId('custom'), 5, get)), '5×5 · no gravity · pieces up to 3 · merge 2');
});
