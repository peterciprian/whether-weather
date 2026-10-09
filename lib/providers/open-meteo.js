import { normalizeDay, hourlyFromLocal } from '../aggregate.js';
import { wmoIcon } from '../icons.js';

const DAILY = [
  'weather_code', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum',
  'precipitation_probability_max', 'wind_speed_10m_max', 'wind_gusts_10m_max',
  'wind_direction_10m_dominant', 'shortwave_radiation_sum', 'cloud_cover_mean',
];
const HOURLY = [
  'temperature_2m', 'precipitation_probability', 'precipitation', 'wind_speed_10m', 'wind_direction_10m',
  'wind_gusts_10m', 'cloud_cover', 'shortwave_radiation', 'weather_code',
];

export default {
  id: 'open-meteo',
  name: 'Open-Meteo',
  url: 'https://open-meteo.com/',
  keyEnv: null,
  usesTz: false,
  ttlMin: 15,
  buildUrl({ lat, lon }) {
    const u = new URL('https://api.open-meteo.com/v1/forecast');
    u.search = new URLSearchParams({
      latitude: lat, longitude: lon, daily: DAILY.join(','), hourly: HOURLY.join(','),
      timezone: 'auto', forecast_days: '8', forecast_hours: '72',
    });
    return u;
  },
  parse(j, opts = {}) {
    const d = j.daily;
    const h = j.hourly ?? { time: [] };
    // precipitation and shortwave_radiation are "preceding hour" values: shift them to the hour they describe.
    const points = h.time.map((time, i) => ({
      k: time.slice(0, 13),
      temp: h.temperature_2m?.[i],
      pop: h.precipitation_probability?.[i],
      precip: h.precipitation?.[i + 1],
      wind: h.wind_speed_10m?.[i],
      windDir: h.wind_direction_10m?.[i],
      gust: h.wind_gusts_10m?.[i],
      cloud: h.cloud_cover?.[i],
      rad: h.shortwave_radiation?.[i + 1],
      icon: wmoIcon(h.weather_code?.[i]),
    }));
    return {
      tz: j.timezone,
      hours: hourlyFromLocal(points, j.timezone || 'UTC', opts),
      days: d.time.map((date, i) => normalizeDay({
        date,
        tmin: d.temperature_2m_min?.[i],
        tmax: d.temperature_2m_max?.[i],
        pop: d.precipitation_probability_max?.[i],
        precip: d.precipitation_sum?.[i],
        wind: d.wind_speed_10m_max?.[i],
        windDir: d.wind_direction_10m_dominant?.[i],
        gust: d.wind_gusts_10m_max?.[i],
        rad: d.shortwave_radiation_sum?.[i],
        cloud: d.cloud_cover_mean?.[i],
        icon: wmoIcon(d.weather_code?.[i]),
      })),
    };
  },
};
