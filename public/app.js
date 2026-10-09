import { I18N } from './i18n.js';
import { consensus, hourConsensus, isNum } from './consensus.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = {
  get(k) {
    try {
      return JSON.parse(localStorage.getItem(k));
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
};

const FALLBACK = { lat: 47.5, lon: 19.04, tz: 'Europe/Budapest', place: { name: 'Budapest', detail: null } };
const CACHE_MAX_AGE = 24 * 3600_000;
const CACHE_MAX_ENTRIES = 12;
const RANGES = [
  { key: 'today', start: 0, days: 1 },
  { key: 'tomorrow', start: 1, days: 1 },
  { key: 'd3', start: 0, days: 3 },
  { key: 'd5', start: 0, days: 5 },
  { key: 'd7', start: 0, days: 7 },
];
const COLORS = {
  'open-meteo': '#e4572e', 'met-norway': '#2e86de', weatherapi: '#27ae60', openweather: '#f39c12',
  'visual-crossing': '#8e44ad', meteosource: '#d81b60', tomorrow: '#00838f',
};
const CHARTS = ['temp', 'precip', 'wind', 'cloud', 'rad'];
const COLW = 46;
const CHART_H = 130;

// ---------- state ----------

const sp = new URLSearchParams(location.search);
const intParam = (k, lo, hi, def) => {
  const v = Number.parseInt(sp.get(k), 10);
  return Number.isInteger(v) && v >= lo && v <= hi ? v : def;
};
const fltParam = (k, lo, hi) => {
  const v = Number.parseFloat(sp.get(k));
  return Number.isFinite(v) && v >= lo && v <= hi ? v : null;
};
const urlLang = sp.get('lang');
const state = {
  lang:
    urlLang === 'hu' || urlLang === 'en'
      ? urlLang
      : store.get('ww:lang') || (/^hu\b/i.test(navigator.language || '') ? 'hu' : 'en'),
  langInUrl: urlLang === 'hu' || urlLang === 'en',
  days: intParam('days', 1, 7, 3),
  start: intParam('start', 0, 6, 0),
  q: (sp.get('q') || '').trim() || null,
  lat: fltParam('lat', -90, 90),
  lon: fltParam('lon', -180, 180),
  tz: null,
  place: null,
  providers: store.get('ww:providers') || [],
  data: {},
  pending: new Set(),
  loading: false,
  error: null,
  notice: null,
  fromGeo: false,
  fallback: false,
  locating: false,
  chart: CHARTS.includes(store.get('ww:chart')) ? store.get('ww:chart') : 'temp',
  hOpen: store.get('ww:hOpen') || {},
};
if (state.lat === null || state.lon === null) state.lat = state.lon = null;
let t = I18N[state.lang];

// ---------- formatting ----------

const fmtNum = (v, d = 0) =>
  isNum(v) ? v.toLocaleString(t.locale, { minimumFractionDigits: d, maximumFractionDigits: d }) : null;
const NA = '<span class="na">—</span>';
const tempHue = (v) => Math.max(0, Math.min(240, 240 - (v + 15) * 4.8)).toFixed(0);
const tempHtml = (v) => (isNum(v) ? `<span class="tv" style="--h:${tempHue(v)}">${fmtNum(v)}°</span>` : NA);
const compass = (deg) => t.compass[Math.round(deg / 22.5) % 16];
const icon = (name, cls = 'wx', night = false) =>
  name ? `<svg class="${cls}" role="img" aria-label="${esc(t.icons[name])}"><title>${esc(t.icons[name])}</title><use href="#wx-${name}${night && (name === 'clear' || name === 'partly') ? '-night' : ''}"/></svg>` : NA;
const ui = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const gustCls = (v) => (v >= 90 ? 'danger' : v >= 60 ? 'warn' : '');
const clamp100 = (v) => Math.max(0, Math.min(100, v));

function bar(value, digits, unit, pct, cls = '') {
  if (!isNum(value)) return NA;
  return `<span class="bar ${cls}" style="--p:${clamp100(pct).toFixed(0)}"><span>${fmtNum(value, digits)}<span class="u">${unit}</span></span><i></i></span>`;
}

function windHtml(speed, dir, variable = false) {
  if (!isNum(speed) && !isNum(dir)) return NA;
  const arrow = isNum(dir)
    ? `<svg class="arr" style="--r:${(dir + 180) % 360}deg" role="img" aria-label="${esc(t.windFrom)}: ${compass(dir)}"><use href="#i-arrow"/></svg><span class="dir">${compass(dir)}</span>`
    : variable
      ? `<span class="dir">${esc(t.variable)}</span>`
      : '';
  return `<span class="wind">${arrow}${isNum(speed) ? `${fmtNum(speed)}<span class="u">km/h</span>` : NA}</span>`;
}

const gustHtml = (v) => (isNum(v) ? `<span class="${gustCls(v)}">${fmtNum(v)}<span class="u">km/h</span></span>` : NA);
const range = (r, d = 0, unit = '') => {
  if (!r || r.n < 2) return '';
  const lo = fmtNum(r.min, d);
  const hi = fmtNum(r.max, d);
  return lo === hi ? '' : `<span class="rng">${lo}–${hi}${unit}</span>`;
};

function todayIn(tz) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function addDays(date, n) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Current local hour at the location as 'YYYY-MM-DDTHH'. */
function nowKey(tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || undefined, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date());
    const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}`;
  } catch {
    return new Date().toISOString().slice(0, 13);
  }
}

function dayLabel(date, today) {
  const d = new Date(`${date}T12:00:00Z`);
  const long = new Intl.DateTimeFormat(t.locale, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(d);
  const rel = date === today ? t.today : date === addDays(today, 1) ? t.tomorrow : null;
  return rel ? `${esc(rel)} <small>${esc(long)}</small>` : esc(long);
}

const timeFmt = (ms) => new Intl.DateTimeFormat(t.locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(ms));

// ---------- rendering ----------

let rafId = 0;
function render() {
  if (!rafId) rafId = requestAnimationFrame(doRender);
}

function selectedDates() {
  const today = todayIn(state.tz);
  return { today, dates: Array.from({ length: state.days }, (_, i) => addDays(today, state.start + i)) };
}

function rowsFor(date) {
  const out = [];
  for (const p of state.providers) {
    if (!p.configured) continue;
    const entry = state.data[p.id];
    const day = entry?.days?.find((d) => d.date === date) || null;
    out.push({ p, entry, day });
  }
  return out;
}

function doRender() {
  rafId = 0;
  renderPlace();
  renderStatus();
  renderRanges();
  const n = $('#notice');
  const msg = state.error || noticeText();
  n.hidden = !msg;
  n.textContent = msg || '';

  const { today, dates } = selectedDates();
  const anyData = Object.values(state.data).some((e) => e.days);
  if (!anyData && (state.loading || state.lat === null)) return; // keep markup skeletons
  if (!state.providers.some((p) => p.configured)) {
    $('#hero').innerHTML = `<p class="empty">${esc(t.noProviders)}</p>`;
    $('#days').innerHTML = '';
    return;
  }
  const cons = dates.map((date) => {
    const days = rowsFor(date).map((r) => r.day).filter(Boolean);
    return days.length ? consensus(days) : null;
  });
  renderHero(dates[0], today, cons[0]);
  const daysEl = $('#days');
  const scrolls = {};
  for (const el of daysEl.querySelectorAll('[data-scroll]')) scrolls[el.dataset.scroll] = el.scrollLeft;
  daysEl.innerHTML = dates.map((date, i) => dayCard(date, today, cons[i])).join('');
  for (const el of daysEl.querySelectorAll('[data-scroll]')) if (scrolls[el.dataset.scroll]) el.scrollLeft = scrolls[el.dataset.scroll];
  renderFooter();
}

function noticeText() {
  if (!state.notice) return '';
  const base = t[state.notice] || state.notice;
  return state.fallback && state.place?.name ? `${base} ${t.geoFallback(state.place.name)}` : base;
}

function renderPlace() {
  const pl = state.place;
  const h = $('#place');
  if (pl?.name) h.innerHTML = `${esc(pl.name)}${pl.detail ? ` <small>${esc(pl.detail)}</small>` : ''}`;
  else if (state.lat !== null) h.innerHTML = `${fmtNum(state.lat, 2)}, ${fmtNum(state.lon, 2)}`;
  else if (!h.querySelector('.sk')) h.innerHTML = '<span class="sk sk-wide"></span>';
  document.title = pl?.name ? `${pl.name} – Whether Weather` : 'Whether Weather';
}

function renderStatus() {
  const s = $('#status');
  const times = Object.values(state.data).map((e) => e.fetchedAt).filter(isNum);
  let txt;
  if (state.loading) txt = times.length && state.fromCache ? t.cachedAt(timeFmt(Math.min(...times))) : t.updating;
  else txt = times.length ? t.updated(timeFmt(Math.min(...times))) : '';
  s.textContent = state.locating ? [t.locating, txt].filter(Boolean).join(' · ') : txt;
}

function renderRanges() {
  const nav = $('#ranges');
  nav.setAttribute('aria-label', t.rangeLabel);
  nav.innerHTML = RANGES.map((r) => {
    const cur = r.start === state.start && r.days === state.days;
    return `<a href="${esc(buildUrl({ start: r.start, days: r.days }))}" data-start="${r.start}" data-days="${r.days}"${cur ? ' aria-current="true"' : ''}>${esc(t.ranges[r.key])}</a>`;
  }).join('');
}

function renderHero(date, today, c) {
  const hero = $('#hero');
  if (!c) {
    hero.innerHTML = state.loading
      ? '<div class="hero-ic sk"></div><div class="hero-main"><span class="sk sk-wide"></span><span class="sk"></span></div>'
      : `<p class="empty">${esc(t.noData)}</p>`;
    return;
  }
  const rel = date === today ? t.today : date === addDays(today, 1) ? t.tomorrow : new Intl.DateTimeFormat(t.locale, { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
  const fact = (ic, html, title) => `<span class="fact" title="${esc(title)}">${ui(ic)}${html}</span>`;
  hero.innerHTML = `
    <div class="hero-ic">${icon(c.icon, 'wx-hero')}</div>
    <div class="hero-main">
      <div class="hero-t">${tempHtml(c.tmax)} <span class="lo">/ ${tempHtml(c.tmin)}</span></div>
      <div class="hero-d">${esc(rel)} · ${esc(t.icons[c.icon] || '')} · ${esc(t.basedOn(c.count))}</div>
    </div>
    <div class="hero-facts">
      ${fact('umbrella', isNum(c.pop) ? `<b>${fmtNum(c.pop)}%</b>` : NA, t.cols.pop)}
      ${fact('drop', isNum(c.precip) ? `<b>${fmtNum(c.precip, 1)}</b><span class="u">mm</span>` : NA, t.cols.precip)}
      ${fact('wind', windHtml(c.wind, c.windDir, c.windDirVariable), t.cols.wind)}
      ${fact('gust', gustHtml(c.gust), t.cols.gust)}
      ${fact('sun', isNum(c.rad) ? `<b>${fmtNum(c.rad, 1)}</b><span class="u">MJ/m²</span>` : NA, t.cols.rad)}
      ${fact('cloud', isNum(c.cloud) ? `<b>${fmtNum(c.cloud)}%</b>` : NA, t.cols.cloud)}
    </div>`;
}

function cells(d) {
  const part = d.partial ? `<sup class="part" title="${esc(t.partial)}">*</sup>` : '';
  return `
    <td>${icon(d.icon)}</td>
    <td class="t">${tempHtml(d.tmin)}<span class="sep">/</span>${tempHtml(d.tmax)}${part}</td>
    <td>${bar(d.pop, 0, '%', d.pop)}</td>
    <td>${bar(d.precip, 1, 'mm', (d.precip ?? 0) * 10)}</td>
    <td>${windHtml(d.wind, d.windDir)}</td>
    <td>${gustHtml(d.gust)}</td>
    <td>${bar(d.rad, 1, 'MJ/m²', ((d.rad ?? 0) / 30) * 100, 'sun')}</td>
    <td>${bar(d.cloud, 0, '%', d.cloud, 'cld')}</td>`;
}

function dayCard(date, today, c) {
  const head = [
    ['source', null, null],
    ['sky', null, 'sky'],
    ['temp', t.hints.temp, 'thermo'],
    ['pop', t.hints.pop, 'umbrella'],
    ['precip', t.hints.precip, 'drop'],
    ['wind', t.hints.wind, 'wind'],
    ['gust', t.hints.gust, 'gust'],
    ['rad', t.hints.rad, 'sun'],
    ['cloud', t.hints.cloud, 'cloud'],
  ]
    .map(([k, hint, ic]) => `<th scope="col"${hint ? ` title="${esc(hint)}"` : ''}>${ic ? ui(ic) : ''}${esc(t.cols[k])}</th>`)
    .join('');

  const body = rowsFor(date)
    .map(({ p, entry, day }) => {
      const name = `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.name)}</a>`;
      if (day) return `<tr class="${entry.stale ? 'stale' : ''}"${entry.stale ? ` title="${esc(t.stale)}"` : ''}><th scope="row">${name}</th>${cells(day)}</tr>`;
      if (entry?.error) {
        const msg = t.errors[entry.error] || entry.error;
        return `<tr class="err"><th scope="row">${name}</th><td colspan="8">${esc(t.errorPrefix)}: ${esc(msg)}</td></tr>`;
      }
      if (entry?.days || !state.loading) return `<tr class="err"><th scope="row">${name}</th><td colspan="8">${esc(t.noDataDay)}</td></tr>`;
      return `<tr><th scope="row">${name}</th>${'<td><span class="sk"></span></td>'.repeat(8)}</tr>`;
    })
    .join('');

  const foot = c
    ? `<tfoot><tr title="${esc(t.consensusHint)}"><th scope="row">${esc(t.consensus)}<small>${esc(t.consensusSub)} · ${esc(t.basedOn(c.count))}</small></th>
        <td>${icon(c.icon)}</td>
        <td class="t">${tempHtml(c.tmin)}<span class="sep">/</span>${tempHtml(c.tmax)}${range(c.range.tmin, 0, '°')}${range(c.range.tmax, 0, '°')}</td>
        <td>${bar(c.pop, 0, '%', c.pop)}${range(c.range.pop, 0, '%')}</td>
        <td>${bar(c.precip, 1, 'mm', (c.precip ?? 0) * 10)}${range(c.range.precip, 1)}</td>
        <td>${windHtml(c.wind, c.windDir, c.windDirVariable)}${range(c.range.wind)}</td>
        <td>${gustHtml(c.gust)}${range(c.range.gust)}</td>
        <td>${bar(c.rad, 1, 'MJ/m²', ((c.rad ?? 0) / 30) * 100, 'sun')}${range(c.range.rad, 1)}</td>
        <td>${bar(c.cloud, 0, '%', c.cloud, 'cld')}${range(c.range.cloud, 0, '%')}</td></tr></tfoot>`
    : '';

  return `<section class="day"><h2>${dayLabel(date, today)}</h2><div class="scroll"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table></div>${hourlySection(date, today)}</section>`;
}

// ---------- hourly view (today & tomorrow) ----------

function hourlyData(date, today) {
  const from = date === today ? nowKey(state.tz) : `${date}T00`;
  const to = `${date}T23`;
  const series = [];
  const keys = new Set();
  for (const p of state.providers) {
    if (!p.configured) continue;
    const hrs = state.data[p.id]?.hours;
    if (!hrs?.length) continue;
    const map = new Map();
    for (const h of hrs) {
      if (h.k >= from && h.k <= to) {
        map.set(h.k, h);
        keys.add(h.k);
      }
    }
    if (map.size) series.push({ p, map });
  }
  const cols = [...keys].sort();
  const cons = cols.map((k) => hourConsensus(series.map((s) => s.map.get(k)).filter(Boolean)));
  return { series, cols, cons };
}

function hourlySection(date, today) {
  const rel = date === today ? 'today' : date === addDays(today, 1) ? 'tomorrow' : null;
  if (!rel) return '';
  const hd = hourlyData(date, today);
  if (!hd.cols.length) return '';
  const open = state.hOpen[rel] ?? true;
  return `<details class="hourly" data-rel="${rel}"${open ? ' open' : ''}><summary>${esc(t.hourly)}</summary>${hourlyBody(hd, rel)}</details>`;
}

const fmtPrecip = (v) =>
  !isNum(v) ? NA : v === 0 ? '<span class="z">0</span>' : v < 0.1 ? `&lt;${fmtNum(0.1, 1)}` : fmtNum(v, 1);

function hourlyBody({ series, cols, cons }, rel) {
  const night = cols.map((k, i) => {
    const h = Number(k.slice(11));
    return isNum(cons[i].rad) ? cons[i].rad < 5 : h < 6 || h >= 20;
  });
  const tip = (i, m, d, unit) =>
    series
      .map((s) => {
        const v = s.map.get(cols[i])?.[m];
        return isNum(v) ? `${s.p.name}: ${fmtNum(v, d)}${unit}` : null;
      })
      .filter(Boolean)
      .join('\n');
  const row = (key, m, d, unit, fn) =>
    `<tr class="h-${key}"><th scope="row">${esc(t.hrows[key])}</th>${cons
      .map((c, i) => `<td${m ? ` title="${esc(tip(i, m, d, unit))}"` : ''}${night[i] ? ' class="nt"' : ''}>${fn(c, i)}</td>`)
      .join('')}</tr>`;
  const ch = chartSvg(series, cols, cons, night);
  const width = 92 + cols.length * COLW;

  const tabs = CHARTS.map(
    (c) => `<button type="button" data-chart="${c}" aria-pressed="${state.chart === c}">${esc(t.charts[c])}</button>`,
  ).join('');
  const legend = (
    state.chart === 'precip'
      ? [
          `<span class="lg"><i class="sw bar-sw"></i>${esc(t.charts.precip)} (${esc(t.legendCons)}, mm)</span>`,
          `<span class="lg"><i class="sw dash"></i>${esc(t.legendPop)}</span>`,
        ]
      : [
          ...series.map((s) => `<span class="lg"><i class="sw" style="--c:${COLORS[s.p.id] || '#888'}"></i>${esc(s.p.name)}</span>`),
          `<span class="lg"><i class="sw cons"></i>${esc(t.legendCons)}</span>`,
          ...(state.chart === 'wind' ? [`<span class="lg"><i class="sw dash"></i>${esc(t.legendGust)}</span>`] : []),
        ]
  ).join('');

  return `<div class="htools"><div class="tabs" role="group">${tabs}</div><div class="legend">${legend}</div></div>
    <div class="scroll" data-scroll="${rel}"><table class="htable" style="width:${width}px">
      <colgroup><col style="width:92px">${`<col style="width:${COLW}px">`.repeat(cols.length)}</colgroup>
      <thead><tr><th></th>${cols.map((k, i) => `<th scope="col"${night[i] ? ' class="nt"' : ''}>${k.slice(11)}</th>`).join('')}</tr></thead>
      <tbody>
        <tr class="h-chart"><th scope="row" class="ax">${ch.axis}</th><td colspan="${cols.length}">${ch.svg}</td></tr>
        ${row('sky', null, 0, '', (c, i) => icon(c.icon, 'wx wx-s', night[i]))}
        ${row('temp', 'temp', 1, '°', (c) => tempHtml(c.temp))}
        ${row('pop', 'pop', 0, '%', (c) => (isNum(c.pop) ? `<span class="hp" style="--p:${clamp100(c.pop).toFixed(0)}">${fmtNum(c.pop)}</span>` : NA))}
        ${row('precip', 'precip', 1, ' mm', (c) => fmtPrecip(c.precip))}
        ${row('wind', 'wind', 0, ' km/h', (c) =>
          isNum(c.wind)
            ? `<span class="hw">${isNum(c.windDir) ? `<svg class="arr" style="--r:${(c.windDir + 180) % 360}deg" role="img" aria-label="${esc(t.windFrom)}: ${compass(c.windDir)}"><use href="#i-arrow"/></svg>` : ''}${fmtNum(c.wind)}</span>`
            : NA)}
        ${row('gust', 'gust', 0, ' km/h', (c) => (isNum(c.gust) ? `<span class="${gustCls(c.gust)}">${fmtNum(c.gust)}</span>` : NA))}
        ${row('cloud', 'cloud', 0, '%', (c) => (isNum(c.cloud) ? fmtNum(c.cloud) : NA))}
        ${row('rad', 'rad', 0, ' W/m²', (c) => (isNum(c.rad) ? fmtNum(c.rad) : NA))}
      </tbody></table></div>`;
}

const niceMax = (v, step) => Math.max(step, Math.ceil(v / step) * step);

function chartSvg(series, cols, cons, night) {
  const n = cols.length;
  const W = n * COLW;
  const H = CHART_H;
  const top = 10;
  const bot = 8;
  const x = (i) => i * COLW + COLW / 2;
  const kind = state.chart;
  const nums = (arr) => arr.filter(isNum);
  const metric = kind === 'precip' ? 'pop' : kind;
  const prov = series.map((s) => ({ s, vals: cols.map((k) => s.map.get(k)?.[metric]) }));
  const consVals = cons.map((c) => c[metric]);
  let lo = 0;
  let hi = 100;
  let unit = '%';
  let digits = 0;

  if (kind === 'temp') {
    const all = nums([...prov.flatMap((p) => p.vals), ...consVals]);
    lo = all.length ? Math.floor(Math.min(...all)) - 1 : 0;
    hi = all.length ? Math.ceil(Math.max(...all)) + 1 : 10;
    if (hi - lo < 6) {
      lo = Math.floor((hi + lo) / 2 - 3);
      hi = lo + 6;
    }
    unit = '°C';
  } else if (kind === 'wind') {
    hi = niceMax(Math.max(0, ...nums([...prov.flatMap((p) => p.vals), ...cons.map((c) => c.gust)])), 10);
    unit = 'km/h';
  } else if (kind === 'rad') {
    hi = niceMax(Math.max(0, ...nums([...prov.flatMap((p) => p.vals), ...consVals])), 200);
    unit = 'W/m²';
  }
  const y = (v, a = lo, b = hi) => top + (1 - (v - a) / (b - a)) * (H - top - bot);
  const path = (vals) => {
    let d = '';
    let pen = false;
    vals.forEach((v, i) => {
      if (!isNum(v)) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };

  let shade = '';
  for (let i = 0; i < n; i++) {
    if (!night[i]) continue;
    let j = i;
    while (j + 1 < n && night[j + 1]) j++;
    shade += `<rect class="nt" x="${i * COLW}" y="0" width="${(j - i + 1) * COLW}" height="${H}"/>`;
    i = j;
  }
  const grid = [lo, (lo + hi) / 2, hi]
    .map((v) => `<line class="gl" x1="0" x2="${W}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>`)
    .join('');

  let body = '';
  let axisVals = [hi, (lo + hi) / 2, lo];
  if (kind === 'precip') {
    const pMax = Math.max(0, ...nums(cons.map((c) => c.precip)));
    const pHi = pMax <= 1 ? 1 : pMax <= 2 ? 2 : pMax <= 5 ? 5 : niceMax(pMax, 5);
    body += cons
      .map((c, i) => {
        if (!isNum(c.precip) || c.precip <= 0) return '';
        const yy = Math.min(y(c.precip, 0, pHi), H - bot - 1.5);
        return `<rect class="pb" x="${(x(i) - 13).toFixed(1)}" y="${yy.toFixed(1)}" width="26" height="${(H - bot - yy).toFixed(1)}" rx="2"/>`;
      })
      .join('');
    body += `<path class="dash" d="${path(consVals)}"/>`;
    axisVals = [pHi, pHi / 2, 0];
    unit = 'mm · %';
    digits = pHi < 2 ? 1 : 0;
  } else {
    body += prov.map((p) => `<path class="pl" style="--c:${COLORS[p.s.p.id] || '#888'}" d="${path(p.vals)}"/>`).join('');
    if (kind === 'wind') body += `<path class="dash" d="${path(cons.map((c) => c.gust))}"/>`;
    body += `<path class="cl-line" d="${path(consVals)}"/>`;
    body += consVals.map((v, i) => (isNum(v) ? `<circle class="cd" cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.6"/>` : '')).join('');
  }
  const svg = `<svg class="hchart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t.charts[kind])}"><title>${esc(t.hourlyHint)}</title>${shade}${grid}${body}</svg>`;
  const axis = `<div class="axv" style="height:${H}px"><em>${esc(unit)}</em>${axisVals
    .map((v) => `<span style="top:${y(v, axisVals[2], axisVals[0]).toFixed(0)}px">${fmtNum(v, digits)}</span>`)
    .join('')}</div>`;
  return { svg, axis };
}

