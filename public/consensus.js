// Shared by the server (daily aggregation) and the browser (consensus row).
// This file is inlined into the page, so keep it dependency-free.

export const METRICS = ['tmin', 'tmax', 'pop', 'precip', 'wind', 'gust', 'rad', 'cloud'];
export const ICONS = ['clear', 'partly', 'cloudy', 'fog', 'drizzle', 'rain', 'sleet', 'snow', 'thunder'];
const PRECIP_ICONS = ['sleet', 'snow', 'rain', 'drizzle'];

export function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

export function median(values) {
  const v = values.filter(isNum).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Weighted mean of directions in degrees; r (0..1) is the agreement (resultant length). */
export function circularMean(items) {
  let x = 0;
  let y = 0;
  let wsum = 0;
  for (const { deg, w = 1 } of items) {
    if (!isNum(deg) || !(w > 0)) continue;
    const rad = (deg * Math.PI) / 180;
    x += Math.cos(rad) * w;
    y += Math.sin(rad) * w;
    wsum += w;
  }
  if (!wsum) return null;
  return { deg: ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360, r: Math.hypot(x, y) / wsum };
}

function topVote(votes, allowed) {
  let best = null;
  let bestN = 0;
  for (const k of allowed) {
    if ((votes[k] || 0) > bestN) {
      best = k;
      bestN = votes[k];
    }
  }
  return best;
}

/** Picks one representative pictogram for a day from icon votes and daily values. */
export function deriveDayIcon({ votes = {}, precip = null, cloud = null }) {
  const total = Object.values(votes).reduce((a, b) => a + b, 0);
  if (votes.thunder > 0) return 'thunder';
  if (isNum(precip) && precip >= 0.5) {
    return topVote(votes, PRECIP_ICONS) || (precip >= 2 ? 'rain' : 'drizzle');
  }
  if (votes.fog && votes.fog * 2 >= total) return 'fog';
  if (isNum(cloud)) return cloud < 25 ? 'clear' : cloud < 70 ? 'partly' : 'cloudy';
  return topVote(votes, ['clear', 'partly', 'cloudy', 'fog']) || topVote(votes, ICONS);
}

/**
 * Consensus ("expected value") of several providers' daily rows:
 * median per numeric metric, circular mean of wind direction, most frequent pictogram.
 */
export function consensus(rows) {
  const out = { count: rows.length, range: {} };
  for (const m of METRICS) {
    const vals = rows.map((r) => r[m]).filter(isNum);
    out[m] = median(vals);
    out.range[m] = vals.length ? { min: Math.min(...vals), max: Math.max(...vals), n: vals.length } : null;
  }
  const dir = circularMean(rows.map((r) => ({ deg: r.windDir })));
  out.windDir = dir && dir.r >= 0.3 ? dir.deg : null;
  out.windDirVariable = !!dir && dir.r < 0.3;

  const votes = {};
  for (const r of rows) if (r.icon) votes[r.icon] = (votes[r.icon] || 0) + 1;
  const top = Math.max(0, ...Object.values(votes));
  const tied = Object.keys(votes).filter((k) => votes[k] === top);
  const derived = deriveDayIcon({ votes, precip: out.precip, cloud: out.cloud });
  out.icon = tied.length === 1 ? tied[0] : tied.includes(derived) ? derived : tied[0] || derived;
  return out;
}

export const HOUR_METRICS = ['temp', 'pop', 'precip', 'wind', 'gust', 'cloud', 'rad'];
const SEVERITY = ['thunder', 'snow', 'sleet', 'rain', 'drizzle', 'fog', 'cloudy', 'partly', 'clear'];

/** Consensus of several providers' values for one hour (median, circular mean, icon vote; ties -> more severe). */
export function hourConsensus(points) {
  const out = { count: points.length, range: {} };
  for (const m of HOUR_METRICS) {
    const vals = points.map((p) => p[m]).filter(isNum);
    out[m] = median(vals);
    out.range[m] = vals.length ? { min: Math.min(...vals), max: Math.max(...vals), n: vals.length } : null;
  }
  const dir = circularMean(points.map((p) => ({ deg: p.windDir })));
  out.windDir = dir && dir.r >= 0.3 ? dir.deg : null;
  const votes = {};
  for (const p of points) if (p.icon) votes[p.icon] = (votes[p.icon] || 0) + 1;
  const top = Math.max(0, ...Object.values(votes));
  out.icon = top ? SEVERITY.find((k) => votes[k] === top) || Object.keys(votes).find((k) => votes[k] === top) : null;
  return out;
}