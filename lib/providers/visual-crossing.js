import { normalizeDay, hourlyFromLocal } from '../aggregate.js';
import { visualCrossingIcon } from '../icons.js';
import { localDates } from '../time.js';

const ELEMENTS =
  'datetime,tempmax,tempmin,temp,precip,precipprob,windspeed,windgust,winddir,cloudcover,solarenergy,solarradiation,icon';

export default {
  id: 'visual-crossing',
  name: 'Visual Crossing',
  url: 'https://www.visualcrossing.com/',
  keyEnv: 'VISUALCROSSING_KEY',
  usesTz: true,
  // Free tier is billed per returned day record (1000/day): request only 7 days and cache longer.
  ttlMin: 60,
  buildUrl({ lat, lon, tz, key }) {
    const dates = localDates(tz, 7);
    const u = new URL(
      `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${lat},${lon}/${dates[0]}/${dates[6]}`,
    );
    u.search = new URLSearchParams({
      unitGroup: 'metric', include: 'days,hours', elements: ELEMENTS, key, contentType: 'json',
    });
    return u;
  },
  parse(j, opts = {}) {
    const points = (j.days ?? []).slice(0, 3).flatMap((d) =>
      (d.hours ?? []).map((h) => ({
        k: `${d.datetime}T${String(h.datetime).slice(0, 2)}`,
        temp: h.temp,
        pop: h.precipprob,
        precip: h.precip,
        wind: h.windspeed,
        windDir: h.winddir,
        gust: h.windgust,
        cloud: h.cloudcover,
        rad: h.solarradiation,
        icon: visualCrossingIcon(h.icon),
      })),
    );
    return {
      tz: j.timezone,
      hours: hourlyFromLocal(points, j.timezone || opts.tz || 'UTC', opts),
      days: (j.days ?? []).map((d) => normalizeDay({
        date: d.datetime,
        tmin: d.tempmin,
        tmax: d.tempmax,
        pop: d.precipprob,
        precip: d.precip,
        wind: d.windspeed,
        windDir: d.winddir,
        gust: d.windgust,
        rad: d.solarenergy,
        cloud: d.cloudcover,
        icon: visualCrossingIcon(d.icon),
      })),
    };
  },
};
