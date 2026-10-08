import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type { LlmProvider } from '../packages/llm/src/types.js';
import { parseUnifiedDiff } from '../apps/worker/src/review/diff.js';
import { extractJavaMethodContexts } from '../apps/worker/src/tests/java-context.js';
import { generateTestForMethod } from '../apps/worker/src/tests/test-generator.js';
import { validateJavaTest } from '../apps/worker/src/tests/test-validator.js';

// Load .env if present
const root = resolve(import.meta.dirname, '..');
if (existsSync(resolve(root, '.env'))) {
  process.loadEnvFile(resolve(root, '.env'));
}

const CALCULATOR_JAVA_SOURCE = `package com.example;

public class CalculatorService {

    public int divide(int a, int b) {
        if (b == 0) {
            throw new IllegalArgumentException("Cannot divide by zero");
        }
        return a / b;
    }
}
`;

const CALCULATOR_DIFF = `diff --git a/src/main/java/com/example/CalculatorService.java b/src/main/java/com/example/CalculatorService.java
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/src/main/java/com/example/CalculatorService.java
@@ -0,0 +1,10 @@
+package com.example;
+
+public class CalculatorService {
+
+    public int divide(int a, int b) {
+        if (b == 0) {
+            throw new IllegalArgumentException("Cannot divide by zero");
+        }
+        return a / b;
+    }
+}
`;

// Mock LLM provider fallback when no real API key is configured
const MOCK_DEMO_LLM: LlmProvider = {
  name: 'demo-mock-llm',
  model: 'demo-model',
  async generate() {
    return {
      text: JSON.stringify({
        testClassName: 'CalculatorServiceTest',
        imports: [
          'org.junit.jupiter.api.Test',
          'static org.junit.jupiter.api.Assertions.*',
        ],
        annotations: [],
        testCode: `package com.example;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class CalculatorServiceTest {

    @Test
    void shouldDivideNumbersSuccessfully() {
        CalculatorService calc = new CalculatorService();
        assertEquals(5, calc.divide(10, 2));
    }

    @Test
    void shouldThrowExceptionOnDivideByZero() {
        CalculatorService calc = new CalculatorService();
        assertThrows(IllegalArgumentException.class, () -> calc.divide(10, 0));
    }
}`,
        tests: [
          {
            name: 'shouldDivideNumbersSuccessfully',
            description: 'Verifies normal division',
            category: 'NORMAL',
          },
          {
            name: 'shouldThrowExceptionOnDivideByZero',
            description: 'Verifies divide by zero exception',
            category: 'ERROR',
          },
        ],
      }),
      tokensIn: 120,
      tokensOut: 250,
    };
  },
};

function banner(title: string) {
  console.log('\n========================================');
  console.log(` ${title}`);
  console.log('========================================');
}

