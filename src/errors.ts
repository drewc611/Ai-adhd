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

/**
 * The critic said it could not score the pack, rather than returning a malformed one.
 *
 * A refusal used to reach the reader as `critic pass A: scores: Required` — a schema complaint
 * about a critic that was being clear. The two are not the same failure and must not read the
 * same: malformed output is a contract violation to fix, and a refusal is a judgement with a
 * reason attached that somebody should read before rerunning anything.
 *
 * This is the receiving half only. Nothing in `prompts/` tells the critic it may refuse, and
 * that is deliberate: an escape hatch a critic is told about is easier to take than scoring,
 * and the critique phase is where the consensus trap gets caught. Whether to offer one is a
 * change to the product and is backlog 69.
 */
export class CriticRefusal extends RunAbort {
  constructor(public readonly pass: "A" | "B", public readonly reason: string) {
    super(`critic pass ${pass} refused to score: ${reason}`, "CRITIC_REFUSED");
    this.name = "CriticRefusal";
  }
}
