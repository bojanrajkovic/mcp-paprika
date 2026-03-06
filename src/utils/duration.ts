import { Duration } from "luxon";
import { ok, err, type Result } from "neverthrow";
import parseDurationLib from "parse-duration";

export class DurationParseError extends Error {
  readonly input: string | number;
  readonly reason: string;

  private constructor(input: string | number, reason: string) {
    super(`Invalid duration ${JSON.stringify(input)}: ${reason}`);
    this.name = "DurationParseError";
    this.input = input;
    this.reason = reason;
  }

  static fromInput(input: string | number, reason: string): DurationParseError {
    return new DurationParseError(input, reason);
  }
}

type Parser = (input: string) => Result<Duration, DurationParseError> | null;

function numericParser(input: string): Result<Duration, DurationParseError> | null {
  if (!/^\d+(\.\d+)?$/.test(input)) {
    return null;
  }
  const minutes = Number(input);
  return ok(Duration.fromObject({ minutes }));
}

function colonParser(input: string): Result<Duration, DurationParseError> | null {
  const match = /^(\d+):(\d{1,2})$/.exec(input);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes >= 60) {
    return err(DurationParseError.fromInput(input, "minutes must be less than 60"));
  }
  return ok(Duration.fromObject({ hours, minutes }));
}

function humanAndIsoParser(input: string): Result<Duration, DurationParseError> | null {
  const ms = parseDurationLib(input);
  if (ms === null || ms === undefined) {
    return null;
  }
  if (ms < 0) {
    return err(DurationParseError.fromInput(input, "negative duration"));
  }
  return ok(Duration.fromMillis(ms));
}

export function parseDuration(input: string | number): Result<Duration, DurationParseError> {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) {
      return err(DurationParseError.fromInput(input, "input must be a finite number"));
    }
    if (input < 0) {
      return err(DurationParseError.fromInput(input, "negative duration"));
    }
    return ok(Duration.fromObject({ minutes: input }));
  }

  const trimmed = input.trim();
  if (trimmed === "") {
    return err(DurationParseError.fromInput(input, "empty input"));
  }

  const parsers: ReadonlyArray<Parser> = [numericParser, colonParser, humanAndIsoParser];

  for (const parser of parsers) {
    const result = parser(trimmed);
    if (result !== null) {
      return result;
    }
  }

  return err(DurationParseError.fromInput(input, "unrecognized duration format"));
}

export function formatDuration(duration: Duration): string {
  if (!duration.isValid) {
    return "";
  }

  const totalMinutes = Math.round(duration.as("minutes"));

  if (totalMinutes <= 0) {
    return "";
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0 && minutes > 0) {
    return `${String(hours)} hr ${String(minutes)} min`;
  }
  if (hours > 0) {
    return `${String(hours)} hr`;
  }
  return `${String(minutes)} min`;
}
