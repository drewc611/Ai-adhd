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

/**
 * The echoed hash is not the one the brief carried. Aborts the run, always.
 *
 * Two different failures reach here and they used to read identically. A branch that echoed a
 * *different* hash paraphrased the problem, which is the drift this check exists for. A branch
 * that echoed *no* hash — an empty artifact, prose, a document of the wrong shape — established
 * nothing about drift at all; it failed the contract, and the reader sent looking for a compiler
 * bug by the word "paraphrase" is being sent the wrong way. `String(got)` flattened both into
 * "got undefined", so the most specific accusation the system can make was also its most common
 * one, which is how a guarantee stops meaning anything.
 *
 * Both still abort. Only the diagnosis changed, and it now says which of the two happened.
 */
export class HashMismatch extends RunAbort {
  public readonly got: string;
  constructor(public readonly expected: string, got: unknown, public readonly where: string) {
    const absent = typeof got !== "string";
    super(
      absent
        ? `problem_hash missing in ${where}: expected ${expected}, the artifact carried ${got === undefined ? "no problem_hash field" : `${typeof got} ${JSON.stringify(got)}`}. ` +
          `Contract failure, not paraphrase drift: nothing here says the problem was restated. Run invalidated.`
        : `problem_hash mismatch in ${where}: expected ${expected}, got ${got}. Paraphrase drift. Run invalidated.`,
      "HASH_MISMATCH",
    );
    this.name = "HashMismatch";
    this.got = String(got);
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