function renderFooter() {
  const on = state.providers.filter((p) => p.configured);
  const off = state.providers.filter((p) => !p.configured);
  $('#footer').innerHTML = `
    <p>${esc(t.sources)}: ${on.map((p) => `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.name)}</a>`).join(' · ')}</p>
    ${off.length ? `<p>${esc(t.missingKeys(off.map((p) => p.name).join(', ')))}</p>` : ''}
    <p>${esc(t.consensusHint)}</p>
    <p>${esc(t.noteTz)}</p>`;
}

function applyLang() {
  t = I18N[state.lang];
  document.documentElement.lang = state.lang;
  const q = $('#q');
  q.placeholder = t.searchPlaceholder;
  q.setAttribute('aria-label', t.searchLabel);
  $('#locate').title = t.locate;
  $('#locate .lbl').textContent = t.locate;
  for (const b of document.querySelectorAll('[data-lang]')) b.setAttribute('aria-pressed', String(b.dataset.lang === state.lang));
  render();
}

// ---------- URL ----------

function buildUrl(over = {}) {
  const s = { q: state.q, lat: state.lat, lon: state.lon, start: state.start, days: state.days, ...over };
  const u = new URLSearchParams();
  if (s.q && !state.fromGeo) u.set('q', s.q);
  if (s.lat !== null && s.lat !== undefined && !state.fromGeo) {
    u.set('lat', String(Math.round(s.lat * 100) / 100));
    u.set('lon', String(Math.round(s.lon * 100) / 100));
  }
  if (s.start) u.set('start', String(s.start));
  if (s.days !== 3) u.set('days', String(s.days));
  if (state.langInUrl) u.set('lang', state.lang);
  const qs = u.toString();
  return qs ? `/?${qs}` : '/';
}

