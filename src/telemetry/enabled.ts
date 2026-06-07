/**
 * Whether the OpenTelemetry SDK should start at all. Telemetry is opt-in by
 * configuring an OTLP destination — the standard `OTEL_EXPORTER_OTLP_ENDPOINT`
 * (or a signal-specific override) — and `OTEL_SDK_DISABLED=true` wins over any
 * endpoint. With no endpoint the bootstrap never even imports the SDK, so a
 * non-observing deployment pays one env read; every recording site then talks
 * to the `@opentelemetry/api` no-op singletons.
 */
export function telemetryEnabled(env: NodeJS.ProcessEnv): boolean {
  if (env["OTEL_SDK_DISABLED"]?.toLowerCase() === "true") return false;
  return [
    env["OTEL_EXPORTER_OTLP_ENDPOINT"],
    env["OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"],
    env["OTEL_EXPORTER_OTLP_METRICS_ENDPOINT"],
  ].some((value) => value !== undefined && value !== "");
}
