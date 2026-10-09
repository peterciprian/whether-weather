/**
 * In-memory stale-while-revalidate cache with request coalescing and short negative caching.
 */
export class SwrCache {
  constructor({ maxEntries = 5000 } = {}) {
    this.entries = new Map();
    this.inflight = new Map();
    this.errors = new Map();
    this.maxEntries = maxEntries;
  }

  peek(key, ttl) {
    const hit = this.entries.get(key);
    if (!hit) return null;
    return { value: hit.value, fetchedAt: hit.at, fresh: Date.now() - hit.at < ttl };
  }

  async get(key, { ttl, maxStale = 0, errorTtl = 60_000, fetcher }) {
    const now = Date.now();
    const hit = this.entries.get(key);
    if (hit && now - hit.at < ttl) return { value: hit.value, fetchedAt: hit.at, stale: false };
    if (hit && now - hit.at < ttl + maxStale) {
      this.#refresh(key, fetcher, errorTtl).catch(() => {});
      return { value: hit.value, fetchedAt: hit.at, stale: true };
    }
    const err = this.errors.get(key);
    if (err && now - err.at < errorTtl && !this.inflight.has(key)) throw err.error;
    try {
      const entry = await this.#refresh(key, fetcher, errorTtl);
      return { value: entry.value, fetchedAt: entry.at, stale: false };
    } catch (error) {
      if (hit) return { value: hit.value, fetchedAt: hit.at, stale: true };
      throw error;
    }
  }

  #refresh(key, fetcher, errorTtl) {
    let p = this.inflight.get(key);
    if (p) return p;
    p = (async () => {
      try {
        const value = await fetcher();
        const entry = { value, at: Date.now() };
        this.entries.delete(key);
        this.entries.set(key, entry);
        this.errors.delete(key);
        if (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value);
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