const syncUrl = () => history.replaceState(null, '', buildUrl());

// ---------- local cache ----------

const cacheKey = (lat, lon) => `ww:fc:${lat.toFixed(2)},${lon.toFixed(2)}`;

function saveCache() {
  if (state.lat === null) return;
  const key = cacheKey(state.lat, state.lon);
  const data = {};
  for (const [id, e] of Object.entries(state.data)) if (e.days) data[id] = { days: e.days, hours: e.hours, fetchedAt: e.fetchedAt };
  if (!Object.keys(data).length) return;
  store.set(key, { lat: state.lat, lon: state.lon, tz: state.tz, place: state.place, data, t: Date.now() });
  if (state.q) store.set(`ww:q:${state.q.toLowerCase()}`, { lat: state.lat, lon: state.lon });
  const idx = (store.get('ww:idx') || []).filter((k) => k !== key);
  idx.unshift(key);
  for (const old of idx.splice(CACHE_MAX_ENTRIES)) {
    try {
      localStorage.removeItem(old);
    } catch {}
  }
  store.set('ww:idx', idx);
}

function loadCache(lat, lon) {
  const c = store.get(cacheKey(lat, lon));
  if (!c || Date.now() - c.t > CACHE_MAX_AGE) return null;
  return c;
}

function applyCached(c) {
  state.tz = c.tz;
  state.place = c.place;
  state.data = {};
  for (const [id, e] of Object.entries(c.data)) state.data[id] = { ...e, stale: true };
  state.fromCache = true;
}

