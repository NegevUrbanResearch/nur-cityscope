const MAX_SAMPLES_PER_METRIC = 200;
const metricSamples = new Map();

function record(metricName, value) {
  if (!metricName || typeof value !== "number" || Number.isNaN(value)) return;
  const samples = metricSamples.get(metricName) || [];
  samples.push(value);
  if (samples.length > MAX_SAMPLES_PER_METRIC) {
    samples.splice(0, samples.length - MAX_SAMPLES_PER_METRIC);
  }
  metricSamples.set(metricName, samples);
}

function percentile(sortedValues, p) {
  if (!sortedValues.length) return null;
  const index = Math.max(
    0,
    Math.min(
      sortedValues.length - 1,
      Math.ceil((p / 100) * sortedValues.length) - 1
    )
  );
  return sortedValues[index];
}

function summary() {
  const output = {};
  for (const [metricName, samples] of metricSamples.entries()) {
    const sorted = [...samples].sort((a, b) => a - b);
    output[metricName] = {
      count: samples.length,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      max: sorted.length ? sorted[sorted.length - 1] : null,
    };
  }
  return output;
}

function reset() {
  metricSamples.clear();
}

if (typeof window !== "undefined") {
  window.MapPerfTelemetry = { record, summary, reset };
}

export { record, summary, reset };
