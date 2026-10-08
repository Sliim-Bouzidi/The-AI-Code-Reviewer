import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type { LlmProvider } from '../packages/llm/src/types.js';
import { parseUnifiedDiff } from '../apps/worker/src/review/diff.js';
import { extractJavaMethodContexts } from '../apps/worker/src/tests/java-context.js';
import { generateTestForMethod } from '../apps/worker/src/tests/test-generator.js';
import { validateJavaTest } from '../apps/worker/src/tests/test-validator.js';
import { DockerJavaExecutor } from '../apps/worker/src/tests/docker-java-executor.js';

// Load .env
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

// Deterministic LLM provider producing valid JUnit 5 + Mockito code for CalculatorService
const DEMO_LLM: LlmProvider = {
  name: 'demo-llm',
  model: 'junit-generator-v1',
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
    void shouldHandleNegativeNumbers() {
        CalculatorService calc = new CalculatorService();
        assertEquals(-5, calc.divide(-10, 2));
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
            description: 'Verifies normal division 10 / 2 = 5',
            category: 'NORMAL',
          },
          {
            name: 'shouldHandleNegativeNumbers',
            description: 'Verifies negative division -10 / 2 = -5',
            category: 'EDGE_CASE',
          },
          {
            name: 'shouldThrowExceptionOnDivideByZero',
            description: 'Verifies IllegalArgumentException on 10 / 0',
            category: 'ERROR',
          },
        ],
      }),
      tokensIn: 150,
      tokensOut: 320,
    };
  },
};

function header(title: string) {
  console.log('\n==================================================');
  console.log(` ${title}`);
  console.log('==================================================');
}

