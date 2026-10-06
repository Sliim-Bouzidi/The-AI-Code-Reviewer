'use client';

import type {
  EvalRun, LlmSettingsResponse, PaginatedReviews, Repo, RepoSettings, ReviewWithFindings, Stats, TestLlmResponse,
  UpdateLlmSettings, UpdateRepoSettings,
} from '@codereview/shared';
import * as React from 'react';
import { useGetToken } from './auth';

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
/** The MCP server's HTTP endpoint, as AI tools (Cursor, Claude Code) on this machine reach it. */
export const MCP_URL = `${(process.env.NEXT_PUBLIC_MCP_URL ?? 'http://localhost:4100').replace(/\/$/, '')}/mcp`;

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface SetupStatus {
  githubAppConfigured: boolean;
  appSlug: string | null;
  appOwner: string | null; // GitHub account that owns the app: only it can install a private app
  appUrl: string | null;
  appSource: 'dashboard' | 'env' | null;
  webhookUrl: string | null;
  llmConfigured: boolean;
}

export interface ReviewEvent {
  id: string;
  stage: string;
  status: 'running' | 'done' | 'skipped' | 'failed';
  detail: string | null;
  durationMs: number | null;
  createdAt: string;
}

export interface ModelInfo {
  id: string;
  label?: string;
  free?: boolean;
}

export interface AppNotification {
  id: string;
  kind: 'review_completed' | 'review_failed' | 'index_ready' | 'index_failed' | 'eval_completed' | 'eval_failed';
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
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
    if (err.status === 401) return 'Not authorized. Your session may have expired: sign in again.';
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
      notifications: () => request<{ items: AppNotification[]; unread: number }>('GET', '/api/notifications'),
      readNotification: (id: string) => request<void>('POST', `/api/notifications/${id}/read`),
      readAllNotifications: () => request<void>('POST', '/api/notifications/read-all'),
      llmSettings: () => request<LlmSettingsResponse>('GET', '/api/settings/llm'),
      updateLlmSettings: (body: UpdateLlmSettings) => request<LlmSettingsResponse>('PUT', '/api/settings/llm', body),
      evals: () => request<EvalRun[]>('GET', '/api/evals'),
      startEval: () => request<EvalRun>('POST', '/api/evals'),
      llmModels: (provider: string, kind: 'chat' | 'embedding' = 'chat') =>
        request<{ models: ModelInfo[] }>('GET', `/api/settings/llm/models?provider=${provider}&kind=${kind}`),
      testLlm: (slot: 'primary' | 'fallback' | 'embeddings') =>
        request<TestLlmResponse>('POST', '/api/settings/llm/test', { slot }),
      setupStatus: () => request<SetupStatus>('GET', '/api/setup/status'),
      githubConnection: () =>
        request<{ connected: boolean; accounts: string[]; repoCount: number }>('GET', '/api/github/connection'),
      resetGithubApp: () => request<{ removedInstallations: number }>('DELETE', '/api/setup/github-app'),
      githubAppManifest: () =>
        request<{ postUrl: string; manifest: Record<string, unknown> }>('POST', '/api/setup/github-app'),
      reviewEvents: (id: string) =>
        request<{ status: string; items: ReviewEvent[] }>('GET', `/api/reviews/${id}/events`),
      keys: () => request<ApiKey[]>('GET', '/api/keys'),
      createKey: (name: string) => request<ApiKey & { key: string }>('POST', '/api/keys', { name }),
      revokeKey: (id: string) => request<void>('DELETE', `/api/keys/${id}`),
    };
  }, [getToken]);
}