// ---------- data loading ----------

let ctrl = null;

async function load() {
  ctrl?.abort();
  ctrl = new AbortController();
  const { signal } = ctrl;
  state.loading = true;
  state.error = null;
  state.pending = new Set(state.providers.filter((p) => p.configured).map((p) => p.id));
  render();

  const u = new URLSearchParams({ lang: state.lang });
  if (state.lat !== null) {
    u.set('lat', String(state.lat));
    u.set('lon', String(state.lon));
    if (state.q) u.set('q', state.q);
    if (state.tz) u.set('tz', state.tz);
  } else if (state.q) u.set('q', state.q);

  try {
    const res = await fetch(`/api/forecast?${u}`, { signal });
    if (!res.ok || !res.body) throw new Error('failed');
    let buf = '';
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line) handleEvent(JSON.parse(line));
      }
    }
  } catch (e) {
    if (signal.aborted) return;
    if (!Object.values(state.data).some((d) => d.days)) state.error = t.failed;
  }
  if (signal.aborted) return;
  for (const id of state.pending) if (!state.data[id]?.days) state.data[id] = { error: t.noResponse };
  state.loading = false;
  state.fromCache = false;
  saveCache();
  render();
}

function handleEvent(ev) {
  switch (ev.type) {
    case 'meta':
      state.providers = ev.providers;
      store.set('ww:providers', ev.providers);
      break;
    case 'place':
      state.place = { name: ev.name, detail: ev.detail || null };
      break;
    case 'location':
      state.lat = ev.lat;
      state.lon = ev.lon;
      state.tz = ev.tz;
      break;
    case 'provider':
      state.pending.delete(ev.id);
      state.data[ev.id] = { days: ev.days, hours: ev.hours, fetchedAt: ev.fetchedAt, stale: ev.stale };
      break;
    case 'provider-error': {
      state.pending.delete(ev.id);
      const prev = state.data[ev.id];
      state.data[ev.id] = prev?.days ? { ...prev, stale: true } : { error: ev.message };
      break;
    }
    case 'error':
      if (ev.code === 'not-found' && state.fallback && state.q) {
        // Time-zone based guess was not found: fall back to the default place.
        const notice = state.notice;
        setLocation({ ...FALLBACK, fromGeo: true, fallback: true });
        state.notice = notice;
        return;
      }
      state.error = ev.code === 'not-found' ? t.notFound : t.failed;
      break;
    default:
      return;
  }
  render();
}

