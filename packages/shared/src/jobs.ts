/** Payload of a job on the `review` queue. The review row already exists (status = queued). */
export interface ReviewJobData {
  reviewId: string;
  /** Raw diff, only for MCP-triggered reviews. Webhook reviews fetch the diff from GitHub. */
  diff?: string;
  /** Internal reviews (eval runs): no notification, no GitHub posting. */
  silent?: boolean;
}

/** Payload of a job on the `eval` queue: run every case in evals/ and score it. */
export interface EvalJobData {
  runId: string;
}

/** Payload of a job on the `index-repo` queue. */
export interface IndexJobData {
  repoId: string;
  /** Incremental re-index after a push: only these files are re-chunked and re-embedded. */
  paths?: string[];
  /** Incremental re-index: files deleted by the push, whose chunks are dropped. */
  removed?: string[];
}

/** Payload of a job on the `analyze-repo` queue: clone a branch and rebuild its structure graph. */
export interface AnalyzeJobData {
  repoId: string;
  /** Defaults to the repository's default branch. */
  branch?: string;
}

export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 30_000 },
  removeOnComplete: 100,
  removeOnFail: 200,
};

/** Structure analyses are cheap (no AI call) and fail for stable reasons (unknown branch): fewer, quicker retries. */
export const ANALYZE_JOB_OPTIONS = {
  ...DEFAULT_JOB_OPTIONS,
  attempts: 2,
  backoff: { type: 'exponential' as const, delay: 10_000 },
};
