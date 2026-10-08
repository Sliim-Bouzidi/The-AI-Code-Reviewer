import { eq, generatedTests, testGenerations } from '@codereview/db';
import type { Deps } from '../deps.js';
import { log } from '../deps.js';
import type { RepoRef } from '../github.js';
import { postOrUpdatePrComment } from '../github.js';

export const TEST_GEN_COMMENT_MARKER = '<!-- ai-code-review-test-generation -->';

export function formatStatusBadge(status: string): string {
  switch (status) {
    case 'PASSED':
      return '✅ PASSED';
    case 'FAILED':
    case 'TEST_FAILURE':
      return '❌ FAILED';
    case 'REJECTED':
    case 'COMPILE_ERROR':
      return '⚠️ COMPILE ERROR';
    case 'TIMEOUT':
      return '⌛ TIMEOUT';
    default:
      return `🚨 ${status}`;
  }
}

export interface SummaryGenerationRecord {
  id: string;
  status: string;
  message: string | null;
}

export interface SummaryTestItemRecord {
  sourceFile: string;
  className: string;
  methodName: string;
  testClassName: string;
  status: string;
}

export function formatTestGenerationMarkdown(
  generation: SummaryGenerationRecord,
  tests: SummaryTestItemRecord[],
): string {
  if (generation.status === 'failed') {
    return `${TEST_GEN_COMMENT_MARKER}
## 🤖 Automatic Test Generation — Failed

⚠️ **Automatic test generation encountered an unrecoverable error.**

* **Generation ID:** \`${generation.id}\`
* **Cause:** ${generation.message ?? 'Unknown processing error'}

*Please trigger a new generation from the dashboard or check worker logs.*
`;
  }

  const total = tests.length;
  const passed = tests.filter((t) => t.status === 'PASSED').length;
  const compileErrors = tests.filter((t) => t.status === 'REJECTED').length;
  const testFailures = tests.filter((t) => t.status === 'FAILED').length;
  const timeouts = tests.filter((t) => t.status === 'TIMEOUT').length;

  let tableRows = '';
  if (tests.length === 0) {
    tableRows = '_No Java test classes generated for modified methods._\n';
  } else {
    tableRows = `| File | Class | Method | Test Class | Status |
| --- | --- | --- | --- | --- |
${tests
  .map(
    (t) =>
      `| \`${t.sourceFile}\` | \`${t.className}\` | \`${t.methodName}()\` | \`${t.testClassName}\` | ${formatStatusBadge(t.status)} |`,
  )
  .join('\n')}
`;
  }

  return `${TEST_GEN_COMMENT_MARKER}
## 🤖 Automatic Test Generation

* **Methods analyzed:** ${total}
* **Tests generated:** ${total}
* **Passed:** ${passed}
* **Compile errors:** ${compileErrors}
* **Test failures:** ${testFailures}
* **Timeouts:** ${timeouts}

### Generated tests

${tableRows}`;
}

/**
 * Publishes or updates the GitHub PR summary comment for a test generation run.
 * Isolated error handling: Errors connecting to GitHub do NOT crash or fail the DB transaction.
 */
export async function publishTestGenerationToGithub(
  deps: Deps,
  params: {
    ref: RepoRef;
    prNumber: number;
    generationId: string;
  },
): Promise<boolean> {
  const { db } = deps;

  try {
    const [gen] = await db
      .select()
      .from(testGenerations)
      .where(eq(testGenerations.id, params.generationId));

    if (!gen) {
      log('test-gen-gh', 'generation record not found', { generationId: params.generationId });
      return false;
    }

    if (!['completed', 'failed'].includes(gen.status)) {
      return false;
    }

    const testsList = await db
      .select()
      .from(generatedTests)
      .where(eq(generatedTests.generationId, params.generationId));

    const markdown = formatTestGenerationMarkdown(gen, testsList);

    await postOrUpdatePrComment(params.ref, params.prNumber, TEST_GEN_COMMENT_MARKER, markdown);

    if (testsList.length > 0) {
      await db
        .update(generatedTests)
        .set({ postedToGithub: true, updatedAt: new Date() })
        .where(eq(generatedTests.generationId, params.generationId));
    }

    log('test-gen-gh', 'github summary posted successfully', { prId: gen.prId, generationId: gen.id });
    return true;
  } catch (err: any) {
    log('test-gen-gh', 'failed to post github summary comment', {
      generationId: params.generationId,
      error: err.message,
    });
    return false;
  }
}