function setLocation({ q = null, lat = null, lon = null, tz = null, place = null, fromGeo = false, fallback = false }) {
  state.q = q;
  state.lat = lat;
  state.lon = lon;
  state.tz = tz;
  state.place = place;
  state.fromGeo = fromGeo;
  state.fallback = fallback;
  state.notice = null;
  state.data = {};
  state.fromCache = false;
  if (lat !== null) {
    const c = loadCache(lat, lon);
    if (c) {
      applyCached(c);
      if (place) state.place = place;
      if (tz) state.tz = tz;
    }
  }
  syncUrl();
  load();
}

// ---------- geolocation ----------

const distKm = (a, b, c, d) => {
  const r = Math.PI / 180;
  const x = (d - b) * r * Math.cos(((a + c) / 2) * r);
  return Math.hypot(x, (c - a) * r) * 6371;
};

/** First-visit guess while waiting for geolocation: the browser time zone's city, else the default. */
function fallbackLocation() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  const m = /^(Europe|America|Asia|Africa|Australia|Pacific|Atlantic|Indian)\/(?:[^/]+\/)?([^/]+)$/.exec(tz);
  if (!m || tz === FALLBACK.tz) return { ...FALLBACK };
  return { q: m[2].replace(/_/g, ' '), tz };
}

