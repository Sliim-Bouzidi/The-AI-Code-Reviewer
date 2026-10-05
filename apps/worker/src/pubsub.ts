import { Redis } from 'ioredis';
import { redisConnection } from '@codereview/shared';
import type { RealtimeEvent } from '@codereview/shared';

let client: Redis | null = null;

/**
 * Publishes a real-time event (Redis Pub/Sub). Fire-and-forget: if nobody is listening, or Redis
 * hiccups, nothing is lost, because the row is already in Postgres and the dashboard re-reads it.
 */
export async function publish(channel: string, event: RealtimeEvent): Promise<void> {
  try {
    client ??= new Redis(redisConnection());
    await client.publish(channel, JSON.stringify(event));
  } catch {
    // best effort
  }
}
