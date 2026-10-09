// Vercel Function entry point: every path is rewritten here (see vercel.json).
import { getCache, waitUntil } from '@vercel/functions';
import { createHash } from 'node:crypto';
import { handler, setBackground, cache } from '../lib/app.js';

cache.shared = getCache({
  namespace: 'whether-weather-v1',
  keyHashFunction: (key) => createHash('sha256').update(key).digest('hex'),
});
setBackground(waitUntil);

export default handler;
