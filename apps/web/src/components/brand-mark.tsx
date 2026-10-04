import { cn } from '@/lib/utils';

/** The product mark: a compact pull-request review card. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox='0 0 40 40' fill='none' aria-hidden='true' className={cn('shrink-0', className)}>
      <rect x='3.5' y='3.5' width='33' height='33' rx='8' fill='currentColor' />
      <path d='M12 13h16M12 19h10M12 25h6' stroke='var(--brand-cutout, var(--background, white))' strokeWidth='2.4' strokeLinecap='round' />
      <path d='m25 25 2.4 2.4 4.7-5.4' stroke='var(--brand-accent, #8ee000)' strokeWidth='2.4' strokeLinecap='round' strokeLinejoin='round' />
    </svg>
  );
}
