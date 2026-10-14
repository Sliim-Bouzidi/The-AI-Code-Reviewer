'use client';

import type { RepoAnalysisResult } from '@codereview/shared';
import {
  IconArrowRight,
  IconBrandGithub,
  IconCircleCheck,
  IconCircleX,
  IconSearch,
  IconSparkles,
} from '@tabler/icons-react';
import { useState } from 'react';
import { toast } from 'sonner';
import PageContainer from '@/components/layout/page-container';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { errorMessage, useApi } from '@/lib/api';

function ScoreRing({ score }: { score: number }) {
  const color = score >= 75 ? 'text-emerald-500' : score >= 50 ? 'text-yellow-500' : 'text-red-500';
  const label = score >= 75 ? 'Good' : score >= 50 ? 'Average' : 'Poor';
  return (
    <div className='flex flex-col items-center gap-1'>
      <div className={`text-5xl font-bold tabular-nums ${color}`}>{score}</div>
      <div className='text-xs text-muted-foreground'>/100</div>
      <Badge
        variant={score >= 75 ? 'default' : 'secondary'}
        className={score >= 75 ? 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30' : score >= 50 ? 'bg-yellow-500/15 text-yellow-600 border-yellow-500/30' : 'bg-red-500/15 text-red-600 border-red-500/30'}
      >
        {label}
      </Badge>
    </div>
  );
}

function MetaStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className='flex flex-col gap-0.5'>
      <span className='text-xs text-muted-foreground'>{label}</span>
      <span className='text-sm font-medium tabular-nums'>{value}</span>
    </div>
  );
}

function AnalysisResult({ result }: { result: RepoAnalysisResult }) {
  const { metadata: m } = result;
  return (
    <div className='flex flex-col gap-4'>
      {/* Header card */}
      <Card>
        <CardContent className='pt-6'>
          <div className='flex flex-col sm:flex-row gap-6 items-start'>
            {/* Score */}
            <div className='shrink-0 flex flex-col items-center gap-2 px-4'>
              <ScoreRing score={result.score} />
            </div>

            {/* Info */}
            <div className='flex flex-col gap-3 flex-1 min-w-0'>
              <div className='flex items-center gap-2 flex-wrap'>
                <IconBrandGithub className='size-5 shrink-0' />
                <span className='font-semibold text-lg leading-tight'>{result.fullName}</span>
                {m.archived && <Badge variant='secondary'>Archived</Badge>}
                {m.language && <Badge variant='outline'>{m.language}</Badge>}
                {m.license && <Badge variant='outline'>{m.license}</Badge>}
              </div>
              {result.description && (
                <p className='text-sm text-muted-foreground'>{result.description}</p>
              )}
              {/* Stats row */}
              <div className='grid grid-cols-3 sm:grid-cols-6 gap-4 pt-1'>
                <MetaStat label='⭐ Stars' value={m.stars.toLocaleString()} />
                <MetaStat label='🍴 Forks' value={m.forks.toLocaleString()} />
                <MetaStat label='🐛 Issues' value={m.openIssues.toLocaleString()} />
                <MetaStat label='Last push' value={`${m.daysSinceLastPush}d ago`} />
                <MetaStat label='Commits' value={m.recentCommits} />
                <MetaStat label='Recent PRs' value={m.recentPRs} />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary */}
      <Card>
        <CardHeader className='pb-2'>
          <CardTitle className='text-base flex items-center gap-2'>
            <IconSparkles className='size-4 text-primary' />
            AI Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className='text-sm leading-relaxed'>{result.summary}</p>
        </CardContent>
      </Card>

      {/* Strengths & Concerns */}
      <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
        <Card>
          <CardHeader className='pb-2'>
            <CardTitle className='text-base flex items-center gap-2 text-emerald-600'>
              <IconCircleCheck className='size-4' />
              Strengths
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className='flex flex-col gap-2'>
              {result.strengths.map((s, i) => (
                <li key={i} className='flex items-start gap-2 text-sm'>
                  <span className='text-emerald-500 mt-0.5 shrink-0'>✓</span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className='pb-2'>
            <CardTitle className='text-base flex items-center gap-2 text-yellow-600'>
              <IconCircleX className='size-4' />
              Concerns
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className='flex flex-col gap-2'>
              {result.concerns.map((c, i) => (
                <li key={i} className='flex items-start gap-2 text-sm'>
                  <span className='text-yellow-500 mt-0.5 shrink-0'>⚠</span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* Recommendation */}
      <Card className='border-primary/30 bg-primary/5'>
        <CardHeader className='pb-2'>
          <CardTitle className='text-base'>💡 Recommendation</CardTitle>
        </CardHeader>
        <CardContent>
          <p className='text-sm leading-relaxed'>{result.recommendation}</p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function RepoAnalyzerPage() {
  const api = useApi();
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RepoAnalysisResult | null>(null);

  async function handleAnalyze() {
    const trimmed = url.trim();
    if (!trimmed) return;
    if (!trimmed.includes('github.com')) {
      toast.error('Please enter a valid GitHub repository URL');
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const data = await api.analyzeRepo({ repoUrl: trimmed });
      setResult(data);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageContainer
      title='Repo Analyzer'
      description='Paste any public GitHub repository URL to get an AI-powered quality assessment.'
    >
      {/* Input row */}
      <Card>
        <CardContent className='pt-6'>
          <div className='flex gap-2'>
            <div className='relative flex-1'>
              <IconBrandGithub className='absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground' />
              <Input
                className='pl-9'
                placeholder='https://github.com/owner/repository'
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !loading && handleAnalyze()}
                disabled={loading}
              />
            </div>
            <Button onClick={handleAnalyze} disabled={loading || !url.trim()}>
              {loading ? (
                <Spinner className='size-4' />
              ) : (
                <IconSearch className='size-4' />
              )}
              {loading ? 'Analyzing…' : 'Analyze'}
              {!loading && <IconArrowRight className='size-4' />}
            </Button>
          </div>
          <p className='text-xs text-muted-foreground mt-2'>
            Works with any public GitHub repository. Analysis uses your configured AI provider.
          </p>
        </CardContent>
      </Card>

      {/* Loading state */}
      {loading && (
        <Card>
          <CardContent className='pt-6'>
            <div className='flex flex-col items-center gap-3 py-8 text-center'>
              <Spinner className='size-8' />
              <div>
                <p className='font-medium'>Analyzing repository…</p>
                <p className='text-sm text-muted-foreground mt-1'>
                  Fetching GitHub data and running AI analysis. This may take a few seconds.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Result */}
      {result && !loading && <AnalysisResult result={result} />}

      {/* Empty state */}
      {!result && !loading && (
        <Card className='border-dashed'>
          <CardContent className='pt-6'>
            <div className='flex flex-col items-center gap-2 py-10 text-center text-muted-foreground'>
              <IconSearch className='size-10 opacity-30' />
              <p className='font-medium'>No analysis yet</p>
              <p className='text-sm'>Enter a GitHub URL above and click Analyze to get started.</p>
            </div>
          </CardContent>
        </Card>
      )}
    </PageContainer>
  );
}
