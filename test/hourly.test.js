import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hourWindow, hourlyFromIntervals, hourlyFromLocal } from '../lib/aggregate.js';
import { hourConsensus } from '../web/consensus.js';
import { trimHours } from '../lib/forecast.js';
import openMeteo from '../lib/providers/open-meteo.js';

const H = 3_600_000;
const TZ = 'Europe/Budapest';
// 2024-07-01 10:30 Budapest (UTC+2)
const NOW = Date.UTC(2024, 6, 1, 8, 30);

test('hourWindow starts at the current local hour', () => {
  assert.deepEqual(hourWindow(TZ, { now: NOW, days: 2 }), { from: '2024-07-01T10', to: '2024-07-02T23' });
});

test('hourlyFromIntervals spreads multi-hour intervals and splits precipitation', () => {
  const hours = hourlyFromIntervals(
    [
      { start: Date.UTC(2024, 6, 1, 6), hours: 6, temp: 20, precip: 6, pop: 40, icon: 'rain' },
      { start: Date.UTC(2024, 6, 1, 9), hours: 1, temp: 99 }, // overlapping, first one wins
    ],
    TZ,
    { now: NOW },
  );
  assert.deepEqual(
    hours.map((h) => h.k),
    ['2024-07-01T10', '2024-07-01T11', '2024-07-01T12', '2024-07-01T13'],
  );
  assert.equal(hours[0].precip, 1);
  assert.equal(hours[0].temp, 20);
  assert.equal(hours[0].icon, 'rain');
});

test('hourlyFromLocal filters to the window', () => {
  const pts = ['2024-07-01T09', '2024-07-01T10', '2024-07-04T00'].map((k) => ({ k, temp: 1 }));
  assert.deepEqual(
    hourlyFromLocal(pts, TZ, { now: NOW }).map((h) => h.k),
    ['2024-07-01T10'],
  );
});

test('trimHours keeps today and tomorrow only', () => {
  const ks = ['2024-07-01T10', '2024-07-02T23', '2024-07-03T00'];
  const realNow = Date.now;
  Date.now = () => NOW;
  try {
    assert.deepEqual(
      trimHours(ks.map((k) => ({ k })), TZ).map((h) => h.k),
      ks.slice(0, 2),
    );
  } finally {
    Date.now = realNow;
  }
});

test('open-meteo hourly: precipitation/radiation shifted to the hour they fall in', () => {
  const r = openMeteo.parse(
    {
      timezone: TZ,
      daily: { time: ['2024-07-01'] },
      hourly: {
        time: ['2024-07-01T10:00', '2024-07-01T11:00', '2024-07-01T12:00'],
        temperature_2m: [20, 21, 22],
        precipitation: [0, 0.5, 1.2],
        shortwave_radiation: [100, 200, 300],
      },
    },
    { now: NOW },
  );
  const h10 = r.hours.find((h) => h.k === '2024-07-01T10');
  assert.equal(h10.temp, 20);
  assert.equal(h10.precip, 0.5);
  assert.equal(h10.rad, 200);
});

test('hourConsensus: medians and severity tie-break', () => {
  const c = hourConsensus([
    { temp: 10, pop: 20, icon: 'rain', windDir: 350, wind: 10 },
    { temp: 12, pop: 60, icon: 'cloudy', windDir: 10, wind: 20 },
    { temp: 30, pop: 40 },
  ]);
  assert.equal(c.temp, 12);
  assert.equal(c.pop, 40);
  assert.equal(c.icon, 'rain');
  assert.ok(c.windDir < 5 || c.windDir > 355);
});
