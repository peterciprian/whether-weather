import { createServer } from 'node:http';
import { handler, service } from './lib/app.js';

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || undefined; // default: dual-stack (IPv4 + IPv6)

createServer(handler).listen(port, host, () => {
  const on = service.providers.filter((p) => p.configured).map((p) => p.id);
  const off = service.providers.filter((p) => !p.configured).map((p) => p.id);
  console.log(`whether-weather: http://localhost:${port}`);
  console.log(`  active providers: ${on.join(', ') || '-'}`);
  if (off.length) console.log(`  missing API key:  ${off.join(', ')}`);
});
