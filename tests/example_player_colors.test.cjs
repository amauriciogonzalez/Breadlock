const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
const defaults = vm.runInNewContext(html.slice(html.indexOf('const COLS='), html.indexOf('let players=')) + '\n({COLS,DEFAULTS})');

test('example players retain their order but swap the fifth and sixth colors', () => {
  const horse = defaults.DEFAULTS[4], dat = defaults.DEFAULTS[5];
  assert.equal(horse.id, '889764276');
  assert.equal(dat.id, '235976077');
  assert.equal(horse.color, defaults.COLS[5]);
  assert.equal(dat.color, defaults.COLS[4]);
  assert.match(html, /addPlayer\(d\.id,d\.label,d\.color\)/);
  assert.match(html, /const color=colorOverride\|\|COLS\[players\.length%COLS\.length\]/);
});

// OKLab approximates perceived separation better than raw RGB channel distance.
function oklab(hex) {
  const [r, g, b] = [1, 3, 5].map(i => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const l = Math.cbrt(0.4122214708*r + 0.5363325363*g + 0.0514459929*b);
  const m = Math.cbrt(0.2119034982*r + 0.6806995451*g + 0.1073969566*b);
  const s = Math.cbrt(0.0883024619*r + 0.2817188376*g + 0.6299787005*b);
  return [0.2104542553*l + 0.793617785*m - 0.0040720468*s,
    1.9779984951*l - 2.428592205*m + 0.4505937099*s,
    0.0259040371*l + 0.7827717662*m - 0.8086757662*s];
}

test('Numbn is the eleventh example player with its Steam64 ID', () => {
  assert.equal(defaults.DEFAULTS[10].id, '76561198843059070');
  assert.equal(defaults.DEFAULTS[10].label, 'Numbn');
  assert.equal(defaults.DEFAULTS[9].label, 'TragicSensei');
});

test('all eleven example players have visibly separated colors', () => {
  const colors = defaults.DEFAULTS.map((player, i) => player.color || defaults.COLS[i]);
  assert.equal(colors.length, 11);
  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      const a = oklab(colors[i]), b = oklab(colors[j]);
      const distance = Math.hypot(...a.map((component, k) => component - b[k]));
      assert.ok(distance >= 0.10, `Example players ${i + 1} and ${j + 1} have similar colors: ${colors[i]} / ${colors[j]} (${distance.toFixed(3)})`);
    }
  }
});