function geolocate({ force = false } = {}) {
  const btn = $('#locate');
  const done = () => {
    btn.removeAttribute('aria-busy');
    state.locating = false;
  };
  const fail = (code) => {
    done();
    const key = !window.isSecureContext ? 'geoInsecure' : code === 1 ? 'geoDenied' : code === 3 ? 'geoTimeout' : 'geoUnavailable';
    if (state.lat === null && !state.q) setLocation({ ...FALLBACK, fromGeo: true, fallback: true });
    if (force || state.fallback) state.notice = key;
    render();
  };
  if (!navigator.geolocation || !window.isSecureContext) return fail(1);
  btn.setAttribute('aria-busy', 'true');
  state.locating = true;
  render();
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      done();
      const lat = Math.round(pos.coords.latitude * 100) / 100;
      const lon = Math.round(pos.coords.longitude * 100) / 100;
      store.set('ww:lastGeo', { lat, lon });
      const near = state.lat !== null && distKm(state.lat, state.lon, lat, lon) < 2;
      if (!force && !state.fromGeo && state.lat !== null) return render(); // user picked another place meanwhile
      if (near && (state.fromGeo || !force)) {
        state.fromGeo = true;
        state.fallback = false;
        state.notice = null;
        syncUrl();
        return render();
      }
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
      setLocation({ lat, lon, tz, fromGeo: true });
    },
    (err) => fail(err?.code),
    { maximumAge: 30 * 60_000, timeout: 15_000, enableHighAccuracy: false },
  );
}

