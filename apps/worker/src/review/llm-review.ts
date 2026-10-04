import { generateJson } from '@codereview/llm';
import type { LlmProvider } from '@codereview/llm';
import { LlmReviewOutputSchema } from '@codereview/shared';
import type { CandidateFinding, CustomRule, Strictness } from '@codereview/shared';
import type { ContextChunk } from './context.js';
import { renderFileForLlm } from './diff.js';
import type { DiffFile } from './diff.js';

export const SYSTEM_PROMPT = `You are a senior engineer reviewing one file of a pull request.
Report only real problems in the CHANGED lines (marked "+"): bugs, security issues, performance
problems, and maintainability issues that matter. Do not praise, do not restate the diff, and do not
report something you cannot point to in the code. Use the "codebase context" to check how the
changed code is used elsewhere, but never report issues in the context itself.

Each diff line is prefixed with its line number in the new file. Use exactly those numbers.

Answer with ONLY a JSON object:
{
  "summary": "one sentence about this file's changes",
  "findings": [{
    "file": "path exactly as given",
    "line_start": 12,
    "line_end": 14,            // or null for a single line
    "severity": "critical" | "high" | "medium" | "low" | "info",
    "category": "bug" | "security" | "performance" | "style" | "maintainability",
    "message": "what is wrong and why it matters",
    "suggestion": "concrete fix, code if short" ,   // or null
    "confidence": 0.0-1.0
  }]
}
If there is nothing worth reporting, return "findings": [].`;

export function buildPrompt(
  file: DiffFile,
  context: ContextChunk[],
  rules: CustomRule[],
  strictness: Strictness,
): string {
  const parts = [`File: ${file.path} (${file.status})`, `Strictness: ${strictness}`];
  if (rules.length > 0) {
    parts.push('Project rules to enforce:\n' + rules.map((r) => `- [${r.severity}] ${r.rule}`).join('\n'));
  }
  if (context.length > 0) {
    parts.push(
      'Codebase context (existing code, for reference only):\n' +
        context
          .map((c) => `--- ${c.filePath}:${c.startLine ?? '?'}-${c.endLine ?? '?'} ${c.symbol ?? ''}\n${c.content}`)
          .join('\n'),
    );
  }
  parts.push('Diff to review:\n' + renderFileForLlm(file));
  return parts.join('\n\n');
}

export interface FileReviewResult {
  summary: string;
  findings: CandidateFinding[];
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
}

/** Step 6: one LLM call for one file, with schema-validated output. */
export async function reviewFile(
  llm: LlmProvider[],
  file: DiffFile,
  context: ContextChunk[],
  rules: CustomRule[],
  strictness: Strictness,
): Promise<FileReviewResult> {
  const res = await generateJson(llm, {
    system: SYSTEM_PROMPT,
    prompt: buildPrompt(file, context, rules, strictness),
    schema: LlmReviewOutputSchema,
  });
  return {
    summary: res.data.summary,
    provider: res.provider,
    model: res.model,
    tokensIn: res.tokensIn,
    tokensOut: res.tokensOut,
    findings: res.data.findings.map((f) => ({
      // the call is about one file, so a wrong/variant path from the model is corrected here
      filePath: file.path,
      lineStart: f.line_start,
      lineEnd: f.line_end ?? null,
      severity: f.severity,
      category: f.category,
      source: 'llm' as const,
      message: f.message,
      suggestion: f.suggestion ?? null,
      confidence: f.confidence,
    })),
  };
}
