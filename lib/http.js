export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function describeStatus(status) {
  if (status === 401 || status === 403) return 'invalid or unauthorized API key';
  if (status === 429) return 'rate limit / quota exceeded';
  if (status === 404) return 'not found';
  return `HTTP ${status}`;
}

export function userAgent() {
  const contact = process.env.CONTACT || 'https://github.com/';
  return `whether-weather/1.0 (${contact})`;
}

/** Fetches JSON; error messages never include the request URL, so API keys cannot leak. */
export async function fetchJson(url, opts = {}) {
  try {
    return await fetchOnce(url, opts);
  } catch (e) {
    // One quick retry for transient upstream failures (5xx / network), never for 4xx or timeouts.
    if (!(e.status >= 500 || e.message === 'network error')) throw e;
    await new Promise((r) => setTimeout(r, 300));
    return fetchOnce(url, opts);
  }
}

async function fetchOnce(url, { timeout = 8000, headers = {} } = {}) {
  let res;
  try {
    res = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': userAgent(), ...headers },
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    throw new Error(e?.name === 'TimeoutError' ? 'timeout' : 'network error');
  }
  if (!res.ok) {
    res.body?.cancel().catch(() => {});
    throw new HttpError(res.status, describeStatus(res.status));
  }
  try {
    return await res.json();
  } catch {
    throw new Error('invalid response');
  }
}
