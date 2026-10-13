'use client';

import type { Analysis, Diagram, DiagramKind } from '@codereview/shared';
import { IconDownload, IconExternalLink, IconRefresh } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { toast } from 'sonner';
import { LoadError, RowsSkeleton } from '@/components/query-state';
import { MermaidDiagram } from '@/components/mermaid-diagram';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { errorMessage, useApi } from '@/lib/api';

const KINDS: { value: DiagramKind; label: string; hint: string }[] = [
  { value: 'packages', label: 'Packages', hint: 'Directories and the imports between them' },
  { value: 'dependencies', label: 'Dependencies', hint: 'Imports between files' },
  { value: 'classes', label: 'Classes', hint: 'UML classes, interfaces and inheritance' },
];

function download(filename: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Link to the file (or directory) of a diagram element on GitHub, at the analysed commit. */
function githubUrl(fullName: string, sha: string | null, node: Diagram['nodes'][number]): string | null {
  if (!node.path) return null;
  const path = node.path.split('/').map(encodeURIComponent).join('/');
  const ref = sha ?? 'HEAD';
  const base = `https://github.com/${fullName}`;
  return node.kind === 'directory' ? `${base}/tree/${ref}/${path}` : `${base}/blob/${ref}/${path}${node.line ? `#L${node.line}` : ''}`;
}

export function ArchitectureTab({ repoId, fullName, defaultBranch }: { repoId: string; fullName: string; defaultBranch: string | null }) {
  const api = useApi();
  const qc = useQueryClient();
  const [branch, setBranch] = React.useState(defaultBranch ?? '');
  const [kind, setKind] = React.useState<DiagramKind>('packages');
  const [scopeInput, setScopeInput] = React.useState('');
  const [scope, setScope] = React.useState('');
  const [depth, setDepth] = React.useState('auto');
  const [external, setExternal] = React.useState(false);
  const [svg, setSvg] = React.useState<string | null>(null);

  const branches = useQuery({ queryKey: ['branches', repoId], queryFn: () => api.repoBranches(repoId), staleTime: 60_000, retry: false });
  const analyses = useQuery({
    queryKey: ['analyses', repoId],
    queryFn: () => api.analyses(repoId),
    refetchInterval: (q) => (q.state.data?.some((a) => a.status === 'analyzing') ? 3_000 : false),
  });
  const current: Analysis | undefined = analyses.data?.find((a) => a.branch === branch);
  const hasGraph = !!current && (current.status === 'ready' || current.filesCount > 0);

  const diagram = useQuery({
    queryKey: ['diagram', repoId, branch, kind, scope, depth, external, current?.commitSha],
    queryFn: () =>
      api.diagram(repoId, {
        kind,
        branch: branch || undefined,
        scope: scope || undefined,
        depth: kind === 'packages' && depth !== 'auto' ? Number(depth) : undefined,
        external: kind === 'dependencies' ? external : undefined,
      }),
    enabled: hasGraph,
    retry: false,
  });

  const analyze = useMutation({
    mutationFn: () => api.analyzeRepo(repoId, branch || undefined),
    onSuccess: () => {
      toast.success('Analysis started');
      void qc.invalidateQueries({ queryKey: ['analyses', repoId] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const branchOptions = React.useMemo(() => {
    const names = new Set<string>(branches.data?.branches ?? []);
    if (defaultBranch) names.add(defaultBranch);
    for (const a of analyses.data ?? []) names.add(a.branch);
    return [...names].sort().map((name) => ({
      value: name,
      label: name,
      hint: analyses.data?.some((a) => a.branch === name) ? 'analysed' : name === defaultBranch ? 'default branch' : undefined,
    }));
  }, [branches.data, analyses.data, defaultBranch]);

  const analyzing = current?.status === 'analyzing';
  const fileBase = `${fullName.replace('/', '-')}-${branch || 'default'}-${kind}`.replace(/[^A-Za-z0-9._-]/g, '_');
  const d = diagram.data;

  return (
    <div className='flex flex-col gap-4'>
      <Card>
        <CardHeader>
          <CardTitle>Architecture</CardTitle>
          <CardDescription>
            Diagrams drawn from a static analysis of the code (TypeScript, JavaScript, Java and Python relations; other languages
            contribute files only). Nothing is guessed by an AI: a dotted line means the link was matched by name, not proven.
          </CardDescription>
        </CardHeader>
        <CardContent className='flex flex-wrap items-end gap-3'>
          <div className='flex w-64 flex-col gap-1.5'>
            <Label htmlFor='arch-branch'>Branch</Label>
            <Select id='arch-branch' value={branch} onValueChange={setBranch} options={branchOptions} placeholder='Select a branch' />
          </div>
          <Button onClick={() => analyze.mutate()} disabled={analyze.isPending || analyzing || !branch}>
            {analyzing || analyze.isPending ? <Spinner /> : <IconRefresh />}
            {current ? 'Analyse again' : 'Analyse this branch'}
          </Button>
          {current && (
            <span className='text-muted-foreground flex flex-wrap items-center gap-2 text-xs'>
              <Badge variant={current.status === 'failed' ? 'destructive' : 'outline'}>{current.status}</Badge>
              {current.commitSha && <span>commit {current.commitSha.slice(0, 7)}</span>}
              {hasGraph && (
                <span>
                  {current.filesCount} files · {current.symbolsCount} symbols · {current.relationsCount} relations
                </span>
              )}
              {current.progress && <span>{current.progress}</span>}
            </span>
          )}
          {branches.isError && <span className='text-muted-foreground text-xs'>Branch list unavailable: {errorMessage(branches.error)}</span>}
        </CardContent>
      </Card>

      {analyses.isPending ? (
        <RowsSkeleton rows={2} />
      ) : analyses.isError ? (
        <LoadError error={analyses.error} />
      ) : !hasGraph ? (
        <Empty className='border'>
          <EmptyHeader>
            <EmptyTitle>{analyzing ? 'Analysing…' : current?.status === 'failed' ? 'The last analysis failed' : 'This branch has not been analysed yet'}</EmptyTitle>
            <EmptyDescription>
              {analyzing
                ? (current?.progress ?? 'The worker is reading the code.')
                : current?.status === 'failed'
                  ? (current.progress ?? 'Unknown error')
                  : 'Click "Analyse this branch": the code is cloned, parsed and linked. No AI key is needed.'}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card>
          <CardContent className='flex flex-col gap-4'>
            <div className='flex flex-wrap items-end gap-3'>
              <div className='flex gap-1' role='group' aria-label='Diagram type'>
                {KINDS.map((k) => (
                  <Button key={k.value} size='sm' variant={kind === k.value ? 'default' : 'outline'} title={k.hint} onClick={() => setKind(k.value)}>
                    {k.label}
                  </Button>
                ))}
              </div>
              <div className='flex w-56 flex-col gap-1.5'>
                <Label htmlFor='arch-scope'>Folder (optional)</Label>
                <Input
                  id='arch-scope'
                  placeholder='apps/api/src'
                  value={scopeInput}
                  onChange={(e) => setScopeInput(e.target.value)}
                  onBlur={() => setScope(scopeInput.trim())}
                  onKeyDown={(e) => e.key === 'Enter' && setScope(scopeInput.trim())}
                />
              </div>
              {kind === 'packages' && (
                <div className='flex w-32 flex-col gap-1.5'>
                  <Label htmlFor='arch-depth'>Depth</Label>
                  <Select
                    id='arch-depth'
                    value={depth}
                    onValueChange={setDepth}
                    options={['auto', '1', '2', '3', '4', '5'].map((v) => ({ value: v, label: v === 'auto' ? 'Automatic' : v }))}
                  />
                </div>
              )}
              {kind === 'dependencies' && (
                <div className='flex items-center gap-2 pb-1.5'>
                  <Switch id='arch-external' checked={external} onCheckedChange={setExternal} />
                  <Label htmlFor='arch-external'>External packages</Label>
                </div>
              )}
            </div>

            {diagram.isPending ? (
              <RowsSkeleton rows={3} />
            ) : diagram.isError ? (
              <LoadError error={diagram.error} />
            ) : !d ? null : d.nodes.length === 0 ? (
              <p className='text-muted-foreground text-sm'>Nothing to draw for this selection{scope ? ` in "${scope}"` : ''}. Try another folder or diagram type.</p>
            ) : (
              <>
                <MermaidDiagram source={d.mermaid} onSvg={setSvg} />
                <div className='flex flex-wrap gap-2'>
                  <Button size='sm' variant='outline' onClick={() => download(`${fileBase}.mmd`, d.mermaid, 'text/plain')}>
                    <IconDownload /> Mermaid
                  </Button>
                  <Button size='sm' variant='outline' disabled={!svg} onClick={() => svg && download(`${fileBase}.svg`, svg, 'image/svg+xml')}>
                    <IconDownload /> SVG
                  </Button>
                  <Button size='sm' variant='outline' onClick={() => download(`${fileBase}.json`, JSON.stringify({ nodes: d.nodes, edges: d.edges }, null, 2), 'application/json')}>
                    <IconDownload /> JSON
                  </Button>
                </div>
                <ul className='text-muted-foreground list-disc space-y-1 pl-5 text-xs'>
                  {d.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
                <Elements diagram={d} fullName={fullName} />
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** Every drawn element with a link to its code on GitHub (the diagram itself is a static picture). */
function Elements({ diagram, fullName }: { diagram: Diagram; fullName: string }) {
  const items = diagram.nodes.filter((n) => n.path);
  if (items.length === 0) return null;
  return (
    <div className='flex flex-col gap-1.5'>
      <h3 className='text-sm font-medium'>Open in the code</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Element</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Location</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((n) => {
            const url = githubUrl(fullName, diagram.commitSha, n);
            return (
              <TableRow key={n.id}>
                <TableCell className='font-medium'>{n.label}</TableCell>
                <TableCell>{n.kind}</TableCell>
                <TableCell>
                  {url ? (
                    <a href={url} target='_blank' rel='noreferrer' className='inline-flex items-center gap-1 underline underline-offset-4'>
                      {n.path}
                      {n.line ? `:${n.line}` : ''}
                      <IconExternalLink className='size-3.5' />
                    </a>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
