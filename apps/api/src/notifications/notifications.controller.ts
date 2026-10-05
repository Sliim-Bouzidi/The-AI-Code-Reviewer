import { Controller, Get, HttpCode, Inject, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { and, count, desc, eq, isNull, notifications } from '@codereview/db';
import type { Db } from '@codereview/db';
import { CHANNELS } from '@codereview/shared';
import { AuthGuard, CurrentUser } from '../auth/auth.guard.js';
import type { AuthUser } from '../auth/auth.guard.js';
import { DB } from '../common/db.module.js';
import { RealtimeService } from '../realtime/realtime.service.js';

/** Dashboard notifications. Written by the worker (DB + Redis publish); pushed to the dashboard over SSE. */
@Controller('api/notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly realtime: RealtimeService,
  ) {}

  /** Real-time stream (SSE) of this user's new notifications. */
  @Get('stream')
  stream(@CurrentUser() user: AuthUser, @Req() req: Request, @Res() res: Response) {
    return this.realtime.stream(req, res, CHANNELS.user(user.id));
  }

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const items = await this.db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, user.id))
      .orderBy(desc(notifications.createdAt))
      .limit(30);
    const [unread] = await this.db
      .select({ n: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));
    return { items, unread: unread?.n ?? 0 };
  }

  @Post('read-all')
  @HttpCode(204)
  async readAll(@CurrentUser() user: AuthUser) {
    await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));
  }

  @Post(':id/read')
  @HttpCode(204)
  async read(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return;
    await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.userId, user.id)));
  }
}
