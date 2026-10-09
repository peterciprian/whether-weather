// Vercel Function entry point: every path is rewritten here (see vercel.json).
import { waitUntil } from '@vercel/functions';
import { handler, setBackground } from '../lib/app.js';

setBackground((p) => {
  try {
    waitUntil(p);
  } catch {
    // outside a request context – nothing to extend
  }
  return p;
});

export default handler;
