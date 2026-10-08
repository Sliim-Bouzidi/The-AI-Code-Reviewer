import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { ValidationResult } from '@codereview/shared';

const execFileAsync = promisify(execFile);

/** Default execution timeout in milliseconds. */
export const DEFAULT_TEST_EXECUTION_TIMEOUT_MS = Number(
  process.env.TEST_EXECUTION_TIMEOUT_MS ?? 15_000,
);

// ─── Environment Sanitization (Security Constraint) ──────────────────────────

const SENSITIVE_ENV_KEYS = [
  'GITHUB_',
  'CLERK_',
  'GEMINI_',
  'OPENAI_',
  'ANTHROPIC_',
  'OPENROUTER_',
  'DATABASE_URL',
  'REDIS_URL',
  'SECRET',
  'PASSWORD',
  'TOKEN',
  'KEY',
];

export function sanitizeEnvironment(rawEnv: Record<string, string | undefined>): Record<string, string> {
  const cleanEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawEnv)) {
    if (!value) continue;
    const upperKey = key.toUpperCase();
    const isSensitive = SENSITIVE_ENV_KEYS.some((pattern) => upperKey.includes(pattern));
    if (!isSensitive) {
      cleanEnv[key] = value;
    }
  }
  return cleanEnv;
}

// ─── Java Executor Abstraction ────────────────────────────────────────────────

export interface ExecutionParams {
  workspaceDir: string;
  command: string;
  args: string[];
  timeoutMs: number;
  env?: Record<string, string>;
}

export interface ExecutionOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  envPassed?: Record<string, string>;
}

export interface JavaExecutor {
  execute(params: ExecutionParams): Promise<ExecutionOutput>;
}

export class DefaultProcessExecutor implements JavaExecutor {
  async execute(params: ExecutionParams): Promise<ExecutionOutput> {
    const cleanEnv = sanitizeEnvironment(params.env ?? process.env);
    try {
      const { stdout, stderr } = await execFileAsync(params.command, params.args, {
        cwd: params.workspaceDir,
        timeout: params.timeoutMs,
        env: cleanEnv,
        maxBuffer: 5 * 1024 * 1024,
      });
      return { exitCode: 0, stdout, stderr, envPassed: cleanEnv };
    } catch (err: any) {
      const isTimeout = err.killed || err.signal === 'SIGTERM' || err.code === 'ETIMEDOUT';
      return {
        exitCode: err.code && typeof err.code === 'number' ? err.code : 1,
        stdout: err.stdout ?? '',
        stderr: err.stderr ?? err.message ?? '',
        timedOut: isTimeout,
        envPassed: cleanEnv,
      };
    }
  }
}

// ─── Minimal Embedded JUnit 5 + Mockito Stubs & TestRunner ───────────────────

