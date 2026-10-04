import { createHash } from 'node:crypto';
import { createParamDecorator, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { verifyToken } from '@clerk/backend';
import { and, apiKeys, eq, isNull, users } from '@codereview/db';
import type { Db } from '@codereview/db';
import { API_KEY_PREFIX } from '@codereview/shared';
import { DB } from '../common/db.module.js';

export interface AuthUser {
  id: string;
  via: 'api_key' | 'clerk' | 'dev';
}

export const hashApiKey = (raw: string) => createHash('sha256').update(raw).digest('hex');

/**
 * One guard for both kinds of client:
 *  - MCP server: `Authorization: Bearer crk_...` (API key, stored hashed)
 *  - Dashboard:  `Authorization: Bearer <Clerk session JWT>`
 * With AUTH_DEV_BYPASS=true, a request without a token acts as a local "dev" user.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(DB) private readonly db: Db) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
    req.user = await this.resolve(token);
    return true;
  }

  private async resolve(token: string | undefined): Promise<AuthUser> {
    if (token?.startsWith(API_KEY_PREFIX)) {
      const [key] = await this.db
        .select()
        .from(apiKeys)
        .where(and(eq(apiKeys.keyHash, hashApiKey(token)), isNull(apiKeys.revokedAt)));
      if (!key) throw new UnauthorizedException('Invalid or revoked API key');
      await this.db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, key.id));
      return { id: key.userId, via: 'api_key' };
    }
    if (token && process.env.CLERK_SECRET_KEY) {
      try {
        const claims = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY });
        return { id: await this.upsertUser(claims.sub), via: 'clerk' };
      } catch {
        throw new UnauthorizedException('Invalid session');
      }
    }
    if (!token && process.env.AUTH_DEV_BYPASS === 'true') {
      return { id: await this.upsertUser('dev-user'), via: 'dev' };
    }
    throw new UnauthorizedException();
  }

  private async upsertUser(clerkId: string): Promise<string> {
    const [row] = await this.db
      .insert(users)
      .values({ clerkId })
      .onConflictDoUpdate({ target: users.clerkId, set: { clerkId } })
      .returning({ id: users.id });
    return row!.id;
  }
}

/** `@CurrentUser() user: AuthUser` in a controller protected by AuthGuard. */
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);
