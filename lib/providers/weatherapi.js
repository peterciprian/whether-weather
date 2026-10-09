import { aggregateIntervals, hourlyFromIntervals, normalizeDay } from '../aggregate.js';
import { weatherapiIcon } from '../icons.js';

const maxOf = (...v) => {
  const n = v.filter((x) => typeof x === 'number');
  return n.length ? Math.max(...n) : null;
};

export default {
  id: 'weatherapi',
  name: 'WeatherAPI.com',
  url: 'https://www.weatherapi.com/',
  keyEnv: 'WEATHERAPI_KEY',
  usesTz: false,
  ttlMin: 30,
  buildUrl({ lat, lon, key }) {
    const u = new URL('https://api.weatherapi.com/v1/forecast.json');
    u.search = new URLSearchParams({ key, q: `${lat},${lon}`, days: '7', aqi: 'no', alerts: 'no' });
    return u;
  },
  parse(j, opts = {}) {
    const tz = j.location?.tz_id || 'UTC';
    const fds = j.forecast?.forecastday ?? [];
    const intervals = fds.flatMap((fd) => fd.hour ?? []).map((h) => ({
      start: h.time_epoch * 1000,
      hours: 1,
      temp: h.temp_c,
      pop: maxOf(h.chance_of_rain, h.chance_of_snow),
      precip: h.precip_mm,
      wind: h.wind_kph,
      windDir: h.wind_degree,
      gust: h.gust_kph,
      cloud: h.cloud,
      rad: h.short_rad,
      icon: weatherapiIcon(h.condition?.code),
    }));
    const hourly = aggregateIntervals(intervals, tz);
    const byDate = new Map(hourly.map((d) => [d.date, d]));
    return {
      tz,
      hours: hourlyFromIntervals(intervals, tz, opts),
      days: fds.map((fd) => {
        const h = byDate.get(fd.date) ?? {};
        return normalizeDay({
          date: fd.date,
          tmin: fd.day?.mintemp_c,
          tmax: fd.day?.maxtemp_c,
          pop: maxOf(fd.day?.daily_chance_of_rain, fd.day?.daily_chance_of_snow),
          precip: fd.day?.totalprecip_mm,
          wind: fd.day?.maxwind_kph,
          windDir: h.windDir,
          gust: h.gust,
          rad: h.rad,
          cloud: h.cloud,
          icon: weatherapiIcon(fd.day?.condition?.code),
        });
      }),
    };
  },
};
