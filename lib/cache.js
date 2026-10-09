/**
 * In-memory stale-while-revalidate cache with request coalescing and short negative caching.
 */
export class SwrCache {
  constructor({ maxEntries = 5000, background = (p) => p, shared = null } = {}) {
    this.entries = new Map();
    this.inflight = new Map();
    this.errors = new Map();
    this.maxEntries = maxEntries;
    this.background = background;
    this.shared = shared;
    this.reads = new Map();
  }

  peek(key, ttl, maxStale = Infinity) {
    const hit = this.entries.get(key);
    if (!hit || Date.now() - hit.at >= ttl + maxStale) return null;
    return { value: hit.value, fetchedAt: hit.at, fresh: Date.now() - hit.at < ttl };
  }

  async read(key, { ttl, maxStale = 0 }) {
    const local = this.peek(key, ttl, maxStale);
    if (local?.fresh || !this.shared) return local;
    let pending = this.reads.get(key);
    if (!pending) {
      pending = (async () => {
        try {
          const entry = await this.shared.get(key);
          if (entry && Number.isFinite(entry.at) && 'value' in entry) {
            const existing = this.entries.get(key);
            if (!existing || entry.at > existing.at) this.#store(key, entry);
          }
        } catch (error) {
          console.error('Runtime Cache read failed:', key, error);
        }
      })();
      this.reads.set(key, pending);
    }
    try {
      await pending;
      return this.peek(key, ttl, maxStale);
    } finally {
      if (this.reads.get(key) === pending) this.reads.delete(key);
    }
  }

  #store(key, entry) {
    this.entries.delete(key);
    this.entries.set(key, entry);
    if (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value);
  }

  async get(key, { ttl, maxStale = 0, errorTtl = 60_000, fetcher }) {
    await this.read(key, { ttl, maxStale });
    const now = Date.now();
    const hit = this.entries.get(key);
    if (hit && now - hit.at < ttl) return { value: hit.value, fetchedAt: hit.at, stale: false };
    if (hit && now - hit.at < ttl + maxStale) {
      this.background(this.#refresh(key, fetcher, errorTtl, ttl + maxStale).catch((error) => {
        console.error('Background cache refresh failed:', key, error);
      }));
      return { value: hit.value, fetchedAt: hit.at, stale: true };
    }
    const err = this.errors.get(key);
    if (err && now - err.at < errorTtl && !this.inflight.has(key)) throw err.error;
    try {
      const entry = await this.#refresh(key, fetcher, errorTtl, ttl + maxStale);
      return { value: entry.value, fetchedAt: entry.at, stale: false };
    } catch (error) {
      if (hit && now - hit.at < ttl + maxStale) return { value: hit.value, fetchedAt: hit.at, stale: true };
      throw error;
    }
  }

  #refresh(key, fetcher, errorTtl, retention) {
    let p = this.inflight.get(key);
    if (p) return p;
    p = (async () => {
      try {
        const value = await fetcher();
        const entry = { value, at: Date.now() };
        this.#store(key, entry);
        this.errors.delete(key);
        if (this.shared) {
          this.background(this.shared.set(key, entry, { ttl: Math.max(1, Math.ceil(retention / 1000)) })
            .catch((error) => console.error('Runtime Cache write failed:', key, error)));
        }
        return entry;
      } catch (error) {
        if (errorTtl > 0) this.errors.set(key, { error, at: Date.now() });
        if (this.errors.size > this.maxEntries) this.errors.delete(this.errors.keys().next().value);
        throw error;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, p);
    return p;
  }
}
