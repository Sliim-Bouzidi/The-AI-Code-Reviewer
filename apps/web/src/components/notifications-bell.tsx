'use client';

import { IconAlertTriangle, IconBell, IconCircleCheck, IconDatabase } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useApi } from '@/lib/api';
import type { AppNotification } from '@/lib/api';
import { useEventStream } from '@/lib/use-event-stream';
import { timeAgo } from '@/lib/utils';
import type { RealtimeEvent } from '@codereview/shared';

function KindIcon({ kind }: { kind: AppNotification['kind'] }) {
  if (kind === 'review_failed' || kind === 'index_failed') return <IconAlertTriangle className='size-4 shrink-0 text-red-500' />;
  if (kind === 'index_ready') return <IconDatabase className='size-4 shrink-0 text-sky-500' />;
  return <IconCircleCheck className='size-4 shrink-0 text-emerald-500' />;
}

/** Header bell: unread count, recent notifications, and a toast the moment a new one arrives (SSE). */
export function NotificationsBell() {
  const api = useApi();
  const qc = useQueryClient();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const box = React.useRef<HTMLDivElement>(null);
  const seen = React.useRef<Set<string> | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] });

  // Real-time: the API pushes each new notification over SSE (Redis Pub/Sub behind it). On every
  // (re)connect we re-read the list from the database, so nothing missed while offline is lost.
  const live = useEventStream<RealtimeEvent>('/api/notifications/stream', (e) => {
    if (e.type === 'notification') refresh();
  }, refresh);

  // polling only as a safety net while the stream is down
  const list = useQuery({
    queryKey: ['notifications'],
    queryFn: api.notifications,
    refetchInterval: live ? false : 30_000,
  });
  const readOne = useMutation({ mutationFn: api.readNotification, onSuccess: refresh });
  const readAll = useMutation({ mutationFn: api.readAllNotifications, onSuccess: refresh });

  const openItem = (n: AppNotification) => {
    if (!n.readAt) readOne.mutate(n.id);
    setOpen(false);
    if (n.link) router.push(n.link);
  };

  // toast only for notifications that arrive while the page is open (not the backlog on first load)
  React.useEffect(() => {
    const items = list.data?.items;
    if (!items) return;
    if (seen.current === null) {
      seen.current = new Set(items.map((n) => n.id));
      return;
    }
    for (const n of items) {
      if (seen.current.has(n.id)) continue;
      seen.current.add(n.id);
      const show = n.kind.endsWith('failed') ? toast.error : toast.success;
      show(n.title, { description: n.body ?? undefined, action: n.link ? { label: 'Open', onClick: () => openItem(n) } : undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.data]);

  // close when clicking outside or pressing Escape
  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const unread = list.data?.unread ?? 0;
  const items = list.data?.items ?? [];

  return (
    <div ref={box} className='relative'>
      <Button
        variant='secondary'
        size='icon'
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className='relative'
      >
        <IconBell />
        {unread > 0 && (
          <span className='absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white tabular-nums'>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </Button>

      {open && (
        <div className='bg-popover text-popover-foreground absolute right-0 z-50 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border shadow-lg'>
          <div className='flex items-center justify-between border-b px-4 py-3'>
            <span className='text-sm font-medium'>Notifications</span>
            {unread > 0 && (
              <button className='text-muted-foreground hover:text-foreground text-xs' onClick={() => readAll.mutate()}>
                Mark all as read
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className='text-muted-foreground px-4 py-8 text-center text-sm'>
              Nothing yet. You will be notified when a review or an index finishes.
            </p>
          ) : (
            <ul className='max-h-96 overflow-y-auto'>
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => openItem(n)}
                    className={`hover:bg-muted/60 flex w-full items-start gap-3 border-b px-4 py-3 text-left last:border-b-0 ${n.readAt ? 'opacity-60' : ''}`}
                  >
                    <KindIcon kind={n.kind} />
                    <span className='min-w-0 flex-1'>
                      <span className='block truncate text-sm font-medium'>{n.title}</span>
                      {n.body && <span className='text-muted-foreground line-clamp-2 block text-xs'>{n.body}</span>}
                      <span className='text-muted-foreground mt-1 block text-[11px]'>{timeAgo(n.createdAt)}</span>
                    </span>
                    {!n.readAt && <span className='mt-1.5 size-2 shrink-0 rounded-full bg-sky-500' aria-label='unread' />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
