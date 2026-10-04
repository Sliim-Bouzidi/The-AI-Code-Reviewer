import { BadRequestException } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/** Validates a body/query against a shared Zod schema: `@Body(new ZodPipe(Schema))`. */
export class ZodPipe<S extends z.ZodTypeAny> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      throw new BadRequestException({ message: 'Validation failed', issues: parsed.error.issues });
    }
    return parsed.data;
  }
}
