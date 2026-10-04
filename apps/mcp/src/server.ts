import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Finding } from '@codereview/shared';
import type { ApiClient } from './api-client.js';

const REVIEW_TIMEOUT_MS = 120_000;
const POLL_MS = 2_000;

const text = (value: unknown) => ({
  content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
});
const failure = (err: unknown) => ({ ...text(`Error: ${(err as Error).message}`), isError: true });

/** Compact shape for the agent: enough to locate and fix, nothing more. */
const compact = (f: Finding) => ({
  id: f.id,
  file: f.filePath,
  line: f.lineEnd ? `${f.lineStart}-${f.lineEnd}` : String(f.lineStart),
  severity: f.severity,
  category: f.category,
  message: f.message,
  suggestion: f.suggestion,
});

const userPrompt = (body: string) => ({ messages: [{ role: 'user' as const, content: { type: 'text' as const, text: body } }] });

export function buildServer(api: ApiClient): McpServer {
  const server = new McpServer({ name: 'codereview', version: '0.1.0' });

  // ------------------------------------------------------------------ tools
  server.registerTool(
    'review_diff',
    {
      description:
        'Run an AI code review on a raw unified git diff (e.g. the output of `git diff` for local uncommitted or branch changes). ' +
        'Returns findings with file, line, severity, message and suggested fix. Pass `repo` ("owner/name") when the diff belongs to a ' +
        'connected repo so the review can use codebase context and that repo\'s rules. Takes up to 2 minutes.',
      inputSchema: { diff: z.string().min(1), repo: z.string().optional() },
    },
    async ({ diff, repo }) => {
      try {
        const { reviewId } = await api.startDiffReview(diff, repo);
        const deadline = Date.now() + REVIEW_TIMEOUT_MS;
        while (Date.now() < deadline) {
          const { status, error } = await api.reviewStatus(reviewId);
          if (status === 'completed') {
            const review = await api.review(reviewId);
            return text({ reviewId, summary: review.summary, findings: review.findings.map(compact) });
          }
          if (status === 'failed') return failure(new Error(`review failed: ${error ?? 'unknown error'}`));
          await new Promise((r) => setTimeout(r, POLL_MS));
        }
        return failure(new Error(`review ${reviewId} is still running after ${REVIEW_TIMEOUT_MS / 1000}s; try again shortly`));
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.registerTool(
    'get_pr_review',
    {
      description:
        'Get the AI review findings already produced for a GitHub pull request, so they can be listed or fixed. ' +
        '`repo` is "owner/name" of a connected repo.',
      inputSchema: { repo: z.string(), pr_number: z.number().int().positive() },
    },
    async ({ repo, pr_number }) => {
      try {
        const r = await api.resolveRepo(repo);
        const res = await api.prFindings(r.id, pr_number);
        return text({ reviewId: res.reviewId, summary: res.summary, headSha: res.headSha, findings: res.findings.map(compact) });
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.registerTool(
    'search_codebase',
    {
      description:
        'Semantic (meaning-based) search over an indexed repo. Use it to find where something is implemented or how a ' +
        'function is used elsewhere. Returns matching code chunks with file path and line range.',
      inputSchema: { repo: z.string(), query: z.string().min(1), limit: z.number().int().min(1).max(25).optional() },
    },
    async ({ repo, query, limit }) => {
      try {
        const r = await api.resolveRepo(repo);
        const results = await api.search(r.id, query, limit ?? 8);
        return text(
          results.map((c) => ({
            file: c.filePath,
            lines: `${c.startLine ?? '?'}-${c.endLine ?? '?'}`,
            symbol: c.symbol,
            score: Number(c.score.toFixed(3)),
            code: c.content.length > 1500 ? `${c.content.slice(0, 1500)}\n...` : c.content,
          })),
        );
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.registerTool(
    'get_review_rules',
    {
      description: 'Get the review rules configured for a repo (strictness, custom rules, ignored paths). Follow them when writing code for that repo.',
      inputSchema: { repo: z.string() },
    },
    async ({ repo }) => {
      try {
        return text(await api.rules((await api.resolveRepo(repo)).id));
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.registerTool(
    'explain_finding',
    {
      description: 'Get the full detail of one review finding by id (from review_diff or get_pr_review): location, message and suggested fix.',
      inputSchema: { finding_id: z.string() },
    },
    async ({ finding_id }) => {
      try {
        const f = await api.finding(finding_id);
        return text({ ...compact(f), source: f.source, confidence: f.confidence });
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.registerTool(
    'list_repos',
    { description: 'List the repos connected to codereview ("owner/name"), with whether reviews are enabled and the index status.', inputSchema: {} },
    async () => {
      try {
        const repos = await api.listRepos();
        return text(repos.map((r) => ({ repo: r.fullName, enabled: r.enabled, indexStatus: r.indexStatus })));
      } catch (err) {
        return failure(err);
      }
    },
  );

  // ------------------------------------------------- prompts = slash commands
  server.registerPrompt(
    'review',
    { description: 'Review my local changes (staged + unstaged) before I push' },
    () =>
      userPrompt(
        'Review my local changes with the codereview tools:\n' +
          '1. Run `git diff HEAD` to get staged and unstaged changes. If it is empty, say so and stop.\n' +
          '2. Run `git remote get-url origin` to work out the repo as "owner/name".\n' +
          '3. Call the `review_diff` tool with the diff and that repo (omit `repo` if list_repos does not include it).\n' +
          '4. Summarize the findings grouped by severity (critical first) with file:line, the problem and the suggested fix.\n' +
          'Do not change any files.',
      ),
  );

  server.registerPrompt(
    'review_pr',
    { description: 'Show the AI review findings for a pull request', argsSchema: { pr_number: z.string() } },
    ({ pr_number }) =>
      userPrompt(
        `Work out this repo's "owner/name" from \`git remote get-url origin\`, then call \`get_pr_review\` for PR #${pr_number}. ` +
          'List the findings grouped by severity with file:line, the problem and the suggested fix. Do not change any files.',
      ),
  );

  server.registerPrompt(
    'fix_findings',
    { description: 'Fix the AI review findings of a pull request in the working tree', argsSchema: { pr_number: z.string() } },
    ({ pr_number }) =>
      userPrompt(
        `Work out this repo's "owner/name" from \`git remote get-url origin\`, then call \`get_pr_review\` for PR #${pr_number}.\n` +
          'Fix the findings in the working tree one at a time, most severe first. For each: read the code, check the finding is ' +
          'real (skip it and say why if it is not), apply the smallest correct fix. Finish by showing `git diff` and a list of ' +
          'what was fixed and what was skipped. Do not commit.',
      ),
  );

  server.registerPrompt(
    'search',
    { description: 'Semantic search over the indexed codebase', argsSchema: { query: z.string() } },
    ({ query }) =>
      userPrompt(
        `Work out this repo's "owner/name" from \`git remote get-url origin\`, call \`search_codebase\` with the query ` +
          `${JSON.stringify(query)}, and explain what the results show and where the relevant code lives.`,
      ),
  );

  return server;
}
