'use client';

import type {
  PaginatedReviews, Repo, RepoSettings, ReviewWithFindings, Stats, UpdateRepoSettings,
} from '@codereview/shared';
import * as React from 'react';
import { useGetToken } from './auth';

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Human-readable text for an error thrown by the API client. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return `Cannot reach the API at ${API_URL}. Is "pnpm dev" running?`;
    if (err.status === 401) return 'Not authorized. Sign in, or set AUTH_DEV_BYPASS=true in .env for local testing.';
    return err.message;
  }
  return err instanceof Error ? err.message : 'Something went wrong';
}

export function useApi() {
  const getToken = useGetToken();
  return React.useMemo(() => {
    async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
      const token = await getToken();
      let res: Response;
      try {
        res = await fetch(API_URL + path, {
          method,
          headers: {
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch {
        throw new ApiError(0, 'Network error');
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
        const message = Array.isArray(data?.message) ? data.message.join(', ') : data?.message;
        throw new ApiError(res.status, message ?? `Request failed (${res.status})`);
      }
      return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
    }
    return {
      stats: () => request<Stats>('GET', '/api/stats'),
      repos: () => request<Repo[]>('GET', '/api/repos'),
      enableRepo: (id: string, enabled: boolean) => request<Repo>('POST', `/api/repos/${id}/enable`, { enabled }),
      indexRepo: (id: string) => request<Repo>('POST', `/api/repos/${id}/index`),
      settings: (id: string) => request<RepoSettings>('GET', `/api/repos/${id}/settings`),
      updateSettings: (id: string, body: UpdateRepoSettings) =>
        request<RepoSettings>('PUT', `/api/repos/${id}/settings`, body),
      reviews: (repoId: string, page = 1, pageSize = 20) =>
        request<PaginatedReviews>('GET', `/api/repos/${repoId}/reviews?page=${page}&pageSize=${pageSize}`),
      review: (id: string) => request<ReviewWithFindings>('GET', `/api/reviews/${id}`),
      installUrl: () => request<{ url: string }>('GET', '/api/github/install-url'),
      keys: () => request<ApiKey[]>('GET', '/api/keys'),
      createKey: (name: string) => request<ApiKey & { key: string }>('POST', '/api/keys', { name }),
      revokeKey: (id: string) => request<void>('DELETE', `/api/keys/${id}`),
    };
  }, [getToken]);
}
