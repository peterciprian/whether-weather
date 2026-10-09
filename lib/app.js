import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync, brotliCompressSync, constants as zc } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadEnv } from './env.js';
import { SwrCache } from './cache.js';
import { createGeo } from './geo.js';
import { createForecastService, NotFoundError } from './forecast.js';
import { PROVIDERS } from './providers/index.js';
import { isValidTz } from './time.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(join(root, '.env'));

/**
 * `background(promise)` keeps work alive after the response is sent
 * (on Vercel: waitUntil; on a long-running server: no-op).
 */
const background = { run: (p) => p };
export const setBackground = (fn) => {
  background.run = fn;
};
const bg = (p) => background.run(p);

const cache = new SwrCache({ maxEntries: 10_000, background: bg });
const geo = createGeo({ cache });
export const service = createForecastService({ providers: PROVIDERS, cache, geo });

// ---------- page build (once, at startup) ----------

const read = (f) => readFileSync(join(root, 'web', f), 'utf8').replace(/\r\n?/g, '\n');
const stripModule = (src) => src.replace(/^import .*$/gm, '').replace(/^export (?=(const|function|let|class|async))/gm, '');

const script = ['i18n.js', 'consensus.js', 'app.js'].map((f) => stripModule(read(f))).join('\n');
const template = read('index.html')
  .replace('/*{{STYLES}}*/', () => read('styles.css'))
  .replace('/*{{SCRIPT}}*/', () => script);
const scriptHash = createHash('sha256').update(script).digest('base64');
const [pageHead, pageTail] = template.split('<!--{{BOOT}}-->');
const staticPage = Buffer.from(pageHead + pageTail);
const staticEtag = `"${createHash('sha1').update(staticPage).digest('base64url')}"`;
const staticBr = brotliCompressSync(staticPage, { params: { [zc.BROTLI_PARAM_QUALITY]: 11 } });
const staticGz = gzipSync(staticPage, { level: 9 });
const favicon = readFileSync(join(root, 'web', 'favicon.svg'));

const SECURITY_HEADERS = {
  'content-security-policy':
    `default-src 'self'; script-src 'sha256-${scriptHash}'; style-src 'self' 'unsafe-inline'; ` +
    "img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
};

// ---------- helpers ----------

function parseParams(url, req) {
  const sp = url.searchParams;
  const num = (k, lo, hi) => {
    const v = Number.parseFloat(sp.get(k));
    return Number.isFinite(v) && v >= lo && v <= hi ? v : null;
  };
  let lat = num('lat', -90, 90);
  let lon = num('lon', -180, 180);
  if (lat === null || lon === null) lat = lon = null;
  const q = (sp.get('q') || '').trim().slice(0, 100) || null;
  const tz = isValidTz(sp.get('tz')) ? sp.get('tz') : null;
  let lang = sp.get('lang');
  if (lang !== 'hu' && lang !== 'en') {
    lang = /^hu\b/i.test(req.headers['accept-language'] || '') ? 'hu' : 'en';
  }
  return { lat, lon, q, tz, lang };
}

function pickEncoding(req) {
  const ae = req.headers['accept-encoding'] || '';
  return /\bbr\b/.test(ae) ? 'br' : /\bgzip\b/.test(ae) ? 'gzip' : null;
}

function sendJson(res, status, obj, extra = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    ...SECURITY_HEADERS,
    ...extra,
  });
  res.end(body);
}

// ---------- routes ----------

function servePage(req, res, url) {
  const params = parseParams(url, req);
  const hasLocation = params.lat !== null || params.q;
  const enc = pickEncoding(req);
  const baseHeaders = {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-cache',
    vary: 'accept-encoding',
    ...SECURITY_HEADERS,
  };

  let snap = null;
  if (hasLocation) {
    snap = service.snapshot(params);
    if (!snap?.complete) {
      // Warm the caches now, so the browser's stream request joins the in-flight upstream calls.
      bg(service.resolveLocation(params).then((loc) => service.run(loc, params)).catch(() => {}));
    }
  }

  if (!snap) {
    if (req.headers['if-none-match'] === staticEtag) {
      res.writeHead(304, { etag: staticEtag, ...baseHeaders });
      return res.end();
    }
    const body = enc === 'br' ? staticBr : enc === 'gzip' ? staticGz : staticPage;
    res.writeHead(200, {
      ...baseHeaders,
      etag: staticEtag,
      'content-length': body.length,
      ...(enc ? { 'content-encoding': enc } : {}),
    });
    return res.end(req.method === 'HEAD' ? undefined : body);
  }

  const boot = `<script id="boot" type="application/json">${JSON.stringify({ ...snap, q: params.q }).replace(/</g, '\\u003c')}</script>`;
  const html = Buffer.from(pageHead + boot + pageTail);
  const body =
    enc === 'br'
      ? brotliCompressSync(html, { params: { [zc.BROTLI_PARAM_QUALITY]: 5 } })
      : enc === 'gzip'
        ? gzipSync(html, { level: 6 })
        : html;
  res.writeHead(200, {
    ...baseHeaders,
    'cache-control': 'no-store',
    'content-length': body.length,
    ...(enc ? { 'content-encoding': enc } : {}),
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

async function serveForecast(req, res, url) {
  const params = parseParams(url, req);
  if (params.lat === null && !params.q) return sendJson(res, 400, { error: 'lat/lon or q required' });

  res.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-store',
    'x-accel-buffering': 'no',
    ...SECURITY_HEADERS,
  });
  res.flushHeaders();
  let closed = false;
  res.on('close', () => {
    closed = true;
  });
  const emit = (ev) => {
    if (!closed) res.write(`${JSON.stringify(ev)}\n`);
  };

  emit({ type: 'meta', providers: service.providers });
  try {
    const loc = await service.resolveLocation(params);
    await service.run(loc, params, emit);
  } catch (e) {
    emit({ type: 'error', code: e instanceof NotFoundError ? 'not-found' : 'failed', message: e?.message || 'error' });
  }
  emit({ type: 'done' });
  res.end();
}

async function serveGeocode(req, res, url) {
  const { q, lang } = parseParams(url, req);
  if (!q || q.length < 2) return sendJson(res, 200, { results: [] });
  try {
    const results = await geo.search(q, lang);
    sendJson(res, 200, { results }, { 'cache-control': 'public, max-age=86400' });
  } catch {
    sendJson(res, 502, { error: 'geocoding failed' });
  }
}

export function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' });
    return res.end();
  }
  switch (url.pathname) {
    case '/':
      return servePage(req, res, url);
    case '/api/forecast':
      return serveForecast(req, res, url);
    case '/api/geocode':
      return serveGeocode(req, res, url);
    case '/favicon.svg':
    case '/favicon.ico':
      res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=604800' });
      return res.end(favicon);
    case '/healthz':
      return sendJson(res, 200, { ok: true, providers: service.providers });
    default:
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
  }
}
