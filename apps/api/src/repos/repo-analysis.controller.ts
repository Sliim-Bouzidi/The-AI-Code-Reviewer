import {
  BadRequestException, Body, Controller, Get, Inject, Param, Post, ServiceUnavailableException, UseGuards,
} from '@nestjs/common';
import type { Db } from '@codereview/db';
import { getLlmEnv } from '@codereview/db';
import { createProvidersFromEnv } from '@codereview/llm';
import { AnalyzeRepoUrlBodySchema } from '@codereview/shared';
import type { AnalyzeRepoUrlBody, RepoAnalysisResult } from '@codereview/shared';
import { AuthGuard, CurrentUser } from '../auth/auth.guard.js';
import type { AuthUser } from '../auth/auth.guard.js';
import { DB } from '../common/db.module.js';
import { ZodPipe } from '../common/zod.pipe.js';

@Controller('api/repo-analysis')
@UseGuards(AuthGuard)
export class RepoAnalysisController {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Analyze a GitHub repository by URL and provide an assessment of whether it's a good project.
   * Uses repository metadata (stars, activity, issues) and optionally code quality analysis.
   */
  @Post('analyze-url')
  async analyzeUrl(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(AnalyzeRepoUrlBodySchema)) body: AnalyzeRepoUrlBody,
  ): Promise<RepoAnalysisResult> {
    // Extract owner/repo from GitHub URL
    const match = body.repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) {
      throw new BadRequestException('Invalid GitHub repository URL. Expected format: https://github.com/owner/repo');
    }

    const owner = match[1];
    const repo = match[2].replace(/\.git$/, ''); // Remove .git suffix if present
    const fullName = `${owner}/${repo}`;

    try {
      // Fetch repository metadata from GitHub API
      const repoResponse = await fetch(`https://api.github.com/repos/${fullName}`, {
        headers: {
          'User-Agent': 'AI-Code-Reviewer',
          Accept: 'application/vnd.github+json',
        },
      });

      if (!repoResponse.ok) {
        if (repoResponse.status === 404) {
          throw new BadRequestException('Repository not found');
        }
        throw new ServiceUnavailableException(`GitHub API error: ${repoResponse.status}`);
      }

      const repoData = (await repoResponse.json()) as {
        full_name: string;
        description: string | null;
        stargazers_count: number;
        forks_count: number;
        open_issues_count: number;
        language: string | null;
        created_at: string;
        updated_at: string;
        pushed_at: string;
        size: number;
        archived: boolean;
        disabled: boolean;
        license: { name: string } | null;
        default_branch: string;
      };

      // Fetch recent activity (commits, PRs, issues)
      const [commitsResponse, pullsResponse, issuesResponse] = await Promise.all([
        fetch(`https://api.github.com/repos/${fullName}/commits?per_page=10`, {
          headers: { 'User-Agent': 'AI-Code-Reviewer', Accept: 'application/vnd.github+json' },
        }),
        fetch(`https://api.github.com/repos/${fullName}/pulls?state=all&per_page=10`, {
          headers: { 'User-Agent': 'AI-Code-Reviewer', Accept: 'application/vnd.github+json' },
        }),
        fetch(`https://api.github.com/repos/${fullName}/issues?state=all&per_page=10`, {
          headers: { 'User-Agent': 'AI-Code-Reviewer', Accept: 'application/vnd.github+json' },
        }),
      ]);

      const commits = commitsResponse.ok ? ((await commitsResponse.json()) as { commit: { author: { date: string } } }[]) : [];
      const pulls = pullsResponse.ok ? ((await pullsResponse.json()) as unknown[]) : [];
      const issues = issuesResponse.ok ? ((await issuesResponse.json()) as unknown[]) : [];

      // Calculate activity score based on recent updates
      const now = Date.now();
      const lastPushDate = new Date(repoData.pushed_at).getTime();
      const daysSinceLastPush = Math.floor((now - lastPushDate) / (1000 * 60 * 60 * 24));

      // Use LLM to generate a detailed analysis
      const providers = createProvidersFromEnv(await getLlmEnv(this.db, user.id));
      if (providers.length === 0) {
        throw new ServiceUnavailableException('LLM is not configured. Add an API key in the dashboard.');
      }
      const llm = providers[0];

      const prompt = `Analyze this GitHub repository and provide an assessment of whether it's a good project.

Repository: ${repoData.full_name}
Description: ${repoData.description || 'No description'}
Language: ${repoData.language || 'Unknown'}
Stars: ${repoData.stargazers_count}
Forks: ${repoData.forks_count}
Open Issues: ${repoData.open_issues_count}
License: ${repoData.license?.name || 'None'}
Created: ${repoData.created_at}
Last Updated: ${repoData.updated_at}
Last Push: ${repoData.pushed_at} (${daysSinceLastPush} days ago)
Size: ${repoData.size} KB
Archived: ${repoData.archived}
Disabled: ${repoData.disabled}
Recent Commits: ${commits.length}
Recent Pull Requests: ${pulls.length}
Recent Issues: ${issues.length}

Based on these metrics, provide:
1. An overall quality score (0-100)
2. A brief summary (2-3 sentences) of whether this is a good project
3. Key strengths (list 2-4 points)
4. Potential concerns (list 2-4 points)
5. A recommendation (is this worth using/contributing to?)

Format your response as JSON with this structure:
{
  "score": <number 0-100>,
  "summary": "<string>",
  "strengths": ["<point1>", "<point2>", ...],
  "concerns": ["<point1>", "<point2>", ...],
  "recommendation": "<string>"
}`;

      const llmResponse = await llm.generate(prompt, { temperature: 0.7 });

      // Parse LLM response
      let analysis: {
        score: number;
        summary: string;
        strengths: string[];
        concerns: string[];
        recommendation: string;
      };

      try {
        // Extract JSON from the response (handle markdown code blocks)
        const jsonMatch = llmResponse.match(/```json\s*([\s\S]*?)\s*```/) || llmResponse.match(/\{[\s\S]*\}/);
        const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : llmResponse;
        analysis = JSON.parse(jsonStr);
      } catch (e) {
        // Fallback if LLM doesn't return valid JSON
        analysis = {
          score: 50,
          summary: llmResponse.substring(0, 500),
          strengths: ['Analysis in progress'],
          concerns: ['Unable to parse detailed analysis'],
          recommendation: 'Manual review recommended',
        };
      }

      // Return comprehensive analysis
      return {
        repoUrl: body.repoUrl,
        fullName: repoData.full_name,
        description: repoData.description,
        score: analysis.score,
        summary: analysis.summary,
        strengths: analysis.strengths,
        concerns: analysis.concerns,
        recommendation: analysis.recommendation,
        metadata: {
          stars: repoData.stargazers_count,
          forks: repoData.forks_count,
          openIssues: repoData.open_issues_count,
          language: repoData.language,
          license: repoData.license?.name || null,
          archived: repoData.archived,
          lastPush: repoData.pushed_at,
          daysSinceLastPush,
          recentCommits: commits.length,
          recentPRs: pulls.length,
          recentIssues: issues.length,
        },
      };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ServiceUnavailableException) {
        throw error;
      }
      console.error('Error analyzing repository:', error);
      throw new ServiceUnavailableException('Failed to analyze repository');
    }
  }
}
