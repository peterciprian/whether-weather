import { aggregateIntervals, hourlyFromIntervals } from '../aggregate.js';
import { tomorrowIcon } from '../icons.js';

const kmh = (ms) => (typeof ms === 'number' ? ms * 3.6 : null);
const firstNum = (...v) => v.find((x) => typeof x === 'number');

function precipitation(v) {
  const parts = [
    firstNum(v.rainAccumulation, v.rainIntensity),
    firstNum(v.snowAccumulationLwe),
    firstNum(v.sleetAccumulationLwe, v.sleetIntensity),
    firstNum(v.iceAccumulationLwe, v.freezingRainIntensity),
  ].filter((x) => typeof x === 'number');
  return parts.length ? parts.reduce((a, b) => a + b, 0) : null;
}

export default {
  id: 'tomorrow',
  name: 'Tomorrow.io',
  url: 'https://www.tomorrow.io/',
  keyEnv: 'TOMORROW_KEY',
  usesTz: true,
  // Free tier is strictly rate limited (per hour and per day).
  ttlMin: 60,
  buildUrl({ lat, lon, key }) {
    const u = new URL('https://api.tomorrow.io/v4/weather/forecast');
    u.search = new URLSearchParams({ location: `${lat},${lon}`, timesteps: '1h', units: 'metric', apikey: key });
    return u;
  },
  parse(j, { tz, now } = {}) {
    const intervals = (j.timelines?.hourly ?? []).map((h) => {
      const v = h.values ?? {};
      return {
        start: Date.parse(h.time),
        hours: 1,
        temp: v.temperature,
        pop: v.precipitationProbability,
        precip: precipitation(v),
        wind: kmh(v.windSpeed),
        windDir: v.windDirection,
        gust: kmh(v.windGust),
        cloud: v.cloudCover,
        rad: v.solarGHI ?? v.solarGlobalHorizontalIrradiance ?? null,
        icon: tomorrowIcon(v.weatherCode),
      };
    });
    return { days: aggregateIntervals(intervals, tz), hours: hourlyFromIntervals(intervals, tz, { now }) };
  },
};