const STUB_FILES: Record<string, string> = {
  'org/junit/jupiter/api/Test.java': `package org.junit.jupiter.api;
import java.lang.annotation.*;
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface Test {}
`,
  'org/junit/jupiter/api/Assertions.java': `package org.junit.jupiter.api;
import java.util.Objects;
public class Assertions {
    public static void assertEquals(Object expected, Object actual) {
        if (!Objects.equals(expected, actual)) {
            throw new AssertionError("expected: <" + expected + "> but was: <" + actual + ">");
        }
    }
    public static void assertEquals(long expected, long actual) {
        if (expected != actual) {
            throw new AssertionError("expected: <" + expected + "> but was: <" + actual + ">");
        }
    }
    public static void assertEquals(double expected, double actual) {
        if (expected != actual) {
            throw new AssertionError("expected: <" + expected + "> but was: <" + actual + ">");
        }
    }
    public static void assertTrue(boolean condition) {
        if (!condition) throw new AssertionError("expected true but was false");
    }
    public static void assertFalse(boolean condition) {
        if (condition) throw new AssertionError("expected false but was true");
    }
    public static void assertNotNull(Object actual) {
        if (actual == null) throw new AssertionError("expected not null");
    }
    public static void assertNull(Object actual) {
        if (actual != null) throw new AssertionError("expected null but was: " + actual);
    }
    @SuppressWarnings("unchecked")
    public static <T extends Throwable> T assertThrows(Class<T> expectedType, Runnable executable) {
        try {
            executable.run();
        } catch (Throwable actual) {
            if (expectedType.isInstance(actual)) {
                return (T) actual;
            }
            throw new AssertionError("Expected " + expectedType.getName() + " but threw " + actual.getClass().getName());
        }
        throw new AssertionError("Expected " + expectedType.getName() + " to be thrown, but nothing was thrown.");
    }
}
`,
  'org/mockito/Mock.java': `package org.mockito;
import java.lang.annotation.*;
@Target(ElementType.FIELD)
@Retention(RetentionPolicy.RUNTIME)
public @interface Mock {}
`,
  'org/mockito/InjectMocks.java': `package org.mockito;
import java.lang.annotation.*;
@Target(ElementType.FIELD)
@Retention(RetentionPolicy.RUNTIME)
public @interface InjectMocks {}
`,
  'org/mockito/Mockito.java': `package org.mockito;
public class Mockito {
    public static <T> T mock(Class<T> classToMock) { return null; }
    public static <T> Object when(T methodCall) { return null; }
    public static <T> T verify(T mock) { return mock; }
}
`,
  'com/example/TestRunner.java': `package com.example;
import java.lang.reflect.Method;

public class TestRunner {
    public static void main(String[] args) {
        if (args.length == 0) {
            System.err.println("No test class name provided");
            System.exit(1);
        }
        String className = args[0];
        int passed = 0;
        int failed = 0;
        try {
            Class<?> testClass = Class.forName(className);
            Object instance = testClass.getDeclaredConstructor().newInstance();
            for (Method m : testClass.getDeclaredMethods()) {
                if (m.isAnnotationPresent(org.junit.jupiter.api.Test.class) || m.getName().startsWith("test") || m.getName().startsWith("should")) {
                    try {
                        m.setAccessible(true);
                        m.invoke(instance);
                        System.out.println("PASS: " + m.getName());
                        passed++;
                    } catch (Throwable t) {
                        Throwable cause = t.getCause() != null ? t.getCause() : t;
                        System.err.println("FAIL: " + m.getName() + " -> " + cause.getMessage());
                        failed++;
                    }
                }
            }
            System.out.println("Results: " + passed + " passed, " + failed + " failed.");
            if (failed > 0) {
                System.exit(1);
            }
        } catch (Throwable t) {
            System.err.println("Runtime error: " + t.getMessage());
            t.printStackTrace(System.err);
            System.exit(2);
        }
    }
}
`,
};

async function prepareJUnitWorkspace(dir: string): Promise<void> {
  for (const [relPath, content] of Object.entries(STUB_FILES)) {
    const fullPath = join(dir, relPath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, 'utf8');
  }
}

// ─── Input Options ────────────────────────────────────────────────────────────

export interface ValidateJavaTestOptions {
  sourceCode: string;
  sourceFileName: string;
  testCode: string;
  testFileName: string;
  timeoutMs?: number;
  executor?: JavaExecutor;
}

// ─── Error Classifiers ────────────────────────────────────────────────────────

function parseCompileErrors(stderr: string, stdout: string): string[] {
  const combined = `${stderr}\n${stdout}`;
  const lines = combined.split('\n');
  const errors = lines.filter((l) => l.includes('error:') || l.includes('.java:'));
  return errors.length > 0 ? errors : [combined.trim() || 'Compilation failed'];
}

function parseTestFailures(stdout: string, stderr: string): string[] {
  const combined = `${stdout}\n${stderr}`;
  const lines = combined.split('\n');
  const failures = lines.filter(
    (l) => l.includes('FAIL:') || l.includes('AssertionError') || l.includes('-> expected:'),
  );
  return failures.length > 0 ? failures : [combined.trim() || 'Test execution failed'];
}

// ─── Main Validation Function ─────────────────────────────────────────────────

