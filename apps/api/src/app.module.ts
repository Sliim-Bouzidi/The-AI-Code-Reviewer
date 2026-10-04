import { Controller, Get, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUES, redisConnection } from '@codereview/shared';
import { AuthGuard } from './auth/auth.guard.js';
import { DbModule } from './common/db.module.js';
import { GithubController } from './github/github.controller.js';
import { GithubService } from './github/github.service.js';
import { WebhookController } from './github/webhook.controller.js';
import { KeysController } from './keys/keys.controller.js';
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
    BullModule.registerQueue({ name: QUEUES.REVIEW }, { name: QUEUES.INDEX }),
  ],
  controllers: [HealthController, WebhookController, GithubController, ReposController, ReviewsController, KeysController],
  providers: [AuthGuard, GithubService, ReposService],
})
export class AppModule {}
