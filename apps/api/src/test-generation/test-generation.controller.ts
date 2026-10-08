import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser } from '../auth/auth.guard.js';
import type { AuthUser } from '../auth/auth.guard.js';
import { TestGenerationService } from './test-generation.service.js';

@Controller('api')
@UseGuards(AuthGuard)
export class TestGenerationController {
  constructor(private readonly testGenService: TestGenerationService) {}

  /**
   * GET /api/pull-requests/:prId/test-generations
   * Lists all test generation runs for a given pull request.
   */
  @Get('pull-requests/:prId/test-generations')
  async listForPullRequest(
    @CurrentUser() user: AuthUser,
    @Param('prId') prId: string,
  ) {
    return this.testGenService.listForPullRequest(user.id, prId);
  }

  /**
   * POST /api/pull-requests/:prId/test-generations
   * Manually triggers asynchronous test generation for a pull request.
   */
  @Post('pull-requests/:prId/test-generations')
  async triggerForPullRequest(
    @CurrentUser() user: AuthUser,
    @Param('prId') prId: string,
  ) {
    return this.testGenService.triggerForPullRequest(user.id, prId);
  }

  /**
   * GET /api/test-generations/:generationId
   * Retrieves details of a test generation run including generated tests list.
   */
  @Get('test-generations/:generationId')
  async getGenerationDetails(
    @CurrentUser() user: AuthUser,
    @Param('generationId') generationId: string,
  ) {
    return this.testGenService.getGenerationDetails(user.id, generationId);
  }

  /**
   * GET /api/test-generations/:generationId/status
   * Retrieves status & progress metrics for a test generation run.
   */
  @Get('test-generations/:generationId/status')
  async getGenerationStatus(
    @CurrentUser() user: AuthUser,
    @Param('generationId') generationId: string,
  ) {
    return this.testGenService.getGenerationStatus(user.id, generationId);
  }

  /**
   * GET /api/generated-tests/:testId
   * Retrieves details of an individual generated test case (source code, outputs, error details).
   */
  @Get('generated-tests/:testId')
  async getGeneratedTest(
    @CurrentUser() user: AuthUser,
    @Param('testId') testId: string,
  ) {
    return this.testGenService.getGeneratedTest(user.id, testId);
  }
}
