import { existsSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { ExecutionOutput, JavaExecutor } from './test-validator.js';
import { sanitizeEnvironment, validateJavaTest } from './test-validator.js';

const SAMPLE_SOURCE = `public class Calculator {
    public int add(int a, int b) {
        return a + b;
    }
}`;

const SAMPLE_TEST = `import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

public class CalculatorTest {
    @Test
    void testAdd() {
        Calculator calc = new Calculator();
        assertEquals(5, calc.add(2, 3));
    }
}`;

describe('Test Validator (Phase 4)', () => {
  it('Test 1: Code Java valide (compile = true)', async () => {
    const mockExecutor: JavaExecutor = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }) // compile javac
        .mockResolvedValueOnce({ exitCode: 0, stdout: 'JUnit 5 run passed', stderr: '' }), // run java
    };

    const res = await validateJavaTest({
      sourceCode: SAMPLE_SOURCE,
      sourceFileName: 'Calculator.java',
      testCode: SAMPLE_TEST,
      testFileName: 'CalculatorTest.java',
      executor: mockExecutor,
    });

    expect(res.compiled).toBe(true);
    expect(res.status).toBe('PASSED');
  });

  it('Test 2: Code Java syntaxiquement invalide (status = COMPILE_ERROR)', async () => {
    const mockExecutor: JavaExecutor = {
      execute: vi.fn().mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'CalculatorTest.java:5: error: ; expected',
      }),
    };

    const res = await validateJavaTest({
      sourceCode: SAMPLE_SOURCE,
      sourceFileName: 'Calculator.java',
      testCode: 'invalid java code',
      testFileName: 'CalculatorTest.java',
      executor: mockExecutor,
    });

    expect(res.status).toBe('COMPILE_ERROR');
    expect(res.compiled).toBe(false);
    expect(res.compileErrors).toContain('CalculatorTest.java:5: error: ; expected');
  });

  it('Test 3: Test JUnit valide (compiled = true, executed = true, passed = true)', async () => {
    const mockExecutor: JavaExecutor = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({ exitCode: 0, stdout: 'compilation ok', stderr: '' })
        .mockResolvedValueOnce({ exitCode: 0, stdout: '1 test successful', stderr: '' }),
    };

    const res = await validateJavaTest({
      sourceCode: SAMPLE_SOURCE,
      sourceFileName: 'Calculator.java',
      testCode: SAMPLE_TEST,
      testFileName: 'CalculatorTest.java',
      executor: mockExecutor,
    });

    expect(res.status).toBe('PASSED');
    expect(res.compiled).toBe(true);
    expect(res.executed).toBe(true);
    expect(res.passed).toBe(true);
  });

  it('Test 4: Test JUnit qui échoue (status = TEST_FAILURE)', async () => {
    const mockExecutor: JavaExecutor = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
        .mockResolvedValueOnce({
          exitCode: 1,
          stdout: 'FAIL: testAdd() -> expected 5 but was 4',
          stderr: 'AssertionError: expected 5 but was 4',
        }),
    };

    const res = await validateJavaTest({
      sourceCode: SAMPLE_SOURCE,
      sourceFileName: 'Calculator.java',
      testCode: SAMPLE_TEST,
      testFileName: 'CalculatorTest.java',
      executor: mockExecutor,
    });

    expect(res.status).toBe('TEST_FAILURE');
    expect(res.compiled).toBe(true);
    expect(res.executed).toBe(true);
    expect(res.passed).toBe(false);
    expect(res.testFailures).toBeDefined();
  });

  it('Test 5: Timeout (status = TIMEOUT)', async () => {
    const mockExecutor: JavaExecutor = {
      execute: vi.fn().mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'Execution timed out',
        timedOut: true,
      }),
    };

    const res = await validateJavaTest({
      sourceCode: SAMPLE_SOURCE,
      sourceFileName: 'Calculator.java',
      testCode: SAMPLE_TEST,
      testFileName: 'CalculatorTest.java',
      timeoutMs: 100,
      executor: mockExecutor,
    });

    expect(res.status).toBe('TIMEOUT');
    expect(res.passed).toBe(false);
  });

  it('Test 6: Erreur d\'exécution (status = RUNTIME_ERROR)', async () => {
    const mockExecutor: JavaExecutor = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
        .mockResolvedValueOnce({
          exitCode: 1,
          stdout: '',
          stderr: 'Error: Could not find or load main class CalculatorTest',
        }),
    };

    const res = await validateJavaTest({
      sourceCode: SAMPLE_SOURCE,
      sourceFileName: 'Calculator.java',
      testCode: SAMPLE_TEST,
      testFileName: 'CalculatorTest.java',
      executor: mockExecutor,
    });

    expect(res.status).toBe('RUNTIME_ERROR');
    expect(res.compiled).toBe(true);
    expect(res.executed).toBe(false);
  });

  it('Test 7: stdout/stderr correctement récupérés', async () => {
    const mockExecutor: JavaExecutor = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({ exitCode: 0, stdout: 'javac out', stderr: 'javac err' })
        .mockResolvedValueOnce({ exitCode: 0, stdout: 'java out', stderr: 'java err' }),
    };

    const res = await validateJavaTest({
      sourceCode: SAMPLE_SOURCE,
      sourceFileName: 'Calculator.java',
      testCode: SAMPLE_TEST,
      testFileName: 'CalculatorTest.java',
      executor: mockExecutor,
    });

    expect(res.stdout).toBe('java out');
    expect(res.stderr).toBe('java err');
  });

  it('Test 8: Workspace temporaire correctement nettoyé', async () => {
    let capturedDir = '';
    const mockExecutor: JavaExecutor = {
      execute: vi.fn().mockImplementation(async (params) => {
        capturedDir = params.workspaceDir;
        return { exitCode: 0, stdout: '', stderr: '' };
      }),
    };

    await validateJavaTest({
      sourceCode: SAMPLE_SOURCE,
      sourceFileName: 'Calculator.java',
      testCode: SAMPLE_TEST,
      testFileName: 'CalculatorTest.java',
      executor: mockExecutor,
    });

    expect(capturedDir).not.toBe('');
    // Ensure the temporary directory was deleted by rm in finally block
    expect(existsSync(capturedDir)).toBe(false);
  });

  it('Test 9: Aucun secret / credential n\'est transmis au processus (sanitizeEnvironment)', () => {
    const dirtyEnv = {
      PATH: '/usr/bin',
      GITHUB_TOKEN: 'ghp_secret123',
      CLERK_SECRET_KEY: 'sk_test_secret',
      GEMINI_API_KEY: 'AIzaSySecret',
      OPENAI_API_KEY: 'sk-proj-secret',
      DATABASE_URL: 'postgres://user:pass@host:5432/db',
      REDIS_URL: 'redis://pass@host:6379',
      MY_CUSTOM_SECRET: 'supersecret',
      NORMAL_ENV_VAR: 'hello',
    };

    const cleanEnv = sanitizeEnvironment(dirtyEnv);

    expect(cleanEnv).toHaveProperty('PATH', '/usr/bin');
    expect(cleanEnv).toHaveProperty('NORMAL_ENV_VAR', 'hello');

    expect(cleanEnv).not.toHaveProperty('GITHUB_TOKEN');
    expect(cleanEnv).not.toHaveProperty('CLERK_SECRET_KEY');
    expect(cleanEnv).not.toHaveProperty('GEMINI_API_KEY');
    expect(cleanEnv).not.toHaveProperty('OPENAI_API_KEY');
    expect(cleanEnv).not.toHaveProperty('DATABASE_URL');
    expect(cleanEnv).not.toHaveProperty('REDIS_URL');
    expect(cleanEnv).not.toHaveProperty('MY_CUSTOM_SECRET');
  });

  it('Test 10: Paramètres d\'exécution transmis correctement à l\'exécuteur', async () => {
    const mockExecutor: JavaExecutor = {
      execute: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }),
    };

    await validateJavaTest({
      sourceCode: SAMPLE_SOURCE,
      sourceFileName: 'Calculator.java',
      testCode: SAMPLE_TEST,
      testFileName: 'CalculatorTest.java',
      timeoutMs: 8000,
      executor: mockExecutor,
    });

    const calls = (mockExecutor.execute as any).mock.calls;
    expect(calls[0][0].timeoutMs).toBe(8000);
    expect(calls[0][0].command).toBe('javac');
    expect(calls[1][0].command).toBe('java');
  });
});