export async function validateJavaTest(options: ValidateJavaTestOptions): Promise<ValidationResult> {
  const startTime = Date.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TEST_EXECUTION_TIMEOUT_MS;
  const executor = options.executor ?? new DefaultProcessExecutor();

  let workspaceDir: string | null = null;

  try {
    // Step 1: Create isolated temporary workspace
    workspaceDir = await mkdtemp(join(tmpdir(), 'javatest-'));

    // Prepare embedded JUnit 5 stubs and TestRunner
    await prepareJUnitWorkspace(workspaceDir);

    // Step 2: Write source and test files to workspace inside package dirs if applicable
    const sourceFilePath = join(workspaceDir, 'com', 'example', options.sourceFileName);
    const testFilePath = join(workspaceDir, 'com', 'example', options.testFileName);
    await mkdir(dirname(sourceFilePath), { recursive: true });

    await writeFile(sourceFilePath, options.sourceCode, 'utf8');
    await writeFile(testFilePath, options.testCode, 'utf8');

    // Step 3: Compilation Step
    const compileResult = await executor.execute({
      workspaceDir,
      command: 'javac',
      args: [
        'org/junit/jupiter/api/Test.java',
        'org/junit/jupiter/api/Assertions.java',
        'org/mockito/Mock.java',
        'org/mockito/InjectMocks.java',
        'org/mockito/Mockito.java',
        'com/example/TestRunner.java',
        `com/example/${options.sourceFileName}`,
        `com/example/${options.testFileName}`,
      ],
      timeoutMs,
      env: process.env as Record<string, string>,
    });

    if (compileResult.timedOut) {
      return {
        status: 'TIMEOUT',
        compiled: false,
        executed: false,
        passed: false,
        stdout: compileResult.stdout,
        stderr: compileResult.stderr,
        compileErrors: ['Compilation timed out'],
        durationMs: Date.now() - startTime,
      };
    }

    if (compileResult.exitCode !== 0) {
      return {
        status: 'COMPILE_ERROR',
        compiled: false,
        executed: false,
        passed: false,
        stdout: compileResult.stdout,
        stderr: compileResult.stderr,
        compileErrors: parseCompileErrors(compileResult.stderr, compileResult.stdout),
        durationMs: Date.now() - startTime,
      };
    }

    // Step 4: Execution Step (TestRunner runs JUnit 5 @Test methods)
    const fullTestClassName = `com.example.${options.testFileName.replace(/\.java$/, '')}`;
    const runResult = await executor.execute({
      workspaceDir,
      command: 'java',
      args: ['-cp', '.', 'com.example.TestRunner', fullTestClassName],
      timeoutMs,
      env: process.env as Record<string, string>,
    });

    if (runResult.timedOut) {
      return {
        status: 'TIMEOUT',
        compiled: true,
        executed: false,
        passed: false,
        stdout: runResult.stdout,
        stderr: runResult.stderr,
        durationMs: Date.now() - startTime,
      };
    }

    if (runResult.exitCode !== 0) {
      const isRuntimeError =
        runResult.stderr.includes('ClassNotFoundException') ||
        runResult.stderr.includes('NoClassDefFoundError') ||
        runResult.stderr.includes('Could not find or load main class');

      return {
        status: isRuntimeError ? 'RUNTIME_ERROR' : 'TEST_FAILURE',
        compiled: true,
        executed: !isRuntimeError,
        passed: false,
        stdout: runResult.stdout,
        stderr: runResult.stderr,
        testFailures: parseTestFailures(runResult.stdout, runResult.stderr),
        durationMs: Date.now() - startTime,
      };
    }

    // Step 5: Success
    return {
      status: 'PASSED',
      compiled: true,
      executed: true,
      passed: true,
      stdout: runResult.stdout,
      stderr: runResult.stderr,
      durationMs: Date.now() - startTime,
    };
  } catch (err: any) {
    return {
      status: 'RUNTIME_ERROR',
      compiled: false,
      executed: false,
      passed: false,
      stderr: err.message ?? String(err),
      durationMs: Date.now() - startTime,
    };
  } finally {
    if (workspaceDir) {
      try {
        await rm(workspaceDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}