async function runDemo() {
  banner('AI CODE REVIEWER — Automatic Test Generation Demo');

  // 1. Source file
  console.log('\n[1] Java Source Code');
  console.log('----------------------------------------');
  console.log(CALCULATOR_JAVA_SOURCE.trim());

  // 2. Context Extraction (Phase 2)
  console.log('\n[2] Context Extraction (Phase 2)');
  console.log('----------------------------------------');
  const diffFiles = parseUnifiedDiff(CALCULATOR_DIFF);
  const diffFile = diffFiles[0]!;

  const extraction = await extractJavaMethodContexts(diffFile, CALCULATOR_JAVA_SOURCE);
  if (extraction.contexts.length === 0) {
    console.error('❌ Failed to extract context from Java source!');
    process.exit(1);
  }

  const ctx = extraction.contexts[0]!;
  console.log(`✓ Class: ${ctx.className}`);
  console.log(`✓ Method: ${ctx.methodName}`);
  console.log(`✓ Signature: ${ctx.signature}`);
  console.log(`✓ Return Type: ${ctx.returnType}`);
  console.log(`✓ Parameters: ${ctx.parameters.map((p) => `${p.type} ${p.name}`).join(', ')}`);

  // 3. LLM Generation (Phase 3)
  console.log('\n[3] LLM Generation (Phase 3)');
  console.log('----------------------------------------');
  const llmProviders = [MOCK_DEMO_LLM];
  console.log(`✓ Using LLM provider: ${MOCK_DEMO_LLM.name}:${MOCK_DEMO_LLM.model}`);

  const llmResult = await generateTestForMethod(llmProviders, ctx);
  console.log(`✓ Test class generated: ${llmResult.data.testClassName}`);
  console.log(`✓ Number of test methods: ${llmResult.data.tests.length}`);

  // 4. Generated Tests Code
  console.log('\n[4] Generated JUnit 5 + Mockito Code');
  console.log('----------------------------------------');
  console.log(llmResult.data.testCode);

  // 5. Validation - Scenario A: Valid Test (Phase 4)
  console.log('\n[5.A] Validation — Scenario A: Valid LLM Generated Test');
  console.log('----------------------------------------');
  const validRes = await validateJavaTest({
    sourceCode: CALCULATOR_JAVA_SOURCE,
    sourceFileName: 'CalculatorService.java',
    testCode: llmResult.data.testCode,
    testFileName: 'CalculatorServiceTest.java',
  });

  console.log(`✓ Compilation: ${validRes.compiled ? 'PASSED' : 'FAILED'}`);
  console.log(`✓ Execution:   ${validRes.executed ? 'PASSED' : 'FAILED'}`);
  console.log(`✓ Status:      ${validRes.status}`);

  // 5.B Validation - Scenario B: Test Failure (Failing Assertion)
  console.log('\n[5.B] Validation — Scenario B: Failing Assertion Test');
  console.log('----------------------------------------');
  const FAILING_TEST_CODE = `package com.example;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class CalculatorServiceTest {
    @Test
    void shouldFailAssertion() {
        CalculatorService calc = new CalculatorService();
        assertEquals(999, calc.divide(10, 2)); // Expect 999, actual 5
    }
}`;
  const failRes = await validateJavaTest({
    sourceCode: CALCULATOR_JAVA_SOURCE,
    sourceFileName: 'CalculatorService.java',
    testCode: FAILING_TEST_CODE,
    testFileName: 'CalculatorServiceTest.java',
  });

  console.log(`✓ Compilation: ${failRes.compiled ? 'PASSED' : 'FAILED'}`);
  console.log(`✓ Execution:   ${failRes.executed ? 'PASSED' : 'FAILED'}`);
  console.log(`✓ Status:      ${failRes.status}`);

  // 5.C Validation - Scenario C: Syntax Error (Compile Error)
  console.log('\n[5.C] Validation — Scenario C: Syntax Error Test');
  console.log('----------------------------------------');
  const INVALID_SYNTAX_CODE = `package com.example;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class CalculatorServiceTest {
    @Test
    void syntaxErrorTest() {
        CalculatorService calc = new CalculatorService();
        assertEquals(2, calc.divide(10, ); // Missing argument
    }
}`;
  const syntaxRes = await validateJavaTest({
    sourceCode: CALCULATOR_JAVA_SOURCE,
    sourceFileName: 'CalculatorService.java',
    testCode: INVALID_SYNTAX_CODE,
    testFileName: 'CalculatorServiceTest.java',
  });

  console.log(`✓ Compilation: ${syntaxRes.compiled ? 'PASSED' : 'FAILED'}`);
  console.log(`✓ Execution:   ${syntaxRes.executed ? 'PASSED' : 'NOT EXECUTED'}`);
  console.log(`✓ Status:      ${syntaxRes.status}`);

  // 5.D Validation - Scenario D: Timeout
  console.log('\n[5.D] Validation — Scenario D: Infinite Loop (Timeout Test)');
  console.log('----------------------------------------');
  const TIMEOUT_CODE = `package com.example;
import org.junit.jupiter.api.Test;

class CalculatorServiceTest {
    @Test
    void infiniteLoopTest() {
        while(true) {}
    }
}`;
  const timeoutRes = await validateJavaTest({
    sourceCode: CALCULATOR_JAVA_SOURCE,
    sourceFileName: 'CalculatorService.java',
    testCode: TIMEOUT_CODE,
    testFileName: 'CalculatorServiceTest.java',
    timeoutMs: 1500, // 1.5s timeout for demo
  });

  console.log(`✓ Compilation: ${timeoutRes.compiled ? 'PASSED' : 'FAILED'}`);
  console.log(`✓ Execution:   ${timeoutRes.executed ? 'PASSED' : 'TIMED OUT'}`);
  console.log(`✓ Status:      ${timeoutRes.status}`);

  // 6. Summary
  banner('DEMONSTRATION COMPLETE');
  console.log(`Scenario A (LLM Test):   STATUS = ${validRes.status}`);
  console.log(`Scenario B (Assertion):  STATUS = ${failRes.status}`);
  console.log(`Scenario C (Syntax Err): STATUS = ${syntaxRes.status}`);
  console.log(`Scenario D (Timeout):    STATUS = ${timeoutRes.status}`);
  console.log('========================================\n');
}

runDemo().catch((err) => {
  console.error('Demo error:', err);
  process.exit(1);
});
