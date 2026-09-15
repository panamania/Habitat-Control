// server/platforms/cache.mjs
//
// Every adapter in this folder hits a real network API instead of reading a
// local file, so we can't let scan.mjs call scanThreads() on its normal
// multi-second poll and expect that to hit AWS/Azure/GCP/K8s live every
// single time — that's a rate-limit problem waiting to happen, and it's
// exactly the "never block the scan" rule the original harnesses/README.md
// warns about, just for a network round-trip instead of a big local file.
//
// This wraps a refresh function in a TTL cache: the caller always gets the
// last good data immediately, and a background refresh fires once the TTL
// has lapsed — never more than one in flight at a time.

export function createPolledCache(refreshFn, { ttlMs = 30_000, label = 'cache' } = {}) {
  let data = [];
  let lastFetchedAt = 0;
  let refreshing = null;

  async function refresh() {
    if (refreshing) return refreshing;
    refreshing = refreshFn()
      .then((next) => {
        data = next;
        lastFetchedAt = Date.now();
        return data;
      })
      .catch((err) => {
        console.error(`[${label}] refresh failed:`, err.message);
        // Keep serving the last good data rather than throwing the whole
        // adapter away because one poll hit a throttle or a blip.
        return data;
      })
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  }

  return {
    // Non-blocking after the first call: returns cached data immediately,
    // fires a background refresh if the TTL has lapsed. The very first
    // call ever has nothing to serve yet, so it awaits the refresh once.
    async get() {
      if (lastFetchedAt === 0) return refresh();
      const stale = Date.now() - lastFetchedAt > ttlMs;
      if (stale) refresh(); // fire and forget
      return data;
    },
  };
}
