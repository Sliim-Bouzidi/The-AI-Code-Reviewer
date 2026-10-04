'use client';

import { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { IconCheck, IconLoader2 } from '@tabler/icons-react';
import { cn } from '@/lib/utils';

export interface StepItem {
  id: string;
  title: string;
}

export interface SetupStepsProps {
  duration?: number;
  steps?: StepItem[];
  step1?: string;
  step2?: string;
  step3?: string;
  className?: string;
}

const defaultSteps: StepItem[] = [
  { id: '1', title: 'Webhook Triggered: PR #429' },
  { id: '2', title: 'Parsing Semantic AST & Imports' },
  { id: '3', title: 'Cross-Repository Symbol Verification' },
  { id: '4', title: 'Multi-Agent Security & Lint Audit' },
  { id: '5', title: 'Publishing Inline PR Suggestions' },
];

export function SetupSteps({
  duration = 3000,
  steps,
  step1 = 'Webhook Triggered: PR #429',
  step2 = 'Parsing Semantic AST & Imports',
  step3 = 'Cross-Repository Symbol Verification',
  className,
}: SetupStepsProps) {
  const stepsList = useMemo(() => {
    if (steps && steps.length > 0) return steps;
    return [
      { id: '1', title: step1 },
      { id: '2', title: step2 },
      { id: '3', title: step3 },
      { id: '4', title: 'Multi-Agent Security & Lint Audit' },
      { id: '5', title: 'Publishing Inline PR Suggestions' },
    ];
  }, [steps, step1, step2, step3]);

  const [pointer, setPointer] = useState(1);

  const visible = [
    stepsList[(pointer - 1 + stepsList.length) % stepsList.length],
    stepsList[pointer],
    stepsList[(pointer + 1) % stepsList.length],
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      setPointer((prev) => (prev + 1) % stepsList.length);
    }, duration);
    return () => clearInterval(timer);
  }, [duration, stepsList.length]);

  return (
    <div
      className={cn(
        'relative flex flex-col items-center justify-center overflow-hidden h-72 w-full max-w-sm py-2',
        className,
      )}
    >
      <div className='relative w-full h-56 overflow-hidden'>
        <AnimatePresence initial={false}>
          {visible.map((item, i) => {
            const isCompleted = i === 0;
            const isActive = i === 1;
            const status = isCompleted ? 'completed' : isActive ? 'active' : 'pending';

            return (
              <motion.div
                key={item.id}
                initial={{ y: 220, opacity: 0, scale: 0.9 }}
                animate={{
                  y: i * 72 + 6,
                  scale: isActive ? 1 : 0.92,
                  opacity: isActive ? 1 : 0.45,
                }}
                exit={{ y: -80, opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                className={cn(
                  'absolute left-0 right-0 mx-auto w-full flex flex-col justify-center gap-2 rounded-xl border p-3.5 transition-colors duration-500',
                  isActive
                    ? 'bg-neutral-900/90 text-white border-white/20 shadow-lg backdrop-blur-md'
                    : 'bg-neutral-950/50 text-neutral-400 border-white/[0.06]',
                )}
              >
                <div className='flex items-center justify-start gap-2.5'>
                  <div className='relative size-5 shrink-0 flex items-center justify-center'>
                    <AnimatePresence mode='wait'>
                      <motion.div
                        key={status}
                        initial={{ scale: status === 'completed' ? 0 : 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: status === 'pending' ? 0.4 : 1 }}
                        exit={{ scale: status === 'completed' ? 0 : 0.8, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className={cn(
                          status === 'completed' && 'flex size-5 items-center justify-center rounded-full bg-emerald-500 text-black',
                          status === 'active' && 'animate-spin text-sky-400',
                          status === 'pending' && 'text-neutral-500',
                        )}
                      >
                        {status === 'completed' ? (
                          <IconCheck className='size-3 stroke-[3]' />
                        ) : (
                          <IconLoader2 className='size-4' />
                        )}
                      </motion.div>
                    </AnimatePresence>
                  </div>
                  <span
                    className={cn(
                      'text-xs font-semibold tracking-tight transition-colors duration-500 truncate',
                      isActive ? 'text-white' : 'text-neutral-500',
                    )}
                  >
                    {item.title}
                  </span>
                </div>
                <div className='ml-7 h-1.5 overflow-hidden rounded-full bg-neutral-800'>
                  <motion.div
                    className='h-full bg-gradient-to-r from-sky-400 to-indigo-500 rounded-full'
                    initial={{ width: '0%' }}
                    animate={{
                      width: status === 'pending' ? '0%' : '100%',
                    }}
                    transition={{
                      width: isActive
                        ? { duration: duration / 1000, ease: 'linear' }
                        : { duration: 0.5, ease: 'easeInOut' },
                    }}
                  />
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Top and Bottom Fades for smooth transition */}
      <div className='pointer-events-none absolute top-0 left-0 right-0 h-10 bg-gradient-to-b from-black to-transparent z-10' />
      <div className='pointer-events-none absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-black to-transparent z-10' />
    </div>
  );
}
