import { createProjectionConfigClient } from "./projection-config-client.js";

export function createNliFontSubscription({ socket, sourceId, fetchImpl, onChoices = () => {}, onError = () => {} } = {}) {
  const client = createProjectionConfigClient({ socket, sourceId, fetchImpl });
  let disposed = false;
  let lastChoicesKey = null;
  let lastErrorKey = null;
  const reportError = error => {
    if (disposed) return;
    const errorKey = String(error?.message || error);
    if (errorKey === lastErrorKey) return;
    lastErrorKey = errorKey;
    onError(error);
  };

  const unsubscribe = client.subscribe(state => {
    if (disposed) return;
    if (state.hydrationError) reportError(state.hydrationError);
    const published = state.snapshot?.config?.nliFonts;
    if (!published || typeof published.he !== "string" || typeof published.en !== "string") return;
    lastErrorKey = null;
    const choices = { he: published.he, en: published.en };
    const choicesKey = `${choices.he}\u0000${choices.en}`;
    if (choicesKey === lastChoicesKey) return;
    lastChoicesKey = choicesKey;
    onChoices(choices);
  });

  return {
    start() {
      if (disposed) return Promise.resolve(client.getState());
      return client.start().catch(error => {
        reportError(error);
        throw error;
      });
    },
    stop() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      client.stop();
    },
  };
}
