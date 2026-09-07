export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`config invalid:\n  - ${problems.join("\n  - ")}`);
    this.name = "ConfigError";
  }
}

/** The run is over. Nothing downstream may proceed. */
export class RunAbort extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "RunAbort";
  }
}

export class HashMismatch extends RunAbort {
  constructor(public readonly expected: string, public readonly got: string, public readonly where: string) {
    super(`problem_hash mismatch in ${where}: expected ${expected}, got ${got}. Paraphrase drift. Run invalidated.`, "HASH_MISMATCH");
    this.name = "HashMismatch";
  }
}

/**
 * The command line was wrong, not the repository. These were ConfigErrors, so `adhd learn
 * --agreement` without `--run` printed "config invalid:" at a reader whose config was fine.
 */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export class ContractError extends Error {
  constructor(public readonly where: string, public readonly problems: string[]) {
    super(`${where}: ${problems.join("; ")}`);
    this.name = "ContractError";
  }
}
