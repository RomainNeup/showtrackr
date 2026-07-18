/**
 * Minimal structured logger for the importer.
 *
 * Emits one JSON-ish line per event with a stable prefix so the output can be
 * grepped per step (`[step:3]`) or per level (`[warn]`). Kept dependency-free.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

let threshold: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  threshold = level;
}

function emit(level: LogLevel, step: string | number | null, msg: string, extra?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[threshold]) return;
  const stepTag = step === null ? "" : ` [step:${step}]`;
  const suffix = extra && Object.keys(extra).length > 0 ? " " + JSON.stringify(extra) : "";
  const line = `[${level}]${stepTag} ${msg}${suffix}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/**
 * A logger scoped to a pipeline step. All lines are tagged `[step:N]`.
 */
export class StepLogger {
  constructor(private readonly step: string | number) {}

  debug(msg: string, extra?: Record<string, unknown>) {
    emit("debug", this.step, msg, extra);
  }
  info(msg: string, extra?: Record<string, unknown>) {
    emit("info", this.step, msg, extra);
  }
  warn(msg: string, extra?: Record<string, unknown>) {
    emit("warn", this.step, msg, extra);
  }
  error(msg: string, extra?: Record<string, unknown>) {
    emit("error", this.step, msg, extra);
  }

  /** Log the start of the step and return a function to log its completion with a duration. */
  begin(title: string): () => void {
    this.info(`▶ ${title}`);
    // Date.now is intentionally avoided in workflow scripts, but this is a plain CLI — timing is fine here.
    const start = Date.now();
    return () => {
      const ms = Date.now() - start;
      this.info(`✔ ${title} (${ms} ms)`);
    };
  }
}

export const log = {
  debug: (msg: string, extra?: Record<string, unknown>) => emit("debug", null, msg, extra),
  info: (msg: string, extra?: Record<string, unknown>) => emit("info", null, msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) => emit("warn", null, msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) => emit("error", null, msg, extra),
};
