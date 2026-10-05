/** BullMQ queue names, shared by the API (producer) and the worker (consumer). */
export const QUEUES = { REVIEW: 'review', INDEX: 'index-repo' } as const;

export const API_KEY_PREFIX = 'crk_';

/**
 * Redis Pub/Sub channels for real-time updates. The worker publishes, the API's SSE endpoints
 * subscribe and forward to the browser. Per-user / per-review channels keep fan-out targeted.
 */
export const CHANNELS = {
  user: (userId: string) => `notify:user:${userId}`,
  review: (reviewId: string) => `review:${reviewId}`,
} as const;

/** What travels on those channels (JSON). The database stays the source of truth. */
export type RealtimeEvent =
  | { type: 'notification'; id: string; kind: string; title: string; body: string | null; link: string | null }
  | { type: 'review'; reviewId: string; stage?: string; status?: string };

export const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'] as const;
