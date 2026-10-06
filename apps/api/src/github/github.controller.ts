import { BadRequestException, Controller, Delete, Get, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard, CurrentUser } from '../auth/auth.guard.js';
import type { AuthUser } from '../auth/auth.guard.js';
import { GithubService } from './github.service.js';

const webUrl = () => (process.env.WEB_URL ?? 'http://localhost:3000').replace(/\/$/, '');

@Controller('api')
export class GithubController {
  constructor(private readonly github: GithubService) {}

  @Get('github/install-url')
  @UseGuards(AuthGuard)
  async installUrl(@CurrentUser() user: AuthUser) {
    return { url: await this.github.installUrl(user.id) };
  }

  /** Onboarding gate: has the signed-in user connected at least one GitHub installation? */
  @Get('github/connection')
  @UseGuards(AuthGuard)
  connection(@CurrentUser() user: AuthUser) {
    return this.github.connection(user.id);
  }

  /** What the setup wizard needs to know: is the GitHub App created, is there a webhook URL, is an LLM key set. */
  @Get('setup/status')
  @UseGuards(AuthGuard)
  setupStatus() {
    return this.github.setupStatus();
  }

  /**
   * Forget the current GitHub App (and its connected repos) to create a new one, e.g. under another
   * GitHub account. Demo limitation: any signed-in user can do this (single-tenant install).
   */
  @Delete('setup/github-app')
  @UseGuards(AuthGuard)
  resetApp() {
    return this.github.resetApp();
  }

  /** Step 1 of one-click setup: the manifest the browser submits to GitHub. */
  @Post('setup/github-app')
  @UseGuards(AuthGuard)
  manifest(@CurrentUser() user: AuthUser) {
    return this.github.manifest(user.id);
  }

  /**
   * Step 2: GitHub redirects the browser here with a one-time `code` after the user confirms the app.
   * We trade it for the credentials, then send the user straight on to install the app on their repos.
   */
  @Get('github/manifest-callback')
  async manifestCallback(@Query('code') code: string | undefined, @Query('state') state: string | undefined, @Res() res: Response) {
    const userId = await this.github.userIdFromState(state);
    if (!userId || !code) throw new BadRequestException('Invalid setup callback');
    await this.github.completeManifest(code);
    res.redirect(await this.github.installUrl(userId));
  }

  /**
   * GitHub App "Setup URL". The browser arrives here from GitHub without our auth header, so the
   * user is identified by the signed `state` created in install-url.
   * Without a valid state (repos changed from GitHub's own settings page, setup_action=update) the
   * repo list is still refreshed, but the installation is not linked to anyone new.
   * Demo limitation: installation_id itself is not proven to belong to that GitHub user.
   */
  @Get('github/callback')
  async callback(
    @Query('installation_id') installationId: string,
    @Query('state') state: string | undefined,
    @Res() res: Response,
  ) {
    if (!/^\d+$/.test(installationId ?? '')) throw new BadRequestException('Invalid callback');
    const userId = await this.github.userIdFromState(state);
    await this.github.syncInstallation(Number(installationId), userId ?? undefined);
    res.redirect(`${webUrl()}/dashboard/repos`);
  }
}
