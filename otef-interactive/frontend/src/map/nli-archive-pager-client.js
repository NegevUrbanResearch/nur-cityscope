export function createNliArchivePagerClient({
  fetchImpl = fetch,
  url = "http://127.0.0.1:7733/page",
  timeoutMs = 800,
} = {}) {
  let inFlight = false;

  return {
    async page(direction, requestId) {
      if (inFlight) return;
      inFlight = true;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        await fetchImpl(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ direction, requestId }),
          signal: controller.signal,
        });
      } catch (_error) {
      } finally {
        clearTimeout(timer);
        inFlight = false;
      }
    },
  };
}
