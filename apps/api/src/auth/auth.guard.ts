import { createHash } from 'node:crypto';
import { createParamDecorator, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { verifyToken } from '@clerk/backend';
import { and, apiKeys, eq, isNull, users } from '@codereview/db';
import type { Db } from '@codereview/db';
import { API_KEY_PREFIX } from '@codereview/shared';
import { DB } from '../common/db.module.js';
import { getClerkKeys } from './clerk-keys.js';

export interface AuthUser {
  id: string;
  via: 'api_key' | 'clerk';
}

export const hashApiKey = (raw: string) => createHash('sha256').update(raw).digest('hex');

/**
 * One guard for both kinds of client:
 *  - MCP server: `Authorization: Bearer crk_...` (API key, stored hashed)
 *  - Dashboard:  `Authorization: Bearer <Clerk session JWT>`
 * Sign-in is mandatory: there is no anonymous or "dev user" mode. Until Clerk keys exist (.env or
 * pasted on the setup page, see clerk-keys.ts) nobody can sign in, and only API keys (MCP) are accepted.
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
    const clerk = getClerkKeys();
    if (token && clerk) {
      try {
        const claims = await verifyToken(token, { secretKey: clerk.secretKey });
        return { id: await this.upsertUser(claims.sub), via: 'clerk' };
      } catch {
        throw new UnauthorizedException('Invalid session');
      }
    }
    throw new UnauthorizedException(
      clerk ? 'Sign in required' : 'Sign-in is not configured yet: add the Clerk keys on the sign-in page',
    );
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