// ---------- search ----------

const qInput = $('#q');
const list = $('#suggest');
let results = [];
let sel = -1;
let searchTimer = 0;
let searchCtrl = null;

function showSuggest(items) {
  results = items;
  sel = -1;
  list.innerHTML = items
    .map((r, i) => `<li role="option" id="sg${i}" data-i="${i}" aria-selected="false">${esc(r.name)}${r.detail ? `<small>${esc(r.detail)}</small>` : ''}</li>`)
    .join('');
  list.hidden = !items.length;
  qInput.setAttribute('aria-expanded', String(!!items.length));
}

function hideSuggest() {
  list.hidden = true;
  qInput.setAttribute('aria-expanded', 'false');
}

function moveSel(d) {
  if (!results.length) return;
  sel = (sel + d + results.length) % results.length;
  for (const li of list.children) li.setAttribute('aria-selected', String(Number(li.dataset.i) === sel));
  qInput.setAttribute('aria-activedescendant', `sg${sel}`);
}

async function search(q) {
  searchCtrl?.abort();
  searchCtrl = new AbortController();
  try {
    const res = await fetch(`/api/geocode?${new URLSearchParams({ q, lang: state.lang })}`, { signal: searchCtrl.signal });
    const json = await res.json();
    if (qInput.value.trim() === q) showSuggest(json.results || []);
    return json.results || [];
  } catch {
    return [];
  }
}

