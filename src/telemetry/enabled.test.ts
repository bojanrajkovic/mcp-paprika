import { describe, expect, it } from "vitest";

import { telemetryEnabled } from "./enabled.js";

describe("telemetryEnabled", () => {
  it("is off with no OTLP endpoint configured", () => {
    expect(telemetryEnabled({})).toBe(false);
  });

  it("turns on when the general OTLP endpoint is set", () => {
    expect(telemetryEnabled({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318" })).toBe(true);
  });

  it("turns on when only a signal-specific endpoint is set", () => {
    expect(telemetryEnabled({ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://collector:4318/v1/traces" })).toBe(true);
    expect(telemetryEnabled({ OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "http://collector:4318/v1/metrics" })).toBe(true);
  });

  it("treats an empty endpoint as unset", () => {
    expect(telemetryEnabled({ OTEL_EXPORTER_OTLP_ENDPOINT: "" })).toBe(false);
  });

  it("OTEL_SDK_DISABLED=true wins over any endpoint", () => {
    expect(telemetryEnabled({ OTEL_SDK_DISABLED: "true", OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318" })).toBe(
      false,
    );
  });

  it("parses the disable flag case-insensitively (the spec requires all case variants of true)", () => {
    for (const value of ["TRUE", "True", "tRuE"]) {
      expect(telemetryEnabled({ OTEL_SDK_DISABLED: value, OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318" })).toBe(
        false,
      );
    }
  });
});
