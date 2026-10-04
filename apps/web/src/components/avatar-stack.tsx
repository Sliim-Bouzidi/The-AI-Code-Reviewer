'use client';

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  AvatarGroup,
  AvatarGroupCount,
} from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

export interface AvatarStackItem {
  name: string;
  src?: string;
  fallback?: string;
}

export interface AvatarStackProps {
  avatars: AvatarStackItem[];
  max?: number;
  className?: string;
}

function getInitials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function AvatarStack({ avatars, max = 4, className }: AvatarStackProps) {
  const visible = avatars.slice(0, max);
  const overflow = avatars.length - max;

  return (
    <AvatarGroup className={cn(className)}>
      {visible.map((avatar, i) => (
        <Avatar key={i} className='transition-transform hover:-translate-y-0.5 border border-white/10'>
          <AvatarImage src={avatar.src} alt={avatar.name} />
          <AvatarFallback className='bg-neutral-800 text-neutral-200 text-xs font-medium'>
            {avatar.fallback ?? getInitials(avatar.name)}
          </AvatarFallback>
        </Avatar>
      ))}
      {overflow > 0 && (
        <AvatarGroupCount className='text-foreground font-medium bg-neutral-900 border border-white/10 text-xs'>
          +{overflow}
        </AvatarGroupCount>
      )}
    </AvatarGroup>
  );
}

export const sampleAvatars: AvatarStackItem[] = [
  { name: 'Olivia Sparks', src: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop&crop=faces', fallback: 'OS' },
  { name: 'Hallie Richards', src: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop&crop=faces', fallback: 'HR' },
  { name: 'Howard Lloyd', src: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&h=100&fit=crop&crop=faces', fallback: 'HL' },
  { name: 'Jenny Wilson', src: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop&crop=faces', fallback: 'JW' },
  { name: 'Daniel Park', src: 'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=100&h=100&fit=crop&crop=faces', fallback: 'DP' },
  { name: 'Alice Morgan', src: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=100&h=100&fit=crop&crop=faces', fallback: 'AM' },
];

export function AvatarSocialProof({ className }: { className?: string }) {
  return (
    <div className={cn('bg-white/[0.04] backdrop-blur-md inline-flex flex-wrap items-center justify-center rounded-full border border-white/[0.08] px-3 py-1.5 shadow-sm', className)}>
      <AvatarStack avatars={sampleAvatars} max={4} />
      <p className='text-neutral-400 pl-3 pr-1 text-xs'>
        Trusted by <strong className='text-white font-semibold'>10,000+</strong> engineers & architects
      </p>
    </div>
  );
}
