const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadConfig() {
  const cssVars = {};
  const context = vm.createContext({
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { documentElement: { style: { setProperty: (k, v) => { cssVars[k] = v; } } } },
  });
  for (const file of ['data.js', 'config.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8'), context);
  }
  const { D, CFG } = vm.runInContext('({ D: DiceMergeData, CFG: DiceMergeConfig })', context);
  return { D, CFG, cssVars };
}

test('every --cfg-* variable the stylesheet uses is set by the schema', () => {
  const { cssVars } = loadConfig();
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  const used = new Set(css.match(/--cfg-[a-z-]+/g));
  for (const name of used) assert.ok(name in cssVars, `${name} is never set`);
});

test('schema initials populate data params and piece weights', () => {
  const { D, CFG } = loadConfig();
  for (const item of CFG.SCHEMA) {
    if (item.apply.type === 'data') assert.equal(D.params[item.apply.key], item.initial, item.id);
    if (item.apply.type === 'pieceWeight') assert.equal(D.PIECE_SIZE_WEIGHTS[item.apply.index].weight, item.initial, item.id);
  }
});

test('stored values are clamped to the schema range', () => {
  const { CFG } = loadConfig();
  CFG.set('mergeMinCluster', 0);
  assert.equal(CFG.get('mergeMinCluster'), 2);
  CFG.set('gravityDirection', 'sideways');
  assert.equal(CFG.get('gravityDirection'), 'down');
});