function choose(r) {
  hideSuggest();
  qInput.value = '';
  qInput.blur();
  setLocation({ q: r.name, lat: r.lat, lon: r.lon, tz: r.tz || null, place: { name: r.name, detail: r.detail || null } });
}

qInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = qInput.value.trim();
  if (q.length < 2) return hideSuggest();
  searchTimer = setTimeout(() => search(q), 200);
});
qInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') moveSel(1);
  else if (e.key === 'ArrowUp') moveSel(-1);
  else if (e.key === 'Escape') hideSuggest();
  else return;
  e.preventDefault();
});
qInput.addEventListener('blur', () => setTimeout(hideSuggest, 150));
list.addEventListener('mousedown', (e) => {
  const li = e.target.closest('li');
  if (li) {
    e.preventDefault();
    choose(results[Number(li.dataset.i)]);
  }
});
$('#search').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = qInput.value.trim();
  if (!q) return;
  if (sel >= 0 && results[sel]) return choose(results[sel]);
  clearTimeout(searchTimer);
  const r = !list.hidden && results.length ? results : await search(q);
  if (r.length) choose(r[0]);
  else {
    state.error = t.notFound;
    render();
  }
});

// ---------- other UI events ----------

$('#locate').addEventListener('click', () => geolocate({ force: true }));

for (const b of document.querySelectorAll('[data-lang]')) {
  b.addEventListener('click', () => {
    if (state.lang === b.dataset.lang) return;
    state.lang = b.dataset.lang;
    state.langInUrl = true;
    store.set('ww:lang', state.lang);
    if (state.error) state.error = null;
    syncUrl();
    applyLang();
  });
}

$('#ranges').addEventListener('click', (e) => {
  const a = e.target.closest('a[data-days]');
  if (!a || e.ctrlKey || e.metaKey || e.shiftKey) return;
  e.preventDefault();
  state.start = Number(a.dataset.start);
  state.days = Number(a.dataset.days);
  syncUrl();
  render();
});

$('#days').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-chart]');
  if (!b || state.chart === b.dataset.chart) return;
  state.chart = b.dataset.chart;
  store.set('ww:chart', state.chart);
  render();
});
$('#days').addEventListener(
  'toggle',
  (e) => {
    const d = e.target;
    if (!d.matches?.('details.hourly') || (state.hOpen[d.dataset.rel] ?? true) === d.open) return;
    state.hOpen[d.dataset.rel] = d.open;
    store.set('ww:hOpen', state.hOpen);
  },
  true,
);

let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (hiddenAt && Date.now() - hiddenAt > 30 * 60_000 && !state.loading && (state.lat !== null || state.q)) load();
});

// ---------- boot ----------

function init() {
  applyLang();
  const bootEl = document.getElementById('boot');
  const boot = bootEl ? JSON.parse(bootEl.textContent) : null;

  if (boot) {
    // Server-embedded snapshot: render immediately, refresh only if something is missing or old.
    state.lat = boot.lat;
    state.lon = boot.lon;
    state.tz = boot.tz;
    state.place = boot.place || null;
    if (boot.providers) state.providers = boot.providers;
    state.data = boot.data || {};
    render();
    if (boot.complete) {
      saveCache();
      return;
    }
    return void load();
  }

  if (state.lat !== null || state.q) {
    let c = null;
    if (state.lat !== null) c = loadCache(state.lat, state.lon);
    else {
      const ref = store.get(`ww:q:${state.q.toLowerCase()}`);
      if (ref) {
        c = loadCache(ref.lat, ref.lon);
        if (c) {
          state.lat = c.lat;
          state.lon = c.lon;
        }
      }
    }
    if (c) applyCached(c);
    return void load();
  }

  // No location in the URL: show the last known position (or a time-zone based guess) instantly,
  // then confirm via geolocation. The permission prompt may stay open indefinitely, so never wait for it.
  const last = store.get('ww:lastGeo');
  if (last) {
    state.fromGeo = true;
    state.lat = last.lat;
    state.lon = last.lon;
    const c = loadCache(last.lat, last.lon);
    if (c) applyCached(c);
    else state.tz = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    load();
  } else {
    setLocation({ ...fallbackLocation(), fromGeo: true, fallback: true });
  }
  geolocate();
}

init();
