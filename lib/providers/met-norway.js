import { aggregateIntervals, hourlyFromIntervals } from '../aggregate.js';
import { metIcon } from '../icons.js';

const kmh = (ms) => (typeof ms === 'number' ? ms * 3.6 : null);

export default {
  id: 'met-norway',
  name: 'MET Norway (Yr)',
  url: 'https://www.met.no/en',
  keyEnv: null,
  usesTz: true,
  ttlMin: 30,
  buildUrl({ lat, lon }) {
    return `https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${lat}&lon=${lon}`;
  },
  parse(j, { tz, now } = {}) {
    const ts = j.properties?.timeseries ?? [];
    const intervals = [];
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i];
      const start = Date.parse(t.time);
      const gap = ts[i + 1] ? Math.round((Date.parse(ts[i + 1].time) - start) / 3_600_000) : null;
      const n1 = t.data.next_1_hours;
      const n6 = t.data.next_6_hours;
      let block = null;
      let blockHours = 1;
      if (n1 && (gap === null || gap <= 1 || !n6)) block = n1;
      else if (n6) {
        block = n6;
        blockHours = 6;
      }
      if (!block) continue;
      const hours = gap ? Math.min(blockHours, gap) : blockHours;
      const inst = t.data.instant?.details ?? {};
      const bd = block.details ?? {};
      intervals.push({
        start,
        hours,
        temp: inst.air_temperature,
        tmin: bd.air_temperature_min,
        tmax: bd.air_temperature_max,
        pop: bd.probability_of_precipitation,
        precip: typeof bd.precipitation_amount === 'number' ? (bd.precipitation_amount * hours) / blockHours : null,
        wind: kmh(inst.wind_speed),
        windDir: inst.wind_from_direction,
        gust: kmh(inst.wind_speed_of_gust),
        cloud: inst.cloud_area_fraction,
        icon: metIcon(block.summary?.symbol_code),
      });
    }
    return { days: aggregateIntervals(intervals, tz), hours: hourlyFromIntervals(intervals, tz, { now }) };
  },
};
