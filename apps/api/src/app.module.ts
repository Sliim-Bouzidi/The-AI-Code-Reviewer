import { Controller, Get, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUES, redisConnection } from '@codereview/shared';
import { AuthGuard } from './auth/auth.guard.js';
import { ClerkSetupController } from './auth/clerk-setup.controller.js';
import { DbModule } from './common/db.module.js';
import { EvalsController } from './evals/evals.controller.js';
import { GithubController } from './github/github.controller.js';
import { GithubService } from './github/github.service.js';
import { WebhookController } from './github/webhook.controller.js';
import { KeysController } from './keys/keys.controller.js';
import { NotificationsController } from './notifications/notifications.controller.js';
import { RealtimeService } from './realtime/realtime.service.js';
import { LlmSettingsController } from './settings/llm-settings.controller.js';
import { ReposController } from './repos/repos.controller.js';
import { ReposService } from './repos/repos.service.js';
import { ReviewsController } from './reviews/reviews.controller.js';

@Controller('health')
class HealthController {
  @Get()
  health() {
    return { ok: true };
  }
}

@Module({
  imports: [
    DbModule,
    BullModule.forRootAsync({ useFactory: () => ({ connection: redisConnection() }) }),
    BullModule.registerQueue({ name: QUEUES.REVIEW }, { name: QUEUES.INDEX }, { name: QUEUES.EVAL }),
  ],
  controllers: [
    HealthController, WebhookController, GithubController, ReposController, ReviewsController, KeysController,
    NotificationsController, LlmSettingsController, EvalsController, ClerkSetupController,
  ],
  providers: [AuthGuard, GithubService, ReposService, RealtimeService],
})
export class AppModule {}
