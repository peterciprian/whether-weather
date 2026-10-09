import { localParts, addDays } from './time.js';
import { circularMean, deriveDayIcon, isNum } from '../web/consensus.js';

const round1 = (v) => (isNum(v) ? Math.round(v * 10) / 10 : null);

/** Normalizes a provider's daily row: fixed keys, numbers rounded to 0.1, missing values as null. */
export function normalizeDay(d) {
  return {
    date: d.date,
    tmin: round1(d.tmin),
    tmax: round1(d.tmax),
    pop: isNum(d.pop) ? Math.round(d.pop) : null,
    precip: round1(d.precip),
    wind: round1(d.wind),
    windDir: isNum(d.windDir) ? Math.round(d.windDir) % 360 : null,
    gust: round1(d.gust),
    rad: round1(d.rad),
    cloud: isNum(d.cloud) ? Math.round(d.cloud) : null,
    icon: d.icon || null,
    ...(d.partial ? { partial: true } : {}),
  };
}

const H = 3_600_000;
const pad2 = (n) => String(n).padStart(2, '0');

/** Hourly point: k = local 'YYYY-MM-DDTHH'; numeric fields are omitted when missing (smaller payload). */
export function normalizeHour(p) {
  const out = { k: p.k };
  const put = (key, v, digits) => {
    if (isNum(v)) out[key] = Math.round(v * 10 ** digits) / 10 ** digits;
  };
  put('temp', p.temp, 1);
  put('pop', p.pop, 0);
  put('precip', p.precip, 2);
  put('wind', p.wind, 1);
  if (isNum(p.windDir)) out.windDir = Math.round(p.windDir) % 360;
  put('gust', p.gust, 1);
  put('cloud', p.cloud, 0);
  put('rad', p.rad, 0);
  if (p.icon) out.icon = p.icon;
  return out;
}

/** Local-hour window kept for the hourly view: from the current hour until the end of today + (days-1). */
export function hourWindow(tz, { now = Date.now(), days = 3 } = {}) {
  const { date, hour } = localParts(now, tz);
  return { from: `${date}T${pad2(hour)}`, to: `${addDays(date, days - 1)}T23` };
}

/** Hourly series for points that already carry a local key (e.g. Open-Meteo with timezone=auto). */
export function hourlyFromLocal(points, tz, opts) {
  const { from, to } = hourWindow(tz, opts);
  return points.filter((p) => p.k >= from && p.k <= to).map(normalizeHour);
}

/** Hourly series from intervals (see aggregateIntervals); multi-hour intervals are spread over their hours. */
export function hourlyFromIntervals(intervals, tz, opts) {
  const { from, to } = hourWindow(tz, opts);
  const out = new Map();
  for (const iv of intervals) {
    const hours = Math.max(1, Math.round(iv.hours ?? 1));
    for (let h = 0; h < hours; h++) {
      const { date, hour } = localParts(iv.start + h * H, tz);
      const k = `${date}T${pad2(hour)}`;
      if (k < from || k > to || out.has(k)) continue;
      const temp = isNum(iv.temp) ? iv.temp : isNum(iv.tmin) && isNum(iv.tmax) ? (iv.tmin + iv.tmax) / 2 : null;
      out.set(k, normalizeHour({ ...iv, k, temp, precip: isNum(iv.precip) ? iv.precip / hours : null }));
    }
  }
  return [...out.values()].sort((a, b) => (a.k < b.k ? -1 : 1));
}

const max = (a, b) => (a === null ? b : Math.max(a, b));
const min = (a, b) => (a === null ? b : Math.min(a, b));

/**
 * Aggregates time intervals into local calendar days.
 * Interval: { start (ms), hours, temp, tmin, tmax, pop (%), precip (mm over the interval),
 *             wind (km/h), windDir (deg), gust (km/h), cloud (%), rad (mean W/m²), icon }.
 * Multi-hour intervals are split hour by hour so they are attributed to the correct local day.
 */
export function aggregateIntervals(intervals, tz, { fullDayHours = 20 } = {}) {
  const days = new Map();
  for (const iv of intervals) {
    const hours = Math.max(1, Math.round(iv.hours ?? 1));
    for (let h = 0; h < hours; h++) {
      const { date, hour } = localParts(iv.start + h * 3_600_000, tz);
      let d = days.get(date);
      if (!d) {
        d = {
          date, hours: 0, tmin: null, tmax: null, pop: null, precip: null, wind: null, gust: null,
          dirs: [], cloudSum: 0, cloudN: 0, rad: null, votesDay: {}, votesAll: {},
        };
        days.set(date, d);
      }
      d.hours++;
      const lo = isNum(iv.tmin) ? iv.tmin : iv.temp;
      const hi = isNum(iv.tmax) ? iv.tmax : iv.temp;
      if (isNum(lo)) d.tmin = min(d.tmin, lo);
      if (isNum(hi)) d.tmax = max(d.tmax, hi);
      if (isNum(iv.pop)) d.pop = max(d.pop, iv.pop);
      if (isNum(iv.precip)) d.precip = (d.precip ?? 0) + iv.precip / hours;
      if (isNum(iv.wind)) d.wind = max(d.wind, iv.wind);
      if (isNum(iv.windDir)) d.dirs.push({ deg: iv.windDir, w: isNum(iv.wind) ? Math.max(iv.wind, 0.1) : 1 });
      if (isNum(iv.gust)) d.gust = max(d.gust, iv.gust);
      if (isNum(iv.cloud)) {
        d.cloudSum += iv.cloud;
        d.cloudN++;
      }
      if (isNum(iv.rad)) d.rad = (d.rad ?? 0) + iv.rad * 0.0036; // 1 h of W/m² -> MJ/m²
      if (iv.icon) {
        d.votesAll[iv.icon] = (d.votesAll[iv.icon] || 0) + 1;
        if (hour >= 6 && hour < 21) d.votesDay[iv.icon] = (d.votesDay[iv.icon] || 0) + 1;
      }
    }
  }
  return [...days.values()]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((d) => {
      const cloud = d.cloudN ? d.cloudSum / d.cloudN : null;
      const dir = circularMean(d.dirs);
      const votes = Object.keys(d.votesDay).length ? d.votesDay : d.votesAll;
      return normalizeDay({
        date: d.date,
        tmin: d.tmin,
        tmax: d.tmax,
        pop: d.pop,
        precip: d.precip,
        wind: d.wind,
        windDir: dir ? dir.deg : null,
        gust: d.gust,
        rad: d.rad,
        cloud,
        icon: deriveDayIcon({ votes, precip: d.precip, cloud }),
        partial: d.hours < fullDayHours,
      });
    });
}
