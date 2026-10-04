'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

export interface TypingAnimationProps {
  words: string[];
  typingSpeed?: number;
  deletingSpeed?: number;
  pauseTime?: number;
  className?: string;
  cursorClassName?: string;
}

export function TypingAnimation({
  words = ['Ship.', 'Scale.', 'Deploy.', 'Verify.'],
  typingSpeed = 90,
  deletingSpeed = 45,
  pauseTime = 1600,
  className,
  cursorClassName,
}: TypingAnimationProps) {
  const [wordIndex, setWordIndex] = useState(0);
  const [currentText, setCurrentText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const currentWord = words[wordIndex] ?? '';

    let timer: NodeJS.Timeout;

    if (!isDeleting && currentText === currentWord) {
      // Pause at full word before deleting
      timer = setTimeout(() => setIsDeleting(true), pauseTime);
    } else if (isDeleting && currentText === '') {
      // Move to next word after deleting
      setIsDeleting(false);
      setWordIndex((prev) => (prev + 1) % words.length);
    } else {
      // Typing or deleting next character
      const speed = isDeleting ? deletingSpeed : typingSpeed;
      timer = setTimeout(() => {
        const nextText = isDeleting
          ? currentWord.substring(0, currentText.length - 1)
          : currentWord.substring(0, currentText.length + 1);
        setCurrentText(nextText);
      }, speed);
    }

    return () => clearTimeout(timer);
  }, [currentText, isDeleting, wordIndex, words, typingSpeed, deletingSpeed, pauseTime]);

  return (
    <span className={cn('inline-flex items-baseline font-bold tracking-tight', className)}>
      <span>{currentText}</span>
      <span
        className={cn(
          'inline-block w-[3px] h-[0.9em] ml-1 bg-current align-baseline animate-pulse',
          cursorClassName
        )}
        aria-hidden='true'
      />
    </span>
  );
}
