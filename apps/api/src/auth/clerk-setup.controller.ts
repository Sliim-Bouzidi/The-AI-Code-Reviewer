import { BadRequestException, Body, ConflictException, Controller, Get, Post } from '@nestjs/common';
import { ClerkKeysBodySchema } from '@codereview/shared';
import type { ClerkKeysBody } from '@codereview/shared';
import { ZodPipe } from '../common/zod.pipe.js';
import { frontendApiOf, getClerkKeys, saveClerkKeys } from './clerk-keys.js';

/**
 * First-run setup of sign-in: paste the two Clerk keys on the sign-in page instead of editing `.env`
 * and rebuilding. Deliberately unauthenticated (nobody can sign in yet), so it only works while no
 * Clerk keys exist; afterwards it refuses. Like any first-run installer, do it before exposing the
 * app to other people.
 */
@Controller('api/setup/clerk')
export class ClerkSetupController {
  @Get()
  status() {
    const keys = getClerkKeys();
    return { configured: !!keys, source: keys?.source ?? null };
  }

  @Post()
  async save(@Body(new ZodPipe(ClerkKeysBodySchema)) body: ClerkKeysBody) {
    if (getClerkKeys()) throw new ConflictException('Sign-in is already configured.');
    const publishableKey = body.publishableKey.trim();
    const secretKey = body.secretKey.trim();

    const frontendApi = frontendApiOf(publishableKey);
    if (!frontendApi) throw new BadRequestException('The publishable key should start with pk_test_ or pk_live_.');
    if (!/^sk_(test|live)_\w+/.test(secretKey)) throw new BadRequestException('The secret key should start with sk_test_ or sk_live_.');
    if (publishableKey.split('_')[1] !== secretKey.split('_')[1]) {
      throw new BadRequestException('One key is a test key and the other a live key: copy both from the same Clerk instance.');
    }

    // ask Clerk whether the secret key is real, and whether both keys are from the same application
    let res: Response;
    try {
      res = await fetch('https://api.clerk.com/v1/domains', { headers: { authorization: `Bearer ${secretKey}` } });
    } catch {
      throw new BadRequestException('Could not reach Clerk to check the keys. Check the internet connection and try again.');
    }
    if (res.status === 401 || res.status === 403) throw new BadRequestException('Clerk rejected the secret key. Copy it again from the Clerk dashboard (API keys).');
    if (res.ok) {
      const data = (await res.json().catch(() => null)) as { data?: { frontend_api_url?: string }[] } | null;
      const hosts = (data?.data ?? []).map((d) => d.frontend_api_url ?? '');
      if (hosts.length > 0 && !hosts.some((h) => h.includes(frontendApi))) {
        throw new BadRequestException('These two keys belong to different Clerk applications. Copy both from the same application.');
      }
    }

    saveClerkKeys(publishableKey, secretKey);
    return { configured: true };
  }
}
