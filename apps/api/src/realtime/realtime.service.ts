import { Injectable } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Redis } from 'ioredis';
import { redisConnection } from '@codereview/shared';

type Listener = (message: string) => void;

const HEARTBEAT_MS = 25_000;

/**
 * Real-time gateway: ONE Redis subscriber connection for the whole API process, fanned out to the
 * SSE connections that care about each channel. A channel is subscribed in Redis when its first
 * listener arrives and unsubscribed when its last one leaves.
 */
@Injectable()
export class RealtimeService implements OnModuleDestroy {
  private sub: Redis | null = null;
  private readonly listeners = new Map<string, Set<Listener>>();

  private subscriber(): Redis {
    if (!this.sub) {
      this.sub = new Redis(redisConnection());
      this.sub.on('message', (channel: string, message: string) => {
        for (const listener of this.listeners.get(channel) ?? []) listener(message);
      });
    }
    return this.sub;
  }

  private async on(channel: string, listener: Listener): Promise<() => void> {
    let set = this.listeners.get(channel);
    if (!set) {
      set = new Set();
      this.listeners.set(channel, set);
      await this.subscriber().subscribe(channel);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) {
        this.listeners.delete(channel);
        void this.subscriber().unsubscribe(channel);
      }
    };
  }

  /**
   * Turns an HTTP response into a Server-Sent Events stream of one Redis channel.
   * Sends a `ready` event first (the client then re-reads the DB to catch up on anything missed
   * while disconnected), a comment line every 25 s as a heartbeat, and cleans up on disconnect.
   */
  async stream(req: Request, res: Response, channel: string): Promise<void> {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no', // no proxy buffering
    });
    const send = (event: string, data: string) => res.write(`event: ${event}\ndata: ${data}\n\n`);
    send('ready', '{}');

    const off = await this.on(channel, (message) => send('message', message));
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    req.on('close', () => {
      clearInterval(heartbeat);
      off();
    });
  }

  async onModuleDestroy() {
    await this.sub?.quit();
  }
}
