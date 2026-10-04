'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import gsap from 'gsap';

const rotatingPhrases = [
  'Every Pull Request',
  'Critical Monorepos',
  'TypeScript Codebases',
  'Distributed Systems',
];

export function AnimatedHeroTitle() {
  const [index, setIndex] = useState(0);
  const containerRef = useRef<HTMLHeadingElement>(null);

  // Rotate phrases every 3 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      setIndex((prev) => (prev + 1) % rotatingPhrases.length);
    }, 3200);
    return () => clearInterval(timer);
  }, []);

  // GSAP subtle intro reveal on mount
  useEffect(() => {
    if (!containerRef.current) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        '.gsap-word',
        {
          opacity: 0,
          y: 24,
          filter: 'blur(8px)',
        },
        {
          opacity: 1,
          y: 0,
          filter: 'blur(0px)',
          duration: 0.9,
          stagger: 0.08,
          ease: 'power3.out',
        }
      );
    }, containerRef);

    return () => ctx.revert();
  }, []);

  return (
    <h1
      ref={containerRef}
      className='text-[clamp(1.75rem,5vw,3.75rem)] font-bold tracking-tight text-white leading-[1.1] text-center max-w-[90vw] sm:max-w-2xl md:max-w-3xl mx-auto drop-shadow-2xl'
    >
      {/* Static line */}
      <span className='block'>
        <span className='inline-block gsap-word'>Crafting</span>{' '}
        <span className='inline-block gsap-word'>Tailored</span>{' '}
        <span className='inline-block gsap-word bg-gradient-to-r from-white via-indigo-200 to-sky-400 bg-clip-text text-transparent'>
          AI Code
        </span>{' '}
        <span className='inline-block gsap-word bg-gradient-to-r from-sky-400 to-indigo-200 bg-clip-text text-transparent'>
          Reviews
        </span>{' '}
        <span className='inline-block gsap-word'>Across</span>
      </span>

      {/* Rotating phrase on its own line */}
      <span className='block relative h-[1.2em] overflow-hidden mt-1'>
        <AnimatePresence mode='wait'>
          <motion.span
            key={index}
            initial={{ opacity: 0, y: 32, filter: 'blur(6px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -32, filter: 'blur(6px)' }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className='absolute inset-x-0 bg-gradient-to-r from-sky-400 via-violet-300 to-amber-300 bg-clip-text text-transparent'
          >
            {rotatingPhrases[index]}
          </motion.span>
        </AnimatePresence>
      </span>
    </h1>
  );
}
