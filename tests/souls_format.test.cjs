const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const source = html.match(/function soulsK\(n\)\{[^}]+\}/)?.[0];

test('souls per minute displays in thousands with one decimal without changing source values', () => {
  assert.ok(source);
  const soulsK = vm.runInNewContext(`(${source})`);
  assert.equal(soulsK(968.4), '1.0K');
  assert.equal(soulsK(945), '0.9K');
  assert.equal(soulsK(1325), '1.3K');
  assert.equal(soulsK(null), '—');
});

test('all souls/min views use the same display formatter', () => {
  for (const snippet of [
    'data-label="Souls/min">${soulsK(r.soulsMin)}',
    "statCard('Souls per Minute','soulsMin',arr,soulsK)",
    '${soulsK(hr.soulsMin)}',
    '${soulsK(soulsMin)}',
    "'net_worth_per_min',m=>ratio(gn(m,'net_worth'),ratio(gn(m,'match_duration_s'),60)),soulsK",
    "['Souls/min',o=>ratio(gn(o.m,'net_worth'),ratio(gn(o.m,'match_duration_s'),60)),soulsK",
    "['Souls/min after 20:00','soulsLate',soulsK",
    "t.name==='Souls/min'?soulsK(value):f1(value)",
    "m.label==='Souls/min'?soulsK(m.mean):f1(m.mean)",
  ]) assert.ok(html.includes(snippet), `Missing formatter in ${snippet}`);
  assert.equal((html.match(/\$\{soulsK\(hr\.soulsMin\)\}/g) || []).length, 2);
});
