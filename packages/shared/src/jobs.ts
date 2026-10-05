/** Payload of a job on the `review` queue. The review row already exists (status = queued). */
export interface ReviewJobData {
  reviewId: string;
  /** Raw diff, only for MCP-triggered reviews. Webhook reviews fetch the diff from GitHub. */
  diff?: string;
}

/** Payload of a job on the `index-repo` queue. */
export interface IndexJobData {
  repoId: string;
  /** Incremental re-index after a push: only these files are re-chunked and re-embedded. */
  paths?: string[];
  /** Incremental re-index: files deleted by the push, whose chunks are dropped. */
  removed?: string[];
}

export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 30_000 },
  removeOnComplete: 100,
  removeOnFail: 200,
};
