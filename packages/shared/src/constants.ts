/** BullMQ queue names, shared by the API (producer) and the worker (consumer). */
export const QUEUES = { REVIEW: 'review', INDEX: 'index-repo' } as const;

export const API_KEY_PREFIX = 'crk_';

export const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'] as const;
