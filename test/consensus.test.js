import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consensus, median, circularMean, deriveDayIcon } from '../public/consensus.js';

test('median ignores missing values', () => {
  assert.equal(median([3, null, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([null, undefined]), null);
});

test('circular mean wraps around north', () => {
  const r = circularMean([{ deg: 350 }, { deg: 10 }]);
  assert.ok(r.deg < 1 || r.deg > 359);
  assert.ok(r.r > 0.95);
  assert.ok(circularMean([{ deg: 0 }, { deg: 180 }]).r < 0.01);
});

test('consensus: medians, ranges, variable wind, icon vote', () => {
  const c = consensus([
    { tmin: 10, tmax: 20, pop: 50, precip: 1, wind: 10, windDir: 0, gust: 30, rad: null, cloud: 40, icon: 'rain' },
    { tmin: 12, tmax: 22, pop: null, precip: 3, wind: 20, windDir: 180, gust: null, rad: 10, cloud: 60, icon: 'rain' },
    { tmin: 11, tmax: 24, pop: 70, precip: 2, wind: 15, windDir: 90, gust: 40, rad: 12, cloud: 80, icon: 'cloudy' },
  ]);
  assert.equal(c.tmin, 11);
  assert.equal(c.tmax, 22);
  assert.equal(c.pop, 60);
  assert.equal(c.precip, 2);
  assert.equal(c.rad, 11);
  assert.deepEqual(c.range.tmax, { min: 20, max: 24, n: 3 });
  assert.equal(c.range.gust.n, 2);
  assert.equal(c.icon, 'rain');
  assert.equal(c.count, 3);
});

test('consensus: tie broken by derived icon', () => {
  const c = consensus([
    { precip: 0, cloud: 10, icon: 'clear' },
    { precip: 0, cloud: 20, icon: 'cloudy' },
  ]);
  assert.equal(c.icon, 'clear');
});

test('deriveDayIcon', () => {
  assert.equal(deriveDayIcon({ votes: { thunder: 1, clear: 10 } }), 'thunder');
  assert.equal(deriveDayIcon({ votes: { snow: 3, rain: 1 }, precip: 4 }), 'snow');
  assert.equal(deriveDayIcon({ votes: {}, precip: 5 }), 'rain');
  assert.equal(deriveDayIcon({ votes: {}, precip: 0, cloud: 90 }), 'cloudy');
});
