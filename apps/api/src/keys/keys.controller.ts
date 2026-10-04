import { randomBytes } from 'node:crypto';
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { and, apiKeys, eq } from '@codereview/db';
import type { Db } from '@codereview/db';
import { API_KEY_PREFIX, CreateApiKeyBodySchema } from '@codereview/shared';
import { AuthGuard, CurrentUser, hashApiKey } from '../auth/auth.guard.js';
import type { AuthUser } from '../auth/auth.guard.js';
import { DB } from '../common/db.module.js';
import { ZodPipe } from '../common/zod.pipe.js';

const columns = {
  id: apiKeys.id,
  name: apiKeys.name,
  prefix: apiKeys.prefix,
  lastUsedAt: apiKeys.lastUsedAt,
  revokedAt: apiKeys.revokedAt,
};

@Controller('api/keys')
@UseGuards(AuthGuard)
export class KeysController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.db.select(columns).from(apiKeys).where(eq(apiKeys.userId, user.id));
  }

  /** The raw key is in this response only; the database keeps a SHA-256 hash. */
  @Post()
  async create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(CreateApiKeyBodySchema)) body: { name: string }) {
    const key = API_KEY_PREFIX + randomBytes(24).toString('base64url');
    const [row] = await this.db
      .insert(apiKeys)
      .values({ userId: user.id, name: body.name, prefix: key.slice(0, 12), keyHash: hashApiKey(key) })
      .returning(columns);
    return { ...row!, key };
  }

  @Delete(':id')
  @HttpCode(204)
  async revoke(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return;
    await this.db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, user.id)));
  }
}
