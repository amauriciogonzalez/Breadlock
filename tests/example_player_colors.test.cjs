const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
const defaults = vm.runInNewContext(html.slice(html.indexOf('const COLS='), html.indexOf('let players=')) + '\n({COLS,DEFAULTS})');

test('example players retain their order but swap the original fifth and sixth colors', () => {
  const horse = defaults.DEFAULTS[4], dat = defaults.DEFAULTS[5];
  assert.equal(horse.id, '889764276');
  assert.equal(dat.id, '235976077');
  assert.equal(horse.color, defaults.COLS[5]);
  assert.equal(dat.color, defaults.COLS[4]);
  assert.match(html, /addPlayer\(d\.id,d\.label,d\.color\)/);
  assert.match(html, /const color=colorOverride\|\|COLS\[players\.length%COLS\.length\]/);
});
