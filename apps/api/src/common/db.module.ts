import { Global, Module } from '@nestjs/common';
import { createDb } from '@codereview/db';

/** Injection token for the Drizzle client: `@Inject(DB) private readonly db: Db`. */
export const DB = Symbol('DB');

@Global()
@Module({
  providers: [{ provide: DB, useFactory: () => createDb() }],
  exports: [DB],
})
export class DbModule {}
