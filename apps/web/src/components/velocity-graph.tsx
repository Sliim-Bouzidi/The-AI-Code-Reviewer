'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { IconArrowUpRight, IconBolt, IconShieldCheck, IconSparkles } from '@tabler/icons-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const weeks = ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8', 'W9', 'W10', 'W11', 'W12'];
const turnaroundData = [4.8, 4.2, 3.7, 3.1, 2.6, 2.2, 1.8, 1.4, 1.1, 0.9, 0.7, 0.5]; // hours
const coverageData = [62, 65, 71, 74, 79, 83, 88, 92, 95, 97, 98, 99.4]; // percent

export function VelocityGraph() {
  const [activeMetric, setActiveMetric] = useState<'turnaround' | 'coverage'>('turnaround');

  return (
    <Card className='w-full max-w-4xl mx-auto border-white/[0.08] bg-black/60 backdrop-blur-xl rounded-2xl overflow-hidden shadow-2xl'>
      <CardHeader className='flex flex-row items-center justify-between pb-4 border-b border-white/[0.06]'>
        <div>
          <div className='flex items-center gap-2 mb-1'>
            <Badge variant='outline' className='text-[10px] text-sky-400 border-sky-500/20 bg-sky-500/10'>
              Telemetry
            </Badge>
            <span className='text-xs text-neutral-400'>Real-time Monorepo Benchmark</span>
          </div>
          <CardTitle className='text-lg sm:text-xl font-semibold text-white tracking-tight'>
            {activeMetric === 'turnaround' ? 'Review Cycle Time: 4.8h → 30min' : 'PR Bug Catch Rate: 62% → 99.4%'}
          </CardTitle>
        </div>

        <div className='flex items-center gap-1.5 p-1 rounded-lg bg-white/[0.04] border border-white/[0.08]'>
          <button
            onClick={() => setActiveMetric('turnaround')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              activeMetric === 'turnaround'
                ? 'bg-white text-black font-semibold'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            Turnaround
          </button>
          <button
            onClick={() => setActiveMetric('coverage')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              activeMetric === 'coverage'
                ? 'bg-white text-black font-semibold'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            Signal Rate
          </button>
        </div>
      </CardHeader>

      <CardContent className='p-6'>
        {/* Metric Badges */}
        <div className='grid grid-cols-3 gap-4 mb-6'>
          <div className='p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.06]'>
            <div className='flex items-center gap-1.5 text-xs text-neutral-400 mb-1'>
              <IconBolt className='w-3.5 h-3.5 text-amber-400' />
              <span>Speedup</span>
            </div>
            <div className='text-xl sm:text-2xl font-bold text-white tracking-tight flex items-center gap-1'>
              9.6x
              <span className='text-xs font-normal text-emerald-400 flex items-center'>
                <IconArrowUpRight className='w-3 h-3' /> faster
              </span>
            </div>
          </div>

          <div className='p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.06]'>
            <div className='flex items-center gap-1.5 text-xs text-neutral-400 mb-1'>
              <IconShieldCheck className='w-3.5 h-3.5 text-emerald-400' />
              <span>Issues Caught</span>
            </div>
            <div className='text-xl sm:text-2xl font-bold text-white tracking-tight'>
              14,290+
            </div>
          </div>

          <div className='p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.06]'>
            <div className='flex items-center gap-1.5 text-xs text-neutral-400 mb-1'>
              <IconSparkles className='w-3.5 h-3.5 text-sky-400' />
              <span>Dev Satisfaction</span>
            </div>
            <div className='text-xl sm:text-2xl font-bold text-white tracking-tight'>
              99.2%
            </div>
          </div>
        </div>

        {/* SVG Area Chart */}
        <div className='relative h-48 w-full mt-2'>
          <svg className='w-full h-full overflow-visible' viewBox='0 0 600 160' preserveAspectRatio='none'>
            <defs>
              <linearGradient id='cyanGrad' x1='0' y1='0' x2='0' y2='1'>
                <stop offset='0%' stopColor='#38bdf8' stopOpacity='0.35' />
                <stop offset='100%' stopColor='#38bdf8' stopOpacity='0.0' />
              </linearGradient>
              <linearGradient id='emeraldGrad' x1='0' y1='0' x2='0' y2='1'>
                <stop offset='0%' stopColor='#10b981' stopOpacity='0.35' />
                <stop offset='100%' stopColor='#10b981' stopOpacity='0.0' />
              </linearGradient>
            </defs>

            {/* Horizontal Grid lines */}
            {[20, 60, 100, 140].map((y) => (
              <line
                key={y}
                x1='0'
                y1={y}
                x2='600'
                y2={y}
                stroke='rgba(255, 255, 255, 0.05)'
                strokeDasharray='4 4'
              />
            ))}

            {activeMetric === 'turnaround' ? (
              <>
                {/* Area under curve */}
                <motion.path
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.6 }}
                  d='M 0 20 Q 150 50, 300 110 T 600 148 L 600 160 L 0 160 Z'
                  fill='url(#cyanGrad)'
                />
                {/* Curve line */}
                <motion.path
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 1.2, ease: 'easeOut' }}
                  d='M 0 20 Q 150 50, 300 110 T 600 148'
                  fill='none'
                  stroke='#38bdf8'
                  strokeWidth='2.5'
                  strokeLinecap='round'
                />
              </>
            ) : (
              <>
                {/* Area under curve */}
                <motion.path
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.6 }}
                  d='M 0 130 Q 180 90, 350 40 T 600 15 L 600 160 L 0 160 Z'
                  fill='url(#emeraldGrad)'
                />
                {/* Curve line */}
                <motion.path
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 1.2, ease: 'easeOut' }}
                  d='M 0 130 Q 180 90, 350 40 T 600 15'
                  fill='none'
                  stroke='#10b981'
                  strokeWidth='2.5'
                  strokeLinecap='round'
                />
              </>
            )}

            {/* Data points */}
            {weeks.map((_, i) => {
              const cx = (i / (weeks.length - 1)) * 600;
              const cy =
                activeMetric === 'turnaround'
                  ? 20 + (128 * (i / (weeks.length - 1)))
                  : 130 - (115 * (i / (weeks.length - 1)));
              return (
                <circle
                  key={i}
                  cx={cx}
                  cy={cy}
                  r='3.5'
                  fill='#ffffff'
                  stroke={activeMetric === 'turnaround' ? '#38bdf8' : '#10b981'}
                  strokeWidth='2'
                  className='hover:r-5 transition-all cursor-pointer'
                />
              );
            })}
          </svg>

          {/* X-axis labels */}
          <div className='flex justify-between mt-3 text-[11px] text-neutral-500 font-mono'>
            {weeks.map((w, idx) => (
              <span key={idx} className={idx % 2 === 0 ? 'inline' : 'hidden sm:inline'}>
                {w}
              </span>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
