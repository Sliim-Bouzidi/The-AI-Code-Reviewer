import { generateJson } from '@codereview/llm';
import type { GenerateJsonResult, LlmProvider } from '@codereview/llm';
import { LlmTestOutputSchema } from '@codereview/shared';
import type { LlmTestOutput } from '@codereview/shared';
import type { JavaMethodContext } from './java-context.js';

export const TEST_GEN_SYSTEM_PROMPT = `You are an expert Java developer specializing in writing unit tests using JUnit 5 and Mockito.
Your task is to generate complete, compilable, and isolated JUnit 5 unit tests for a modified Java method.

Strict Rules:
1. Framework: Use ONLY JUnit 5 (org.junit.jupiter.api.*) and Mockito (org.mockito.*). Do NOT use JUnit 4 (org.junit.Test, org.junit.Assert, etc.).
2. No Hallucinated APIs: Use only APIs, methods, constructors, and dependencies that can be inferred from the provided source context. If required information is missing, do not invent it.
3. Quality:
   - Generate tests covering NORMAL cases (valid inputs), EDGE_CASEs (boundary values, nulls, empty collections), and ERROR cases (expected exceptions) where relevant to the method's logic.
   - All tests must be self-contained and isolated.
   - Use explicit assertion messages and descriptive test method names (e.g. shouldCreateUserSuccessfully).
   - Do NOT include TODO comments, placeholders, or pseudo-code.
   - Do NOT include markdown formatting or triple backticks in testCode.
4. Security & Privacy: Do not transmit or leak any secrets, credentials, API keys, or environment variables in the test code.
5. Output Format: Answer with ONLY a JSON object matching the requested schema.`;

/**
 * Builds a deterministic prompt for the LLM based on a JavaMethodContext.
 * Contains all required fields: className, methodName, signature, methodCode, imports, classContext, diffSnippet.
 */
export function buildTestGenerationPrompt(ctx: JavaMethodContext): string {
  const parts: string[] = [
    `Target Class: ${ctx.className}`,
    `Target Method: ${ctx.methodName}`,
    `Signature: ${ctx.signature}`,
    `Return Type: ${ctx.returnType}`,
    `File Path: ${ctx.filePath}`,
  ];

  if (ctx.annotations.length > 0) {
    parts.push(`Method Annotations: ${ctx.annotations.join(', ')}`);
  }

  if (ctx.imports.length > 0) {
    parts.push(`File Imports:\n${ctx.imports.join('\n')}`);
  }

  if (ctx.classContext.trim().length > 0) {
    parts.push(`Surrounding Class Context:\n${ctx.classContext}`);
  }

  parts.push(`Modified Method Source Code:\n${ctx.methodCode}`);

  if (ctx.diffSnippet.trim().length > 0) {
    parts.push(`Diff Hunk (Modified Lines):\n${ctx.diffSnippet}`);
  }

  parts.push(
    `Generate JUnit 5 + Mockito unit tests for the method "${ctx.methodName}" in class "${ctx.className}".\n` +
      `Return a JSON object matching the schema with fields: testClassName, imports, annotations, testCode, and tests.`,
  );

  return parts.join('\n\n');
}

/**
 * Generates JUnit 5 + Mockito test code for a single Java method using the configured LLM providers.
 * Output is strictly parsed and validated against LlmTestOutputSchema via Zod.
 *
 * @param llm     - Configured LLM provider fallback list.
 * @param context - The extracted JavaMethodContext.
 * @returns       - Validated LlmTestOutput result with token counts and provider info.
 */
export async function generateTestForMethod(
  llm: LlmProvider[],
  context: JavaMethodContext,
): Promise<GenerateJsonResult<LlmTestOutput>> {
  const prompt = buildTestGenerationPrompt(context);
  return generateJson(llm, {
    system: TEST_GEN_SYSTEM_PROMPT,
    prompt,
    schema: LlmTestOutputSchema,
  });
}