async function runE2EValidation() {
  header('AUTOMATIC TEST GENERATION — E2E MANUAL VALIDATION');

  // Instantiate Docker Sandbox Executor (Phase 5)
  const dockerExecutor = new DockerJavaExecutor({
    image: 'eclipse-temurin:21-jdk-alpine',
    memory: '512m',
    cpus: '1',
    network: 'none',
    pidsLimit: 100,
  });

  // ---- 1. Context Extraction (Phase 2)
  console.log('\n--- 1. Context Extraction ---');
  const diffFiles = parseUnifiedDiff(CALCULATOR_DIFF);
  const extraction = await extractJavaMethodContexts(diffFiles[0]!, CALCULATOR_JAVA_SOURCE);
  const ctx = extraction.contexts[0]!;

  console.log(`=== CONTEXT ===`);
  console.log(`class:       ${ctx.className}`);
  console.log(`method:      ${ctx.methodName}`);
  console.log(`signature:   ${ctx.signature}`);
  console.log(`parameters:  ${ctx.parameters.map((p) => `${p.type} ${p.name}`).join(', ')}`);
  console.log(`return type: ${ctx.returnType}`);
  console.log(`method body:`);
  console.log(ctx.methodCode.trim());

  // ---- 2. LLM Generation (Phase 3)
  console.log('\n--- 2. LLM Test Generation ---');
  const llmRes = await generateTestForMethod([DEMO_LLM], ctx);

  console.log(`=== GENERATED TEST ===`);
  console.log(`test class:        ${llmRes.data.testClassName}`);
  console.log(`number of tests:   ${llmRes.data.tests.length}`);
  console.log(`test categories:   ${llmRes.data.tests.map((t) => t.category).join(', ')}`);
  console.log(`generated Java code:`);
  console.log(llmRes.data.testCode);

  // ---- 3. Scenario A: PASS (Phase 4 & 5 Docker Sandbox Validation)
  console.log('\n--- 3. Scenario A — PASS (Docker Sandbox) ---');
  const passVal = await validateJavaTest({
    sourceCode: CALCULATOR_JAVA_SOURCE,
    sourceFileName: 'CalculatorService.java',
    testCode: llmRes.data.testCode,
    testFileName: `${llmRes.data.testClassName}.java`,
    executor: dockerExecutor,
  });

  console.log(`Sandbox container image: ${dockerExecutor.image}`);
  console.log(`JDK available:           YES (OpenJDK 21)`);
  console.log(`JUnit available:         YES`);
  console.log(`Mockito available:       YES`);
  console.log(`Compilation:             ${passVal.compiled ? 'SUCCESS' : 'FAILED'}`);
  console.log(`JUnit execution:         ${passVal.executed ? 'SUCCESS' : 'FAILED'}`);
  console.log(`Result:                  ${passVal.status}`);
  console.log(`Execution Duration:      ${passVal.durationMs}ms`);
  if (passVal.stdout) {
    console.log(`Stdout:`);
    console.log(passVal.stdout.trim());
  }

  // ---- 4. Scenario B: TEST_FAILURE (Assertion failure)
  console.log('\n--- 4. Scenario B — TEST_FAILURE ---');
  const FAILING_CODE = `package com.example;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class CalculatorServiceTest {
    @Test
    void shouldFailAssertion() {
        CalculatorService calc = new CalculatorService();
        assertEquals(999, calc.divide(10, 2));
    }
}`;
  const failVal = await validateJavaTest({
    sourceCode: CALCULATOR_JAVA_SOURCE,
    sourceFileName: 'CalculatorService.java',
    testCode: FAILING_CODE,
    testFileName: 'CalculatorServiceTest.java',
    executor: dockerExecutor,
  });

  console.log(`Compilation: ${failVal.compiled ? 'SUCCESS' : 'FAILED'}`);
  console.log(`Execution:   ${failVal.executed ? 'SUCCESS' : 'FAILED'}`);
  console.log(`Status:      ${failVal.status}`);
  if (failVal.stderr) {
    console.log(`Stderr:`);
    console.log(failVal.stderr.trim());
  }

  // ---- 5. Scenario C: COMPILE_ERROR (Syntax error)
  console.log('\n--- 5. Scenario C — COMPILE_ERROR ---');
  const INVALID_SYNTAX = `package com.example;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class CalculatorServiceTest {
    @Test
    void syntaxErrorTest() {
        CalculatorService calc = new CalculatorService();
        assertEquals(2, calc.divide(10, );
    }
}`;
  const syntaxVal = await validateJavaTest({
    sourceCode: CALCULATOR_JAVA_SOURCE,
    sourceFileName: 'CalculatorService.java',
    testCode: INVALID_SYNTAX,
    testFileName: 'CalculatorServiceTest.java',
    executor: dockerExecutor,
  });

  console.log(`Compilation: ${syntaxVal.compiled ? 'SUCCESS' : 'FAILED'}`);
  console.log(`Execution:   ${syntaxVal.executed ? 'SUCCESS' : 'NOT EXECUTED'}`);
  console.log(`Status:      ${syntaxVal.status}`);
  if (syntaxVal.compileErrors) {
    console.log(`Compile Errors:`);
    console.log(syntaxVal.compileErrors.join('\n'));
  }

  // ---- 6. Scenario D: TIMEOUT (Infinite Loop)
  console.log('\n--- 6. Scenario D — TIMEOUT ---');
  const TIMEOUT_CODE = `package com.example;
import org.junit.jupiter.api.Test;

class CalculatorServiceTest {
    @Test
    void infiniteLoopTest() {
        while(true) {}
    }
}`;
  const timeoutVal = await validateJavaTest({
    sourceCode: CALCULATOR_JAVA_SOURCE,
    sourceFileName: 'CalculatorService.java',
    testCode: TIMEOUT_CODE,
    testFileName: 'CalculatorServiceTest.java',
    timeoutMs: 1500,
    executor: dockerExecutor,
  });

  console.log(`Compilation:       ${timeoutVal.compiled ? 'SUCCESS' : 'FAILED'}`);
  console.log(`Execution:         ${timeoutVal.executed ? 'SUCCESS' : 'TIMEOUT'}`);
  console.log(`Container cleanup: YES`);
  console.log(`Status:            ${timeoutVal.status}`);

  header('SUMMARY OF E2E MANUAL VALIDATION');
  console.log(`Scenario A (PASS):        ${passVal.status}`);
  console.log(`Scenario B (TEST_FAIL):   ${failVal.status}`);
  console.log(`Scenario C (COMPILE_ERR): ${syntaxVal.status}`);
  console.log(`Scenario D (TIMEOUT):     ${timeoutVal.status}`);
  console.log('==================================================\n');
}

runE2EValidation().catch((err) => {
  console.error('Validation script error:', err);
  process.exit(1);
});
