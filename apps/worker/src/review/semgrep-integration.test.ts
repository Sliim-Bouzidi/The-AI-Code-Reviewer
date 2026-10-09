import { describe, expect, it, vi } from 'vitest';
import * as llmPackage from '@codereview/llm';
import type { CandidateFinding, SemgrepAlert } from '@codereview/shared';
import { parseUnifiedDiff } from './diff.js';
import { buildPrompt, reviewFile } from './llm-review.js';
import { validateAndRank } from './validate.js';

describe('Step 2 - Semgrep Integration into LLM Analysis', () => {
  const diffText = `diff --git a/src/auth.ts b/src/auth.ts
index 1111111..2222222 100644
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -10,3 +10,4 @@ function login(user: string) {
   const a = 1;
+  const query = "SELECT * FROM users WHERE name = '" + user + "'";
+  db.query(query);
   return true;
}`;

  const files = parseUnifiedDiff(diffText);
  const file = files[0]!;

  const sampleAlert: SemgrepAlert = {
    id: 'semgrep-src/auth.ts-11-1',
    ruleId: 'rules.javascript.sqli',
    filePath: 'src/auth.ts',
    lineStart: 11,
    lineEnd: 12,
    severity: 'high',
    category: 'security',
    message: 'SQL injection vulnerability detected',
  };

  const sampleAlertOtherFile: SemgrepAlert = {
    id: 'semgrep-src/other.ts-5-1',
    ruleId: 'rules.javascript.xss',
    filePath: 'src/other.ts',
    lineStart: 5,
    lineEnd: null,
    severity: 'medium',
    category: 'security',
    message: 'Potential XSS vulnerability',
  };

  // Test 1: Semgrep alert is transmitted to LLM prompt
  it('1. transmits Semgrep alert details to the LLM prompt', () => {
    const prompt = buildPrompt(file, [], [], 'medium', { semgrepAlerts: [sampleAlert] });
    expect(prompt).toContain('Semgrep static analysis alerts to verify for this file');
    expect(prompt).toContain('[alert_id: "semgrep-src/auth.ts-11-1"]');
    expect(prompt).toContain('Rule: "rules.javascript.sqli"');
    expect(prompt).toContain('SQL injection vulnerability detected');
    expect(prompt).toContain('high severity');
  });

  // Test 2: LLM receives Step 1 targeted context AND corresponding alert
  it('2. includes both Step 1 targeted context and Semgrep alert in the prompt', () => {
    const fileContent = Array.from({ length: 9 }, (_, i) => `// Line ${i + 1}`)
      .concat([
        'function login(user: string) {',
        '  const a = 1;',
        '  const query = "SELECT * FROM users WHERE name = \'" + user + "\'";',
        '  db.query(query);',
        '  return true;',
        '}',
      ])
      .join('\n');
    const prompt = buildPrompt(file, [], [], 'medium', {
      fileContent,
      semgrepAlerts: [sampleAlert],
    });

    expect(prompt).toContain('--- src/auth.ts:');
    expect(prompt).toContain('12 +   const query = "SELECT * FROM users WHERE name = \'" + user + "\'";');
    expect(prompt).toContain('Semgrep static analysis alerts to verify for this file');
    expect(prompt).toContain('semgrep-src/auth.ts-11-1');
  });

  // Test 3: CONFIRMED response keeps alert with ID
  it('3. keeps alert with its ID when LLM decision is CONFIRMED', async () => {
    const generateJsonSpy = vi.spyOn(llmPackage, 'generateJson').mockResolvedValueOnce({
      data: {
        summary: 'Reviewed auth.ts',
        findings: [],
        semgrep_decisions: [
          {
            alert_id: 'semgrep-src/auth.ts-11-1',
            decision: 'CONFIRMED',
            reason: 'User input is concatenated into raw SQL string',
          },
        ],
      },
      provider: 'test-provider',
      model: 'test-model',
      tokensIn: 100,
      tokensOut: 50,
    });

    const result = await reviewFile([], file, [], [], 'medium', { semgrepAlerts: [sampleAlert] });
    expect(generateJsonSpy).toHaveBeenCalledOnce();

    const semgrepFinding = result.findings.find((f) => f.source === 'semgrep');
    expect(semgrepFinding).toBeDefined();
    expect(semgrepFinding?.semgrepDecision).toBe('CONFIRMED');
    expect(semgrepFinding?.semgrepReason).toContain('User input is concatenated');
    expect(semgrepFinding?.ruleId).toBe('rules.javascript.sqli');

    // Verify validateAndRank keeps confirmed alert
    const kept = validateAndRank(result.findings, files, { strictness: 'medium', maxComments: 10 });
    expect(kept).toHaveLength(1);
    expect(kept[0]?.source).toBe('semgrep');

    generateJsonSpy.mockRestore();
  });

  // Test 4: REJECTED response is properly represented in results (filtered out of final posted comments)
  it('4. represents REJECTED response in candidate findings and drops it from posted findings', async () => {
    const generateJsonSpy = vi.spyOn(llmPackage, 'generateJson').mockResolvedValueOnce({
      data: {
        summary: 'Reviewed auth.ts',
        findings: [],
        semgrep_decisions: [
          {
            alert_id: 'semgrep-src/auth.ts-11-1',
            decision: 'REJECTED',
            reason: 'Input is sanitized upstream by type checker',
          },
        ],
      },
      provider: 'test-provider',
      model: 'test-model',
      tokensIn: 100,
      tokensOut: 50,
    });

    const result = await reviewFile([], file, [], [], 'medium', { semgrepAlerts: [sampleAlert] });
    const semgrepFinding = result.findings.find((f) => f.source === 'semgrep');

    expect(semgrepFinding).toBeDefined();
    expect(semgrepFinding?.semgrepDecision).toBe('REJECTED');
    expect(semgrepFinding?.semgrepReason).toContain('sanitized upstream');

    // validateAndRank drops REJECTED findings
    const kept = validateAndRank(result.findings, files, { strictness: 'medium', maxComments: 10 });
    expect(kept).toHaveLength(0);

    generateJsonSpy.mockRestore();
  });

  // Test 5: UNCERTAIN response does not drop the alert
  it('5. does not drop alert when LLM decision is UNCERTAIN', async () => {
    const generateJsonSpy = vi.spyOn(llmPackage, 'generateJson').mockResolvedValueOnce({
      data: {
        summary: 'Reviewed auth.ts',
        findings: [],
        semgrep_decisions: [
          {
            alert_id: 'semgrep-src/auth.ts-11-1',
            decision: 'UNCERTAIN',
            reason: 'Cannot verify if user string is sanitized elsewhere',
          },
        ],
      },
      provider: 'test-provider',
      model: 'test-model',
      tokensIn: 100,
      tokensOut: 50,
    });

    const result = await reviewFile([], file, [], [], 'medium', { semgrepAlerts: [sampleAlert] });
    const semgrepFinding = result.findings.find((f) => f.source === 'semgrep');

    expect(semgrepFinding?.semgrepDecision).toBe('UNCERTAIN');

    // validateAndRank keeps UNCERTAIN alert
    const kept = validateAndRank(result.findings, files, { strictness: 'medium', maxComments: 10 });
    expect(kept).toHaveLength(1);
    expect(kept[0]?.source).toBe('semgrep');

    generateJsonSpy.mockRestore();
  });

  // Test 6: Failure/timeout/invalid response preserves original alert
  it('6. preserves original Semgrep alert if LLM fails or throws an error', async () => {
    const generateJsonSpy = vi.spyOn(llmPackage, 'generateJson').mockRejectedValueOnce(new Error('LLM Rate Limit Exceeded'));

    const result = await reviewFile([], file, [], [], 'medium', { semgrepAlerts: [sampleAlert] });

    expect(result.findings).toHaveLength(1);
    const semgrepFinding = result.findings[0]!;
    expect(semgrepFinding.source).toBe('semgrep');
    expect(semgrepFinding.semgrepDecision).toBe('UNCERTAIN');
    expect(semgrepFinding.semgrepReason).toContain('LLM');

    const kept = validateAndRank(result.findings, files, { strictness: 'medium', maxComments: 10 });
    expect(kept).toHaveLength(1);

    generateJsonSpy.mockRestore();
  });

  // Test 7: Alert from another file is not attributed to current file
  it('7. does not include Semgrep alerts for other files in the current prompt', () => {
    const prompt = buildPrompt(file, [], [], 'medium', {
      semgrepAlerts: [sampleAlert, sampleAlertOtherFile],
    });

    expect(prompt).toContain('semgrep-src/auth.ts-11-1');
    expect(prompt).not.toContain('semgrep-src/other.ts-5-1');
    expect(prompt).not.toContain('Potential XSS vulnerability');
  });

  // Test 8: Line numbers and severity remain correct
  it('8. retains original line numbers, severity, and category in evaluated findings', async () => {
    const generateJsonSpy = vi.spyOn(llmPackage, 'generateJson').mockResolvedValueOnce({
      data: {
        summary: 'Reviewed auth.ts',
        findings: [],
        semgrep_decisions: [{ alert_id: 'semgrep-src/auth.ts-11-1', decision: 'CONFIRMED', reason: 'Valid' }],
      },
      provider: 'test-provider',
      model: 'test-model',
      tokensIn: 100,
      tokensOut: 50,
    });

    const result = await reviewFile([], file, [], [], 'medium', { semgrepAlerts: [sampleAlert] });
    const semgrepFinding = result.findings.find((f) => f.source === 'semgrep')!;

    expect(semgrepFinding.lineStart).toBe(11);
    expect(semgrepFinding.lineEnd).toBe(12);
    expect(semgrepFinding.severity).toBe('high');
    expect(semgrepFinding.category).toBe('security');

    generateJsonSpy.mockRestore();
  });

  // Test 9: Merged results remain compatible with existing consumers
  it('9. produces candidate findings compatible with pipeline consumers', () => {
    const llmFinding: CandidateFinding = {
      filePath: 'src/auth.ts',
      lineStart: 11,
      lineEnd: null,
      severity: 'high',
      category: 'security',
      source: 'llm',
      message: 'Unsanitized query string',
      suggestion: 'Use parametrized query',
      confidence: 0.9,
    };

    const semgrepFinding: CandidateFinding = {
      filePath: 'src/auth.ts',
      lineStart: 11,
      lineEnd: 12,
      severity: 'high',
      category: 'security',
      source: 'semgrep',
      message: 'SQL injection vulnerability',
      suggestion: null,
      confidence: 0.95,
      ruleId: 'rules.javascript.sqli',
      semgrepDecision: 'CONFIRMED',
      semgrepReason: 'Verified by LLM',
    };

    const kept = validateAndRank([llmFinding, semgrepFinding], files, { strictness: 'medium', maxComments: 10 });
    expect(kept).toHaveLength(1);
    expect(kept[0]?.filePath).toBe('src/auth.ts');
    expect(kept[0]?.lineStart).toBe(11);
    expect(kept[0]?.suggestion).toBe('Use parametrized query');
  });
});
