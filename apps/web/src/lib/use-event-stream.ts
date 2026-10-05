'use client';

import * as React from 'react';
import { API_URL } from './api';
import { useGetToken } from './auth';

/**
 * Subscribes to a Server-Sent Events endpoint of the API.
 *
 * Uses fetch + a stream reader instead of the browser's EventSource, because EventSource cannot
 * send the `Authorization` header (the Clerk session token). On the wire it is still plain SSE.
 * - `onReady` fires on every (re)connect: the caller re-reads the DB to catch up on missed events.
 * - Reconnects with backoff (1 s, 2 s, 4 s ... max 30 s) and gets a fresh token each time.
 * - Returns whether the stream is currently connected, so callers can fall back to polling.
 */
export function useEventStream<T>(
  path: string | null,
  onMessage: (event: T) => void,
  onReady?: () => void,
): boolean {
  const getToken = useGetToken();
  const [connected, setConnected] = React.useState(false);
  // keep the latest callbacks without reconnecting when they change
  const handlers = React.useRef({ onMessage, onReady });
  handlers.current = { onMessage, onReady };

  React.useEffect(() => {
    if (!path) return;
    const abort = new AbortController();
    let retry = 0;

    const run = async () => {
      while (!abort.signal.aborted) {
        try {
          const token = await getToken();
          const res = await fetch(API_URL + path, {
            headers: { accept: 'text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) },
            signal: abort.signal,
          });
          if (!res.ok || !res.body) throw new Error(`stream HTTP ${res.status}`);
          const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
          let buffer = '';
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += value;
            // SSE frames are separated by a blank line
            let end: number;
            while ((end = buffer.indexOf('\n\n')) !== -1) {
              const frame = buffer.slice(0, end);
              buffer = buffer.slice(end + 2);
              let event = 'message';
              const data: string[] = [];
              for (const line of frame.split('\n')) {
                if (line.startsWith('event:')) event = line.slice(6).trim();
                else if (line.startsWith('data:')) data.push(line.slice(5).trim());
                // lines starting with ':' are heartbeats
              }
              if (event === 'ready') {
                retry = 0;
                setConnected(true);
                handlers.current.onReady?.();
              } else if (data.length > 0) {
                try {
                  handlers.current.onMessage(JSON.parse(data.join('\n')) as T);
                } catch {
                  // ignore malformed frames
                }
              }
            }
          }
        } catch {
          // network error, 401, server restart: fall through to the backoff below
        }
        setConnected(false);
        if (abort.signal.aborted) return;
        await new Promise((r) => setTimeout(r, Math.min(30_000, 1_000 * 2 ** retry++)));
      }
    };
    void run();
    return () => abort.abort();
  }, [path, getToken]);

  return connected;
}
