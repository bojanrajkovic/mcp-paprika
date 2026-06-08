import { context, metrics, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  AggregationTemporality,
  type DataPoint,
  type Histogram,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";

/**
 * Shape returned by {@link installTestTelemetry}: the in-memory span exporter,
 * a manual metric collector, and span/datapoint lookup helpers.
 */
export type TestTelemetry = {
  readonly spanExporter: InMemorySpanExporter;
  /** All finished spans with the given name (call after the exercise settles). */
  spansNamed(name: string): ReadonlyArray<ReadableSpan>;
  /** Histogram datapoints for a metric, optionally filtered to an attribute subset. */
  histogramPoints(
    metricName: string,
    attrSubset?: Record<string, unknown>,
  ): Promise<ReadonlyArray<DataPoint<Histogram>>>;
  /** Counter (Sum) datapoints for a metric, optionally filtered to an attribute subset. */
  sumPoints(metricName: string, attrSubset?: Record<string, unknown>): Promise<ReadonlyArray<DataPoint<number>>>;
};

/**
 * Register in-memory global tracer/meter providers plus a real context
 * manager, and return collection helpers.
 *
 * MUST be called at the test file's MODULE SCOPE (not in beforeAll): shared
 * instruments memoize against the global meter provider on FIRST record
 * (`src/telemetry/scope.ts`'s `lazy` — the metrics API has no late-binding
 * proxy), so the provider has to be global before any test exercises a
 * recording seam. Safe per-file because vitest isolates module state per test
 * file; spans are reset via `spanExporter.reset()` in a beforeEach.
 */
export function installTestTelemetry(): TestTelemetry {
  const spanExporter = new InMemorySpanExporter();
  const tracerProvider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spanExporter)] });
  const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    // Effectively never; collection is manual via reader.collect().
    exportIntervalMillis: 3_600_000,
  });
  const meterProvider = new MeterProvider({ readers: [metricReader] });

  trace.setGlobalTracerProvider(tracerProvider);
  metrics.setGlobalMeterProvider(meterProvider);
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());

  return {
    spanExporter,
    spansNamed(name) {
      return spanExporter.getFinishedSpans().filter((span) => span.name === name);
    },
    async histogramPoints(metricName, attrSubset = {}) {
      return collectPoints<Histogram>(metricName, attrSubset);
    },
    async sumPoints(metricName, attrSubset = {}) {
      return collectPoints<number>(metricName, attrSubset);
    },
  };

  async function collectPoints<V>(
    metricName: string,
    attrSubset: Record<string, unknown>,
  ): Promise<ReadonlyArray<DataPoint<V>>> {
    const { resourceMetrics } = await metricReader.collect();
    return resourceMetrics.scopeMetrics
      .flatMap((scope) => scope.metrics)
      .filter((metric) => metric.descriptor.name === metricName)
      .flatMap((metric) => metric.dataPoints as unknown as ReadonlyArray<DataPoint<V>>)
      .filter((point) => Object.entries(attrSubset).every(([key, value]) => point.attributes[key] === value));
  }
}
