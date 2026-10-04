import type {
  Finding, Repo, ReviewStatusResponse, ReviewWithFindings, RulesResponse, SearchResult,
} from '@codereview/shared';

/** The MCP server's only dependency: the Core API. No database or GitHub access from here. */
export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 300);
      throw new Error(`codereview API ${method} ${path} failed: ${res.status} ${text}`);
    }
    return res.json() as Promise<T>;
  }

  listRepos = () => this.request<Repo[]>('GET', '/api/repos');

  /** Tools take "owner/name"; the API takes ids. */
  async resolveRepo(fullName: string): Promise<Repo> {
    const repos = await this.listRepos();
    const repo = repos.find((r) => r.fullName.toLowerCase() === fullName.toLowerCase());
    if (!repo) {
      throw new Error(`Repo "${fullName}" is not connected. Connected repos: ${repos.map((r) => r.fullName).join(', ') || 'none'}`);
    }
    return repo;
  }

  startDiffReview = (diff: string, repo?: string) =>
    this.request<{ reviewId: string }>('POST', '/api/reviews/diff', { diff, repo });
  reviewStatus = (id: string) => this.request<ReviewStatusResponse>('GET', `/api/reviews/${id}/status`);
  review = (id: string) => this.request<ReviewWithFindings>('GET', `/api/reviews/${id}`);
  finding = (id: string) => this.request<Finding>('GET', `/api/findings/${id}`);
  prFindings = (repoId: string, pr: number) =>
    this.request<{ reviewId: string; summary: string | null; headSha: string | null; findings: Finding[] }>(
      'GET', `/api/repos/${repoId}/prs/${pr}/findings`);
  search = (repoId: string, query: string, limit: number) =>
    this.request<SearchResult[]>('POST', `/api/repos/${repoId}/search`, { query, limit });
  rules = (repoId: string) => this.request<RulesResponse>('GET', `/api/repos/${repoId}/rules`);
}
