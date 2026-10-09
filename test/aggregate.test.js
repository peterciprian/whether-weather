import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateIntervals } from '../lib/aggregate.js';
import openMeteo from '../lib/providers/open-meteo.js';
import metNorway from '../lib/providers/met-norway.js';
import openweather from '../lib/providers/openweather.js';

const H = 3_600_000;

test('aggregateIntervals splits by local day in the given time zone', () => {
  // 2024-07-01 20:00Z .. 6 hours => Budapest (UTC+2) 22:00..04:00, spans two local days
  const start = Date.UTC(2024, 6, 1, 20);
  const days = aggregateIntervals(
    [{ start, hours: 6, temp: 15, precip: 6, wind: 10, windDir: 90, cloud: 50, icon: 'rain' }],
    'Europe/Budapest',
  );
  assert.deepEqual(days.map((d) => d.date), ['2024-07-01', '2024-07-02']);
  assert.equal(days[0].precip, 2);
  assert.equal(days[1].precip, 4);
  assert.ok(days[0].partial && days[1].partial);
});

test('aggregateIntervals: full day stats', () => {
  const start = Date.UTC(2024, 0, 10, 0);
  const iv = Array.from({ length: 24 }, (_, h) => ({
    start: start + h * H,
    hours: 1,
    temp: h,
    pop: h === 12 ? 80 : 10,
    precip: 0.1,
    wind: h === 5 ? 30 : 10,
    windDir: 270,
    gust: h,
    cloud: 100,
    rad: 100,
    icon: 'cloudy',
  }));
  const [d] = aggregateIntervals(iv, 'UTC');
  assert.equal(d.date, '2024-01-10');
  assert.equal(d.tmin, 0);
  assert.equal(d.tmax, 23);
  assert.equal(d.pop, 80);
  assert.equal(d.precip, 2.4);
  assert.equal(d.wind, 30);
  assert.equal(d.windDir, 270);
  assert.equal(d.gust, 23);
  assert.equal(d.cloud, 100);
  assert.equal(d.rad, 8.6); // 24 h * 100 W/m² = 8.64 MJ/m²
  assert.equal(d.icon, 'rain');
  assert.equal(d.partial, undefined);
});

test('open-meteo parse', () => {
  const r = openMeteo.parse({
    timezone: 'Europe/Budapest',
    daily: {
      time: ['2024-07-01'],
      weather_code: [61],
      temperature_2m_max: [28.44],
      temperature_2m_min: [17.06],
      precipitation_sum: [3.2],
      precipitation_probability_max: [70],
      wind_speed_10m_max: [20.1],
      wind_gusts_10m_max: [45.3],
      wind_direction_10m_dominant: [300],
      shortwave_radiation_sum: [22.5],
      cloud_cover_mean: [55.4],
    },
  });
  assert.equal(r.tz, 'Europe/Budapest');
  assert.deepEqual(r.days[0], {
    date: '2024-07-01', tmin: 17.1, tmax: 28.4, pop: 70, precip: 3.2, wind: 20.1, windDir: 300,
    gust: 45.3, rad: 22.5, cloud: 55, icon: 'rain',
  });
});

test('met-norway parse handles hourly then 6-hourly steps', () => {
  const step = (time, n1, n6, wind = 5) => ({
    time,
    data: {
      instant: { details: { air_temperature: 10, wind_speed: wind, wind_from_direction: 180, cloud_area_fraction: 50 } },
      ...(n1 ? { next_1_hours: { summary: { symbol_code: 'rain' }, details: { precipitation_amount: n1 } } } : {}),
      ...(n6 ? { next_6_hours: { summary: { symbol_code: 'cloudy' }, details: { precipitation_amount: n6, air_temperature_min: 8, air_temperature_max: 14 } } } : {}),
    },
  });
  const ts = [step('2024-07-01T10:00:00Z', 1, 3), step('2024-07-01T11:00:00Z', 1, 3), step('2024-07-01T12:00:00Z', null, 6)];
  const r = metNorway.parse({ properties: { timeseries: ts } }, { tz: 'UTC' });
  assert.equal(r.days.length, 1);
  const d = r.days[0];
  assert.equal(d.precip, 8); // 1 + 1 + 6
  assert.equal(d.tmin, 8);
  assert.equal(d.tmax, 14);
  assert.equal(d.wind, 18);
  assert.equal(d.windDir, 180);
  assert.ok(d.partial);
});

test('openweather parse converts units', () => {
  const r = openweather.parse(
    { list: [{ dt: Date.UTC(2024, 6, 1, 12) / 1000, main: { temp: 20, temp_min: 19, temp_max: 21 }, pop: 0.4, rain: { '3h': 1.5 }, wind: { speed: 10, deg: 90, gust: 20 }, clouds: { all: 75 }, weather: [{ id: 500 }] }] },
    { tz: 'UTC' },
  );
  const d = r.days[0];
  assert.equal(d.pop, 40);
  assert.equal(d.precip, 1.5);
  assert.equal(d.wind, 36);
  assert.equal(d.gust, 72);
  assert.equal(d.icon, 'rain');
});
