import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface PlaceCardProps {
  title?: string;
  description?: string;
  image?: string;
  href?: string;
  badge?: string;
  className?: string;
}

export function PlaceCard({
  title = 'AST-Aware Code Parser',
  description = 'Deep syntax and dependency trees analyzed in under 400ms.',
  image = 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=800&auto=format&fit=crop&q=80',
  href = '#preview',
  badge,
  className,
}: PlaceCardProps) {
  return (
    <div className={cn('w-full', className)}>
      <a href={href} className='block group h-full'>
        <Card className='relative h-72 sm:h-80 w-full gap-0 overflow-hidden rounded-2xl border-white/[0.08] bg-neutral-950 p-0 transition-all duration-300 hover:border-white/20 hover:shadow-[0_8px_30px_rgb(0,0,0,0.12)]'>
          <img
            src={image}
            alt={title}
            className='absolute inset-0 h-full w-full object-cover grayscale opacity-70 transition-all duration-500 ease-out group-hover:scale-105 group-hover:grayscale-0 group-hover:opacity-100'
          />
          <div className='pointer-events-none absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent' />
          
          {badge && (
            <div className='absolute top-3.5 left-3.5 z-10'>
              <span className='px-2.5 py-1 rounded-full text-[11px] font-medium tracking-tight bg-black/70 backdrop-blur-md border border-white/10 text-white'>
                {badge}
              </span>
            </div>
          )}

          <CardContent className='absolute inset-x-0 bottom-0 p-5 z-10'>
            <p className='text-base font-semibold text-white tracking-tight group-hover:text-sky-300 transition-colors'>
              {title}
            </p>
            <p className='text-xs text-neutral-400 mt-1.5 leading-relaxed line-clamp-2'>
              {description}
            </p>
          </CardContent>
        </Card>
      </a>
    </div>
  );
}
