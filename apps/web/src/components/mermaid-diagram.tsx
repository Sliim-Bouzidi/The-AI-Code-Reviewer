'use client';

import * as React from 'react';
import { Spinner } from '@/components/ui/spinner';
import { useTheme } from '@/components/theme-provider';

/**
 * Renders Mermaid text as SVG in the browser. The text is built by our API from analysed (untrusted)
 * repositories: labels are escaped there, and Mermaid runs in `strict` security mode (its output is
 * sanitised and click handlers are disabled). `mermaid` is loaded on demand, only when a diagram is shown.
 */
export function MermaidDiagram({ source, onSvg }: { source: string; onSvg?: (svg: string | null) => void }) {
  const { resolvedTheme } = useTheme();
  const [svg, setSvg] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const onSvgRef = React.useRef(onSvg);
  onSvgRef.current = onSvg;

  React.useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setError(null);
    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: resolvedTheme === 'dark' ? 'dark' : 'default' });
        const { svg: out } = await mermaid.render(`mmd-${Math.random().toString(36).slice(2)}`, source);
        if (cancelled) return;
        setSvg(out);
        onSvgRef.current?.(out);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'The diagram could not be drawn');
        onSvgRef.current?.(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source, resolvedTheme]);

  if (error) return <p className='text-destructive text-sm'>The diagram could not be drawn: {error}</p>;
  if (!svg) {
    return (
      <div className='text-muted-foreground flex items-center gap-2 py-8 text-sm'>
        <Spinner /> Drawing…
      </div>
    );
  }
  return <div className='overflow-auto [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full' dangerouslySetInnerHTML={{ __html: svg }} />;
}
