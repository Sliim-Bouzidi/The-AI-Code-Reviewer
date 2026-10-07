'use client';

import type { EvalRun } from '@codereview/shared';
import { IconArrowDownRight, IconArrowUpRight, IconCheck, IconPlayerPlay, IconX } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import * as React from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import PageContainer from '@/components/layout/page-container';
import { LoadError, RowsSkeleton } from '@/components/query-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import type { ChartConfig } from '@/components/ui/chart';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { errorMessage, useApi } from '@/lib/api';
import { formatDuration, timeAgo } from '@/lib/utils';

/*
 * Colour roles (validated with the dataviz palette checker, light and dark):
 *   --q-1  recall / found       (categorical slot 1, blue)
 *   --q-2  precision / missed   (categorical slot 2, orange)
 *   --q-0  neutral "extra"      (gray, not a series hue)
 * The same meaning keeps the same colour on every chart.
 */
const VIZ_STYLE = `
.quality-viz { --q-1:#2a78d6; --q-2:#eb6834; --q-0:#c3c2b7; }
.dark .quality-viz { --q-1:#3987e5; --q-2:#d95926; --q-0:#52514e; }
`;

const pct = (v: number | null | undefined) => (v === null || v === undefined ? '–' : `${Math.round(v * 100)}%`);
const shortModel = (m: string | null) => (m ? (m.split('/').pop() ?? m) : 'unknown');
const caseLabel = (name: string) => name.replace(/-/g, ' ');

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className='flex flex-wrap items-center gap-4 text-xs'>
      {items.map((i) => (
        <span key={i.label} className='text-muted-foreground flex items-center gap-1.5'>
          <span className='size-2.5 rounded-sm' style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/** Headline number with the change since the previous completed run. */
function StatCard({
  label, value, hint, delta, lowerIsBetter = false, format = (d: number) => `${d > 0 ? '+' : ''}${d}`,
}: {
  label: string;
  value: string;
  hint: string;
  delta: number | null;
  lowerIsBetter?: boolean;
  format?: (d: number) => string;
}) {
  const good = delta !== null && delta !== 0 && (lowerIsBetter ? delta < 0 : delta > 0);
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className='text-3xl font-semibold tabular-nums'>{value}</CardTitle>
      </CardHeader>
      <CardContent className='text-muted-foreground flex items-center gap-2 text-xs'>
        {delta !== null && delta !== 0 && (
          <span className={`flex items-center font-medium ${good ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>
            {delta > 0 ? <IconArrowUpRight className='size-3.5' /> : <IconArrowDownRight className='size-3.5' />}
            {format(delta)}
          </span>
        )}
        <span>{hint}</span>
      </CardContent>
    </Card>
  );
}

export default function QualityPage() {
  const api = useApi();
  const qc = useQueryClient();
  const runs = useQuery({
    queryKey: ['evals'],
    queryFn: api.evals,
    refetchInterval: (q) => (q.state.data?.some((r) => r.status === 'queued' || r.status === 'running') ? 3_000 : false),
  });
  const start = useMutation({
    mutationFn: api.startEval,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['evals'] });
      toast.success('Eval run started. You get a notification when it finishes.');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const all = runs.data ?? [];
  const active = all.find((r) => r.status === 'queued' || r.status === 'running');
  const done = all.filter((r) => r.status === 'completed'); // newest first
  const latest = done[0];
  const previous = done[1];
  const avgCase = latest && latest.durationMs && latest.cases.length ? latest.durationMs / latest.cases.length : null;
  const prevAvgCase = previous && previous.durationMs && previous.cases.length ? previous.durationMs / previous.cases.length : null;
  const points = (a: number | null | undefined, b: number | null | undefined) =>
    a === null || a === undefined || b === null || b === undefined ? null : Math.round((a - b) * 100);

  // ---- chart data
  const trend = [...done].reverse().map((r, i) => ({
    run: `#${i + 1}`,
    when: new Date(r.createdAt).toLocaleString(),
    model: shortModel(r.model),
    recall: r.recall === null ? null : Math.round(r.recall * 100),
    precision: r.precision === null ? null : Math.round(r.precision * 100),
  }));
  const byModel = Object.values(
    done.reduce<Record<string, { model: string; caught: number; expected: number; onTarget: number; findings: number; runs: number }>>(
      (acc, r) => {
        const key = shortModel(r.model);
        const m = (acc[key] ??= { model: key, caught: 0, expected: 0, onTarget: 0, findings: 0, runs: 0 });
        m.caught += r.caught;
        m.expected += r.expected;
        m.onTarget += r.onTarget;
        m.findings += r.findings;
        m.runs += 1;
        return acc;
      },
      {},
    ),
  ).map((m) => ({
    model: m.model,
    runs: m.runs,
    recall: m.expected ? Math.round((m.caught / m.expected) * 100) : 0,
    precision: m.findings ? Math.round((m.onTarget / m.findings) * 100) : 0,
  }));
  const perCase = (latest?.cases ?? [])
    .filter((c) => c.expected > 0)
    .map((c) => ({ case: caseLabel(c.caseName), found: c.caught, missed: c.expected - c.caught }));
  const donut = latest
    ? [
        { name: 'onTarget', label: 'Hit a planted bug', value: latest.onTarget, fill: 'var(--q-1)' },
        { name: 'extra', label: 'Extra findings', value: Math.max(0, latest.findings - latest.onTarget), fill: 'var(--q-0)' },
      ]
    : [];

  const scoreConfig = {
    recall: { label: 'Recall', color: 'var(--q-1)' },
    precision: { label: 'Precision', color: 'var(--q-2)' },
  } satisfies ChartConfig;
  const caseConfig = {
    found: { label: 'Found', color: 'var(--q-1)' },
    missed: { label: 'Missed', color: 'var(--q-2)' },
  } satisfies ChartConfig;
  const donutConfig = {
    onTarget: { label: 'Hit a planted bug', color: 'var(--q-1)' },
    extra: { label: 'Extra findings', color: 'var(--q-0)' },
  } satisfies ChartConfig;

  return (
    <PageContainer
      title='Quality'
      description='How good is your AI setup at reviewing code? A run sends a fixed set of built-in sample changes (not your repositories: code with planted bugs, plus one correct change) through the reviewer with your own AI keys and models, and scores how many bugs it catches. Each run uses some of your AI quota; results are visible only to you.'
      action={
        <Button onClick={() => start.mutate()} disabled={!!active || start.isPending}>
          {active || start.isPending ? <Spinner className='size-4' /> : <IconPlayerPlay />}
          {active ? 'Running…' : 'Run evals'}
        </Button>
      }
    >
      <style>{VIZ_STYLE}</style>
      {runs.isError ? (
        <LoadError error={runs.error} />
      ) : runs.isPending ? (
        <RowsSkeleton />
      ) : (
        <div className='quality-viz flex flex-col gap-4'>
          {active && (
            <Card>
              <CardContent className='flex flex-col gap-2'>
                <div className='flex items-center justify-between text-sm'>
                  <span className='flex items-center gap-2 font-medium'>
                    <Spinner className='size-4' /> Reviewing test cases…
                  </span>
                  <span className='text-muted-foreground tabular-nums'>
                    {active.casesDone}/{active.casesTotal ?? '?'} cases
                  </span>
                </div>
                <div className='bg-muted h-2 overflow-hidden rounded-full' role='progressbar' aria-valuenow={active.casesDone} aria-valuemax={active.casesTotal ?? undefined}>
                  <div
                    className='h-full rounded-full transition-all'
                    style={{ width: `${active.casesTotal ? (active.casesDone / active.casesTotal) * 100 : 5}%`, background: 'var(--q-1)' }}
                  />
                </div>
                <p className='text-muted-foreground text-xs'>Each case is a real review, so a run takes a few minutes and uses some AI quota.</p>
              </CardContent>
            </Card>
          )}

          {!latest ? (
            !active && (
              <Empty className='border'>
                <EmptyHeader>
                  <EmptyTitle>No eval runs yet</EmptyTitle>
                  <EmptyDescription>
                    Run the evals to measure the reviewer: recall (planted bugs found), precision (findings that were real) and false
                    alarms on clean code.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button onClick={() => start.mutate()} disabled={start.isPending}>
                    <IconPlayerPlay /> Run evals
                  </Button>
                </EmptyContent>
              </Empty>
            )
          ) : (
            <>
              <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
                <StatCard
                  label='Recall'
                  value={pct(latest.recall)}
                  hint={`${latest.caught} of ${latest.expected} planted bugs found`}
                  delta={points(latest.recall, previous?.recall)}
                  format={(d) => `${d > 0 ? '+' : ''}${d} pts`}
                />
                <StatCard
                  label='Precision'
                  value={pct(latest.precision)}
                  hint={`${latest.onTarget} of ${latest.findings} findings were planted bugs`}
                  delta={points(latest.precision, previous?.precision)}
                  format={(d) => `${d > 0 ? '+' : ''}${d} pts`}
                />
                <StatCard
                  label='False alarms'
                  value={String(latest.falseAlarms)}
                  hint='on the clean change'
                  delta={previous ? latest.falseAlarms - previous.falseAlarms : null}
                  lowerIsBetter
                />
                <StatCard
                  label='Avg time per case'
                  value={avgCase ? formatDuration(avgCase) : '–'}
                  hint={`${shortModel(latest.model)} · ${timeAgo(latest.createdAt)}`}
                  delta={avgCase && prevAvgCase ? Math.round((avgCase - prevAvgCase) / 1000) : null}
                  lowerIsBetter
                  format={(d) => `${d > 0 ? '+' : ''}${d}s`}
                />
              </div>

              <div className='grid gap-4 lg:grid-cols-2'>
                <Card>
                  <CardHeader>
                    <CardTitle>Recall and precision over time</CardTitle>
                    <CardDescription>Every completed run, oldest to newest. Hover a point to see the model.</CardDescription>
                  </CardHeader>
                  <CardContent className='flex flex-col gap-3'>
                    <Legend items={[{ label: 'Recall', color: 'var(--q-1)' }, { label: 'Precision', color: 'var(--q-2)' }]} />
                    <ChartContainer config={scoreConfig} className='aspect-auto h-64 w-full'>
                      <LineChart data={trend} margin={{ left: 0, right: 12, top: 8 }}>
                        <CartesianGrid vertical={false} strokeDasharray='3 3' />
                        <XAxis dataKey='run' tickLine={false} axisLine={false} />
                        <YAxis domain={[0, 100]} tickLine={false} axisLine={false} width={36} tickFormatter={(v) => `${v}%`} />
                        <ChartTooltip
                          content={
                            <ChartTooltipContent
                              labelFormatter={(_, payload) => {
                                const p = payload?.[0]?.payload as { run: string; model: string; when: string } | undefined;
                                return p ? `Run ${p.run} · ${p.model}` : '';
                              }}
                            />
                          }
                        />
                        <Line dataKey='recall' type='monotone' stroke='var(--color-recall)' strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 5 }} connectNulls />
                        <Line dataKey='precision' type='monotone' stroke='var(--color-precision)' strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 5 }} connectNulls />
                      </LineChart>
                    </ChartContainer>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Models compared</CardTitle>
                    <CardDescription>Average over all runs of each model. Switch the main reviewer on AI providers, run again, and compare.</CardDescription>
                  </CardHeader>
                  <CardContent className='flex flex-col gap-3'>
                    <Legend items={[{ label: 'Recall', color: 'var(--q-1)' }, { label: 'Precision', color: 'var(--q-2)' }]} />
                    <ChartContainer config={scoreConfig} className='aspect-auto h-64 w-full'>
                      <BarChart data={byModel} margin={{ left: 0, right: 12, top: 8 }} barGap={2}>
                        <CartesianGrid vertical={false} strokeDasharray='3 3' />
                        <XAxis dataKey='model' tickLine={false} axisLine={false} interval={0} />
                        <YAxis domain={[0, 100]} tickLine={false} axisLine={false} width={36} tickFormatter={(v) => `${v}%`} />
                        <ChartTooltip cursor={{ fillOpacity: 0.4 }} content={<ChartTooltipContent />} />
                        <Bar dataKey='recall' fill='var(--color-recall)' radius={[4, 4, 0, 0]} maxBarSize={36} />
                        <Bar dataKey='precision' fill='var(--color-precision)' radius={[4, 4, 0, 0]} maxBarSize={36} />
                      </BarChart>
                    </ChartContainer>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Bugs found per test case</CardTitle>
                    <CardDescription>Latest run: planted bugs found vs missed in each case.</CardDescription>
                  </CardHeader>
                  <CardContent className='flex flex-col gap-3'>
                    <Legend items={[{ label: 'Found', color: 'var(--q-1)' }, { label: 'Missed', color: 'var(--q-2)' }]} />
                    <ChartContainer config={caseConfig} className='aspect-auto h-64 w-full'>
                      <BarChart data={perCase} layout='vertical' margin={{ left: 8, right: 12 }}>
                        <CartesianGrid horizontal={false} strokeDasharray='3 3' />
                        <XAxis type='number' allowDecimals={false} tickLine={false} axisLine={false} />
                        <YAxis type='category' dataKey='case' tickLine={false} axisLine={false} width={130} />
                        <ChartTooltip cursor={{ fillOpacity: 0.4 }} content={<ChartTooltipContent />} />
                        <Bar dataKey='found' stackId='a' fill='var(--color-found)' stroke='var(--card)' strokeWidth={2} maxBarSize={22} />
                        <Bar dataKey='missed' stackId='a' fill='var(--color-missed)' stroke='var(--card)' strokeWidth={2} radius={[0, 4, 4, 0]} maxBarSize={22} />
                      </BarChart>
                    </ChartContainer>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>What the reviewer reported</CardTitle>
                    <CardDescription>Latest run: findings that hit a planted bug vs extra findings (not always wrong, but not on the answer key).</CardDescription>
                  </CardHeader>
                  <CardContent className='flex flex-col gap-3'>
                    <Legend items={[{ label: 'Hit a planted bug', color: 'var(--q-1)' }, { label: 'Extra findings', color: 'var(--q-0)' }]} />
                    <div className='relative'>
                      <ChartContainer config={donutConfig} className='mx-auto aspect-square h-64'>
                        <PieChart>
                          <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                          <Pie data={donut} dataKey='value' nameKey='name' innerRadius='62%' outerRadius='88%' stroke='var(--card)' strokeWidth={2}>
                            {donut.map((d) => (
                              <Cell key={d.name} fill={d.fill} />
                            ))}
                          </Pie>
                        </PieChart>
                      </ChartContainer>
                      <div className='pointer-events-none absolute inset-0 flex flex-col items-center justify-center'>
                        <span className='text-3xl font-semibold tabular-nums'>{pct(latest.precision)}</span>
                        <span className='text-muted-foreground text-xs'>precision</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Test cases (latest run)</CardTitle>
                  <CardDescription>Also the accessible table view of the charts above.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Case</TableHead>
                        <TableHead className='text-right'>Found</TableHead>
                        <TableHead className='text-right'>Findings</TableHead>
                        <TableHead>Missed</TableHead>
                        <TableHead className='text-right'>Time</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {latest.cases.map((c) => (
                        <TableRow key={c.caseName}>
                          <TableCell>
                            <div className='flex items-center gap-2 font-medium'>
                              {c.error ? (
                                <IconX className='size-4 text-red-500' aria-label='failed' />
                              ) : c.expected === 0 ? (
                                c.falseAlarms === 0 ? (
                                  <IconCheck className='size-4 text-emerald-500' aria-label='no false alarm' />
                                ) : (
                                  <IconX className='size-4 text-red-500' aria-label='false alarm' />
                                )
                              ) : c.caught === c.expected ? (
                                <IconCheck className='size-4 text-emerald-500' aria-label='all found' />
                              ) : (
                                <IconX className='size-4 text-amber-500' aria-label='some missed' />
                              )}
                              {c.reviewId ? (
                                <Link href={`/dashboard/reviews/${c.reviewId}`} className='underline-offset-4 hover:underline'>
                                  {caseLabel(c.caseName)}
                                </Link>
                              ) : (
                                caseLabel(c.caseName)
                              )}
                              {c.expected === 0 && <Badge variant='secondary'>clean</Badge>}
                            </div>
                            {c.description && <div className='text-muted-foreground text-xs'>{c.description}</div>}
                          </TableCell>
                          <TableCell className='text-right tabular-nums'>
                            {c.expected === 0 ? `${c.falseAlarms} false alarm${c.falseAlarms === 1 ? '' : 's'}` : `${c.caught}/${c.expected}`}
                          </TableCell>
                          <TableCell className='text-right tabular-nums'>{c.findings}</TableCell>
                          <TableCell className='text-muted-foreground max-w-[22rem] text-xs'>
                            {c.error ? <span className='text-red-500'>Review failed: {c.error}</span> : c.missed.length ? c.missed.join('; ') : '–'}
                          </TableCell>
                          <TableCell className='text-muted-foreground text-right whitespace-nowrap tabular-nums'>
                            {formatDuration(c.durationMs)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          )}

          {all.some((r) => r.status === 'failed') && (
            <p className='text-muted-foreground text-xs'>
              Failed runs: {all.filter((r) => r.status === 'failed').map((r) => `${timeAgo(r.createdAt)} (${r.error ?? 'unknown error'})`).join(' · ')}
            </p>
          )}
        </div>
      )}
    </PageContainer>
  );
}
