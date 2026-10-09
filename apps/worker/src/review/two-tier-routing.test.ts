import { describe, expect, it, vi } from 'vitest';
import * as llmPackage from '@codereview/llm';
import type { LlmProvider } from '@codereview/llm';
import type { CandidateFinding, SemgrepAlert } from '@codereview/shared';
import { createTwoTierProvidersFromEnv } from '@codereview/llm';
import { parseUnifiedDiff } from './diff.js';
import { reviewFile } from './llm-review.js';
import { validateAndRank } from './validate.js';

describe('Step 3 - Two-Tier Intelligent LLM Routing', () => {
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

  const lowAlert: SemgrepAlert = {
    id: 'semgrep-src/auth.ts-11-1',
    ruleId: 'rules.javascript.style',
    filePath: 'src/auth.ts',
    lineStart: 11,
    lineEnd: 12,
    severity: 'low',
    category: 'style',
    message: 'Style nitpick',
  };

  const highAlert: SemgrepAlert = {
    id: 'semgrep-src/auth.ts-11-2',
    ruleId: 'rules.javascript.sqli',
    filePath: 'src/auth.ts',
    lineStart: 11,
    lineEnd: 12,
    severity: 'high',
    category: 'security',
    message: 'SQL injection vulnerability detected',
  };

  const mockEconProvider: LlmProvider = {
    name: 'mock-econ-provider',
    model: 'econ-model-1.0',
    generate: vi.fn(),
  };

  const mockPowProvider: LlmProvider = {
    name: 'mock-pow-provider',
    model: 'pow-model-2.0',
    generate: vi.fn(),
  };

  // 1. Simple case handled by economic model without escalation
  it('1. processes simple low-severity case via economic model without escalation', async () => {
    const generateJsonSpy = vi.spyOn(llmPackage, 'generateJson').mockResolvedValueOnce({
      data: {
        summary: 'Reviewed auth.ts',
        findings: [],
        semgrep_decisions: [{ alert_id: 'semgrep-src/auth.ts-11-1', decision: 'CONFIRMED', reason: 'Valid' }],
      },
      provider: 'mock-econ-provider',
      model: 'econ-model-1.0',
      tokensIn: 80,
      tokensOut: 40,
    });

    const result = await reviewFile([mockEconProvider], file, [], [], 'medium', {
      semgrepAlerts: [lowAlert],
      powerfulLlm: [mockPowProvider],
      escalationPolicy: { escalateOnHighSeverity: true, escalateOnUncertain: true },
    });

    expect(generateJsonSpy).toHaveBeenCalledOnce();
    expect(result.metrics).toBeDefined();
    expect(result.metrics?.escalated).toBe(false);
    expect(result.metrics?.totalCalls).toBe(1);
    expect(result.metrics?.triageProvider).toBe('mock-econ-provider');

    generateJsonSpy.mockRestore();
  });

  // 2. UNCERTAIN decision triggers powerful model
  it('2. triggers escalation to powerful model when decision is UNCERTAIN', async () => {
    const generateJsonSpy = vi
      .spyOn(llmPackage, 'generateJson')
      // Call 1: Economic model returns UNCERTAIN
      .mockResolvedValueOnce({
        data: {
          summary: 'Triage review',
          findings: [],
          semgrep_decisions: [{ alert_id: 'semgrep-src/auth.ts-11-1', decision: 'UNCERTAIN', reason: 'Needs deeper analysis' }],
        },
        provider: 'mock-econ-provider',
        model: 'econ-model-1.0',
        tokensIn: 80,
        tokensOut: 40,
      })
      // Call 2: Powerful model returns CONFIRMED
      .mockResolvedValueOnce({
        data: {
          summary: 'Deep review',
          findings: [],
          semgrep_decisions: [{ alert_id: 'semgrep-src/auth.ts-11-1', decision: 'CONFIRMED', reason: 'Confirmed by tier 2' }],
        },
        provider: 'mock-pow-provider',
        model: 'pow-model-2.0',
        tokensIn: 150,
        tokensOut: 60,
      });

    const result = await reviewFile([mockEconProvider], file, [], [], 'medium', {
      semgrepAlerts: [lowAlert],
      powerfulLlm: [mockPowProvider],
    });

    expect(generateJsonSpy).toHaveBeenCalledTimes(2);
    expect(result.metrics?.escalated).toBe(true);
    expect(result.metrics?.totalCalls).toBe(2);
    expect(result.metrics?.escalationProvider).toBe('mock-pow-provider');
    expect(result.metrics?.escalationReason).toContain('UNCERTAIN decision');

    generateJsonSpy.mockRestore();
  });

  // 3. Critical or High severity alert triggers deep verification
  it('3. triggers deep verification for High/Critical severity alerts', async () => {
    const generateJsonSpy = vi
      .spyOn(llmPackage, 'generateJson')
      .mockResolvedValueOnce({
        data: {
          summary: 'Triage review',
          findings: [],
          semgrep_decisions: [{ alert_id: 'semgrep-src/auth.ts-11-2', decision: 'CONFIRMED', reason: 'High alert' }],
        },
        provider: 'mock-econ-provider',
        model: 'econ-model-1.0',
        tokensIn: 80,
        tokensOut: 40,
      })
      .mockResolvedValueOnce({
        data: {
          summary: 'Deep review',
          findings: [],
          semgrep_decisions: [{ alert_id: 'semgrep-src/auth.ts-11-2', decision: 'CONFIRMED', reason: 'Confirmed high' }],
        },
        provider: 'mock-pow-provider',
        model: 'pow-model-2.0',
        tokensIn: 150,
        tokensOut: 60,
      });

    const result = await reviewFile([mockEconProvider], file, [], [], 'medium', {
      semgrepAlerts: [highAlert],
      powerfulLlm: [mockPowProvider],
    });

    expect(generateJsonSpy).toHaveBeenCalledTimes(2);
    expect(result.metrics?.escalated).toBe(true);
    expect(result.metrics?.escalationReason).toContain('High/Critical severity alert');

    generateJsonSpy.mockRestore();
  });

  // 4. Invalid or incomplete response triggers escalation
  it('4. triggers escalation when Tier-1 model throws or returns invalid response', async () => {
    const generateJsonSpy = vi
      .spyOn(llmPackage, 'generateJson')
      .mockRejectedValueOnce(new Error('Format error in tier-1 output'))
      .mockResolvedValueOnce({
        data: {
          summary: 'Tier-2 recovery',
          findings: [],
          semgrep_decisions: [{ alert_id: 'semgrep-src/auth.ts-11-1', decision: 'CONFIRMED', reason: 'Recovered' }],
        },
        provider: 'mock-pow-provider',
        model: 'pow-model-2.0',
        tokensIn: 120,
        tokensOut: 50,
      });

    const result = await reviewFile([mockEconProvider], file, [], [], 'medium', {
      semgrepAlerts: [lowAlert],
      powerfulLlm: [mockPowProvider],
    });

    expect(generateJsonSpy).toHaveBeenCalledTimes(2);
    expect(result.metrics?.escalated).toBe(true);
    expect(result.metrics?.escalationReason).toContain('Invalid or failed Tier-1');

    generateJsonSpy.mockRestore();
  });

  // 5. Second model's decision is validated and linked to correct alert
  it('5. validates and links powerful model decision to original alert', async () => {
    const generateJsonSpy = vi
      .spyOn(llmPackage, 'generateJson')
      .mockResolvedValueOnce({
        data: {
          summary: 'Triage',
          findings: [],
          semgrep_decisions: [{ alert_id: 'semgrep-src/auth.ts-11-1', decision: 'UNCERTAIN', reason: 'Need check' }],
        },
        provider: 'mock-econ-provider',
        model: 'econ-model-1.0',
        tokensIn: 80,
        tokensOut: 40,
      })
      .mockResolvedValueOnce({
        data: {
          summary: 'Deep check',
          findings: [],
          semgrep_decisions: [{ alert_id: 'semgrep-src/auth.ts-11-1', decision: 'CONFIRMED', reason: 'Verified vulnerability' }],
        },
        provider: 'mock-pow-provider',
        model: 'pow-model-2.0',
        tokensIn: 150,
        tokensOut: 60,
      });

    const result = await reviewFile([mockEconProvider], file, [], [], 'medium', {
      semgrepAlerts: [lowAlert],
      powerfulLlm: [mockPowProvider],
    });

    const finding = result.findings.find((f) => f.source === 'semgrep')!;
    expect(finding.semgrepDecision).toBe('CONFIRMED');
    expect(finding.semgrepReason).toBe('Verified vulnerability');
    expect(finding.tier1Decision).toBe('UNCERTAIN');

    generateJsonSpy.mockRestore();
  });

  // 6. Disagreement between models keeps alert and records both decisions
  it('6. keeps alert as UNCERTAIN and records both decisions when models disagree', async () => {
    const generateJsonSpy = vi
      .spyOn(llmPackage, 'generateJson')
      // Tier-1 says REJECTED
      .mockResolvedValueOnce({
        data: {
          summary: 'Triage',
          findings: [],
          semgrep_decisions: [{ alert_id: 'semgrep-src/auth.ts-11-2', decision: 'REJECTED', reason: 'Sanitized' }],
        },
        provider: 'mock-econ-provider',
        model: 'econ-model-1.0',
        tokensIn: 80,
        tokensOut: 40,
      })
      // Tier-2 says CONFIRMED
      .mockResolvedValueOnce({
        data: {
          summary: 'Deep check',
          findings: [],
          semgrep_decisions: [{ alert_id: 'semgrep-src/auth.ts-11-2', decision: 'CONFIRMED', reason: 'Concatenation detected' }],
        },
        provider: 'mock-pow-provider',
        model: 'pow-model-2.0',
        tokensIn: 150,
        tokensOut: 60,
      });

    const result = await reviewFile([mockEconProvider], file, [], [], 'medium', {
      semgrepAlerts: [highAlert],
      powerfulLlm: [mockPowProvider],
    });

    const finding = result.findings.find((f) => f.source === 'semgrep')!;
    expect(finding.semgrepDecision).toBe('UNCERTAIN');
    expect(finding.semgrepReason).toContain('Disagreement between models');
    expect(finding.tier1Decision).toBe('REJECTED');
    expect(finding.tier2Decision).toBe('CONFIRMED');

    // validateAndRank keeps finding because decision is UNCERTAIN (safety rule)
    const kept = validateAndRank(result.findings, files, { strictness: 'medium', maxComments: 10 });
    expect(kept).toHaveLength(1);

    generateJsonSpy.mockRestore();
  });

  // 7. Timeout of second model preserves original alert
  it('7. preserves original alert if Tier-2 model times out or fails', async () => {
    const generateJsonSpy = vi
      .spyOn(llmPackage, 'generateJson')
      .mockResolvedValueOnce({
        data: {
          summary: 'Triage',
          findings: [],
          semgrep_decisions: [{ alert_id: 'semgrep-src/auth.ts-11-1', decision: 'UNCERTAIN', reason: 'Uncertain' }],
        },
        provider: 'mock-econ-provider',
        model: 'econ-model-1.0',
        tokensIn: 80,
        tokensOut: 40,
      })
      .mockRejectedValueOnce(new Error('Tier-2 LLM Timeout (30000ms)'));

    const result = await reviewFile([mockEconProvider], file, [], [], 'medium', {
      semgrepAlerts: [lowAlert],
      powerfulLlm: [mockPowProvider],
    });

    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0]!;
    expect(finding.semgrepDecision).toBe('UNCERTAIN');
    expect(finding.semgrepReason).toContain('Tier-2 LLM evaluation failed or timed out');

    generateJsonSpy.mockRestore();
  });

  // 8. Incomplete configuration handled gracefully
  it('8. handles unconfigured powerful model by reporting actual providers used', () => {
    const env = {
      LLM_PROVIDER_ECONOMIC: 'gemini',
      LLM_MODEL_ECONOMIC: 'gemini-1.5-flash',
      GEMINI_API_KEY: 'test-key',
    };

    const { economic, powerful } = createTwoTierProvidersFromEnv(env as any);
    expect(economic.length).toBeGreaterThan(0);
    expect(powerful.length).toBeGreaterThan(0);
    expect(economic[0]?.model).toBe('gemini-1.5-flash');
  });

  // 9. Max 1 escalation per alert
  it('9. escalates each alert at most once per review', async () => {
    const generateJsonSpy = vi
      .spyOn(llmPackage, 'generateJson')
      .mockResolvedValueOnce({
        data: {
          summary: 'Triage',
          findings: [],
          semgrep_decisions: [{ alert_id: 'semgrep-src/auth.ts-11-2', decision: 'UNCERTAIN', reason: 'Uncertain' }],
        },
        provider: 'mock-econ-provider',
        model: 'econ-model-1.0',
        tokensIn: 80,
        tokensOut: 40,
      })
      .mockResolvedValueOnce({
        data: {
          summary: 'Deep check',
          findings: [],
          semgrep_decisions: [{ alert_id: 'semgrep-src/auth.ts-11-2', decision: 'CONFIRMED', reason: 'Verified' }],
        },
        provider: 'mock-pow-provider',
        model: 'pow-model-2.0',
        tokensIn: 150,
        tokensOut: 60,
      });

    const result = await reviewFile([mockEconProvider], file, [], [], 'medium', {
      semgrepAlerts: [highAlert],
      powerfulLlm: [mockPowProvider],
    });

    expect(generateJsonSpy).toHaveBeenCalledTimes(2);
    expect(result.metrics?.totalCalls).toBe(2);

    generateJsonSpy.mockRestore();
  });

  // 10. Metrics record calls, tokens, and latency
  it('10. records accurate metrics including total calls, tokens, latency, and alert final states', async () => {
    const generateJsonSpy = vi
      .spyOn(llmPackage, 'generateJson')
      .mockResolvedValueOnce({
        data: {
          summary: 'Triage',
          findings: [],
          semgrep_decisions: [{ alert_id: 'semgrep-src/auth.ts-11-2', decision: 'UNCERTAIN', reason: 'Uncertain' }],
        },
        provider: 'mock-econ-provider',
        model: 'econ-model-1.0',
        tokensIn: 100,
        tokensOut: 50,
      })
      .mockResolvedValueOnce({
        data: {
          summary: 'Deep check',
          findings: [],
          semgrep_decisions: [{ alert_id: 'semgrep-src/auth.ts-11-2', decision: 'CONFIRMED', reason: 'Verified' }],
        },
        provider: 'mock-pow-provider',
        model: 'pow-model-2.0',
        tokensIn: 200,
        tokensOut: 80,
      });

    const result = await reviewFile([mockEconProvider], file, [], [], 'medium', {
      semgrepAlerts: [highAlert],
      powerfulLlm: [mockPowProvider],
    });

    expect(result.metrics).toBeDefined();
    expect(result.metrics?.tokensIn).toBe(300);
    expect(result.metrics?.tokensOut).toBe(130);
    expect(result.metrics?.totalCalls).toBe(2);
    expect(result.metrics?.alertFinalStates).toHaveLength(1);
    expect(result.metrics?.alertFinalStates[0]?.finalDecision).toBe('CONFIRMED');

    generateJsonSpy.mockRestore();
  });

  // 11. Results remain compatible with existing consumers
  it('11. produces CandidateFinding array fully compatible with validateAndRank', () => {
    const candidate: CandidateFinding = {
      filePath: 'src/auth.ts',
      lineStart: 11,
      lineEnd: 12,
      severity: 'high',
      category: 'security',
      source: 'semgrep',
      message: 'SQL injection vulnerability detected',
      suggestion: null,
      confidence: 0.95,
      ruleId: 'rules.javascript.sqli',
      semgrepDecision: 'CONFIRMED',
      semgrepReason: 'Verified by two-tier routing',
      tier1Decision: 'UNCERTAIN',
      tier2Decision: 'CONFIRMED',
    };

    const kept = validateAndRank([candidate], files, { strictness: 'medium', maxComments: 10 });
    expect(kept).toHaveLength(1);
    expect(kept[0]?.filePath).toBe('src/auth.ts');
    expect(kept[0]?.lineStart).toBe(11);
  });
});
