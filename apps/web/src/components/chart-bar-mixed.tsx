'use client';

import { TrendingUp } from 'lucide-react';
import { Bar, BarChart, XAxis, YAxis } from 'recharts';

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';

export const description = 'A mixed bar chart';

const chartData = [
  { browser: 'chrome', visitors: 275, fill: 'var(--color-chrome)' },
  { browser: 'safari', visitors: 200, fill: 'var(--color-safari)' },
  { browser: 'firefox', visitors: 187, fill: 'var(--color-firefox)' },
  { browser: 'edge', visitors: 173, fill: 'var(--color-edge)' },
  { browser: 'other', visitors: 90, fill: 'var(--color-other)' },
];

// Blue / light-blue palette
const chartConfig = {
  visitors: {
    label: 'Visitors',
  },
  chrome: {
    label: 'Chrome',
    color: '#2563eb',
  },
  safari: {
    label: 'Safari',
    color: '#3b82f6',
  },
  firefox: {
    label: 'Firefox',
    color: '#60a5fa',
  },
  edge: {
    label: 'Edge',
    color: '#7dd3fc',
  },
  other: {
    label: 'Other',
    color: '#bae6fd',
  },
} satisfies ChartConfig;

export function ChartBarMixed() {
  return (
    <Card className='w-full max-w-2xl mx-auto'>
      <CardHeader>
        <CardTitle>Bar Chart - Mixed</CardTitle>
        <CardDescription>January - June 2024</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className='aspect-auto h-[260px] w-full'>
          <BarChart
            accessibilityLayer
            data={chartData}
            layout='vertical'
            margin={{
              left: 0,
            }}
          >
            <YAxis
              dataKey='browser'
              type='category'
              tickLine={false}
              tickMargin={10}
              axisLine={false}
              tickFormatter={(value) => chartConfig[value as keyof typeof chartConfig]?.label}
            />
            <XAxis dataKey='visitors' type='number' hide />
            <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
            <Bar dataKey='visitors' radius={4} barSize={24} />
          </BarChart>
        </ChartContainer>
      </CardContent>
      <CardFooter className='flex-col items-start gap-2 text-sm'>
        <div className='flex gap-2 leading-none font-medium'>
          Trending up by 5.2% this month <TrendingUp className='h-4 w-4' />
        </div>
        <div className='leading-none text-muted-foreground'>Showing total visitors for the last 6 months</div>
      </CardFooter>
    </Card>
  );
}
