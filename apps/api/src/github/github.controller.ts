import { BadRequestException, Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard, CurrentUser } from '../auth/auth.guard.js';
import type { AuthUser } from '../auth/auth.guard.js';
import { GithubService } from './github.service.js';

@Controller('api/github')
export class GithubController {
  constructor(private readonly github: GithubService) {}

  @Get('install-url')
  @UseGuards(AuthGuard)
  installUrl(@CurrentUser() user: AuthUser) {
    return { url: this.github.installUrl(user.id) };
  }

  /**
   * GitHub App "Setup URL". The browser arrives here from GitHub without our auth header, so the
   * user is identified by the signed `state` created in install-url.
   * Demo limitation: installation_id itself is not proven to belong to that GitHub user.
   */
  @Get('callback')
  async callback(
    @Query('installation_id') installationId: string,
    @Query('state') state: string | undefined,
    @Res() res: Response,
  ) {
    const userId = this.github.userIdFromState(state);
    if (!userId || !/^\d+$/.test(installationId ?? '')) throw new BadRequestException('Invalid callback');
    await this.github.syncInstallation(Number(installationId), userId);
    res.redirect(`${process.env.WEB_URL ?? 'http://localhost:3000'}/repos`);
  }
}
