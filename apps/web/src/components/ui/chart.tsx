'use client';

import * as React from 'react';
import * as RechartsPrimitive from 'recharts';

import { cn } from '@/lib/utils';

export type ChartConfig = {
  [k in string]: {
    label?: React.ReactNode;
    icon?: React.ComponentType;
    color?: string;
  };
};

type ChartContextProps = { config: ChartConfig };

const ChartContext = React.createContext<ChartContextProps | null>(null);

function useChart() {
  const context = React.useContext(ChartContext);
  if (!context) {
    throw new Error('useChart must be used within a <ChartContainer />');
  }
  return context;
}

function ChartContainer({
  id,
  className,
  children,
  config,
  ...props
}: React.ComponentProps<'div'> & {
  config: ChartConfig;
  children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>['children'];
}) {
  const uniqueId = React.useId();
  const chartId = `chart-${id || uniqueId.replace(/:/g, '')}`;

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot='chart'
        data-chart={chartId}
        className={cn(
          "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50 [&_.recharts-layer]:outline-hidden [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted [&_.recharts-sector]:outline-hidden [&_.recharts-surface]:outline-hidden",
          className,
        )}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer>{children}</RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

// Exposes each config colour as a `--color-<key>` CSS variable scoped to this chart.
function ChartStyle({ id, config }: { id: string; config: ChartConfig }) {
  const colors = Object.entries(config).filter(([, item]) => item.color);
  if (!colors.length) return null;

  const css = `[data-chart=${id}] {\n${colors
    .map(([key, item]) => `  --color-${key}: ${item.color};`)
    .join('\n')}\n}`;

  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}

const ChartTooltip = RechartsPrimitive.Tooltip;

type TooltipItem = {
  dataKey?: string | number;
  name?: string | number;
  value?: number | string | Array<number | string>;
  color?: string;
  payload?: Record<string, unknown>;
};

function ChartTooltipContent({
  active,
  payload,
  label,
  className,
  hideLabel = false,
  hideIndicator = false,
  labelFormatter,
  labelClassName,
}: {
  // `active`, `payload` and `label` are injected by Recharts at render time.
  active?: boolean;
  payload?: ReadonlyArray<TooltipItem>;
  label?: unknown;
  className?: string;
  hideLabel?: boolean;
  hideIndicator?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  labelFormatter?: (value: any, payload: ReadonlyArray<TooltipItem>) => React.ReactNode;
  labelClassName?: string;
}) {
  const { config } = useChart();

  if (!active || !payload?.length) return null;

  const first = payload[0];
  const rawLabel = label ?? config[String(first?.dataKey ?? first?.name ?? '')]?.label;
  const tooltipLabel = hideLabel ? null : (
    <div className={cn('font-medium', labelClassName)}>
      {labelFormatter ? labelFormatter(rawLabel, payload) : (rawLabel as React.ReactNode)}
    </div>
  );

  return (
    <div
      className={cn(
        'grid min-w-[8rem] items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl',
        className,
      )}
    >
      {tooltipLabel}
      <div className='grid gap-1.5'>
        {payload.map((item) => {
          const key = String(item.dataKey ?? item.name ?? 'value');
          const itemConfig = config[key];
          const indicatorColor = item.color ?? `var(--color-${key})`;

          return (
            <div key={key} className='flex w-full items-center gap-2'>
              {!hideIndicator && (
                <div className='h-2.5 w-2.5 shrink-0 rounded-[2px]' style={{ backgroundColor: indicatorColor }} />
              )}
              <div className='flex flex-1 items-center justify-between gap-4 leading-none'>
                <span className='text-muted-foreground'>{itemConfig?.label ?? item.name}</span>
                {item.value !== undefined && (
                  <span className='font-mono font-medium text-foreground tabular-nums'>
                    {typeof item.value === 'number' ? item.value.toLocaleString() : String(item.value)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { ChartContainer, ChartStyle, ChartTooltip, ChartTooltipContent, useChart };
