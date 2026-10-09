const formatters = new Map();

function formatter(tz) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(tz, f);
  }
  return f;
}

/** Local calendar date (YYYY-MM-DD) and hour of a UTC timestamp in an IANA time zone. */
export function localParts(ms, tz) {
  const p = {};
  for (const part of formatter(tz).formatToParts(ms)) p[part.type] = part.value;
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

export function isValidTz(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

export function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function localDates(tz, count, now = Date.now()) {
  const today = localParts(now, tz).date;
  return Array.from({ length: count }, (_, i) => addDays(today, i));
}
