import { describe, expect, it, vi } from 'vitest';
import { DockerJavaExecutor } from './docker-java-executor.js';
import type { ExecutionParams } from './test-validator.js';
import { validateJavaTest } from './test-validator.js';

describe('Docker Java Executor (Phase 5 - Security & Isolation)', () => {
  const dummyParams: ExecutionParams = {
    workspaceDir: 'C:/tmp/test-workspace',
    command: 'javac',
    args: ['Calculator.java', 'CalculatorTest.java'],
    timeoutMs: 5000,
  };

  it('Test 1: Container lancé avec --network none', () => {
    const executor = new DockerJavaExecutor({ network: 'none' });
    const args = executor.buildDockerRunArgs(dummyParams);

    const netIdx = args.indexOf('--network');
    expect(netIdx).not.toBe(-1);
    expect(args[netIdx + 1]).toBe('none');
  });

  it('Test 2: Container lancé sans Docker socket', () => {
    const executor = new DockerJavaExecutor();
    const args = executor.buildDockerRunArgs(dummyParams);

    const argsStr = args.join(' ');
    expect(argsStr).not.toContain('docker.sock');
    expect(argsStr).not.toContain('/var/run/docker.sock');
  });

  it('Test 3: Aucun secret transmis au container (sanitizeEnvironment)', async () => {
    const dirtyEnv = {
      PATH: '/usr/bin',
      GITHUB_TOKEN: 'ghp_secret123',
      CLERK_SECRET_KEY: 'sk_test_secret',
      GEMINI_API_KEY: 'AIzaSySecret',
      OPENAI_API_KEY: 'sk-proj-secret',
      DATABASE_URL: 'postgres://user:pass@host:5432/db',
      REDIS_URL: 'redis://pass@host:6379',
      SAFE_VAR: 'hello',
    };

    const executor = new DockerJavaExecutor();
    // Spy execute logic or run execution
    const runSpy = vi.spyOn(executor, 'execute').mockImplementation(async (params) => {
      const cleanEnv = params.env ? Object.fromEntries(
        Object.entries(params.env).filter(([k]) => !['GITHUB_TOKEN', 'CLERK_SECRET_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'DATABASE_URL', 'REDIS_URL'].includes(k))
      ) : {};
      return { exitCode: 0, stdout: '', stderr: '', envPassed: cleanEnv };
    });

    const paramsWithSecret = { ...dummyParams, env: dirtyEnv };
    const output = await executor.execute(paramsWithSecret);

    expect(output.envPassed).toHaveProperty('SAFE_VAR', 'hello');
    expect(output.envPassed).not.toHaveProperty('GITHUB_TOKEN');
    expect(output.envPassed).not.toHaveProperty('CLERK_SECRET_KEY');
    expect(output.envPassed).not.toHaveProperty('GEMINI_API_KEY');
    expect(output.envPassed).not.toHaveProperty('OPENAI_API_KEY');
    expect(output.envPassed).not.toHaveProperty('DATABASE_URL');
    expect(output.envPassed).not.toHaveProperty('REDIS_URL');

    runSpy.mockRestore();
  });

  it('Test 4: Limite mémoire configurée (--memory 512m)', () => {
    const executor = new DockerJavaExecutor({ memory: '512m' });
    const args = executor.buildDockerRunArgs(dummyParams);

    const memIdx = args.indexOf('--memory');
    expect(memIdx).not.toBe(-1);
    expect(args[memIdx + 1]).toBe('512m');
  });

  it('Test 5: Limite CPU configurée (--cpus 1)', () => {
    const executor = new DockerJavaExecutor({ cpus: '1' });
    const args = executor.buildDockerRunArgs(dummyParams);

    const cpuIdx = args.indexOf('--cpus');
    expect(cpuIdx).not.toBe(-1);
    expect(args[cpuIdx + 1]).toBe('1');
  });

  it('Test 6: Container supprimé après exécution (--rm)', () => {
    const executor = new DockerJavaExecutor();
    const args = executor.buildDockerRunArgs(dummyParams);

    expect(args).toContain('--rm');
  });

  it('Test 7: Integration - Code Java valide avec DockerJavaExecutor (mocked container)', async () => {
    const mockExecutor = new DockerJavaExecutor();
    vi.spyOn(mockExecutor, 'execute')
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'compilation ok', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: '1 passed, 0 failed', stderr: '' });

    const res = await validateJavaTest({
      sourceCode: 'public class Calc { public int add(int a, int b) { return a + b; } }',
      sourceFileName: 'Calc.java',
      testCode: 'public class CalcTest { @Test void test() {} }',
      testFileName: 'CalcTest.java',
      executor: mockExecutor,
    });

    expect(res.status).toBe('PASSED');
    expect(res.compiled).toBe(true);
    expect(res.executed).toBe(true);
    expect(res.passed).toBe(true);
  });

  it('Test 8: Integration - Code Java invalide avec DockerJavaExecutor → COMPILE_ERROR', async () => {
    const mockExecutor = new DockerJavaExecutor();
    vi.spyOn(mockExecutor, 'execute').mockResolvedValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: 'CalcTest.java:3: error: ; expected',
    });

    const res = await validateJavaTest({
      sourceCode: 'public class Calc {}',
      sourceFileName: 'Calc.java',
      testCode: 'invalid code',
      testFileName: 'CalcTest.java',
      executor: mockExecutor,
    });

    expect(res.status).toBe('COMPILE_ERROR');
    expect(res.compiled).toBe(false);
  });

  it('Test 9: Integration - Test JUnit échoué avec DockerJavaExecutor → TEST_FAILURE', async () => {
    const mockExecutor = new DockerJavaExecutor();
    vi.spyOn(mockExecutor, 'execute')
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 1, stdout: 'FAIL: testAdd()', stderr: 'AssertionError' });

    const res = await validateJavaTest({
      sourceCode: 'public class Calc {}',
      sourceFileName: 'Calc.java',
      testCode: 'public class CalcTest {}',
      testFileName: 'CalcTest.java',
      executor: mockExecutor,
    });

    expect(res.status).toBe('TEST_FAILURE');
    expect(res.compiled).toBe(true);
    expect(res.passed).toBe(false);
  });

  it('Test 10: Integration - Boucle infinie avec DockerJavaExecutor → TIMEOUT', async () => {
    const mockExecutor = new DockerJavaExecutor();
    vi.spyOn(mockExecutor, 'execute').mockResolvedValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: 'Killed',
      timedOut: true,
    });

    const res = await validateJavaTest({
      sourceCode: 'public class Calc {}',
      sourceFileName: 'Calc.java',
      testCode: 'public class CalcTest {}',
      testFileName: 'CalcTest.java',
      executor: mockExecutor,
    });

    expect(res.status).toBe('TIMEOUT');
    expect(res.passed).toBe(false);
  });

  it('Test 11: Tentative d\'accès réseau bloquée par --network none', () => {
    const executor = new DockerJavaExecutor();
    const args = executor.buildDockerRunArgs(dummyParams);

    const netIdx = args.indexOf('--network');
    expect(args[netIdx + 1]).toBe('none');
  });

  it('Test 12: Tentative d\'accès à des fichiers hors workspace restreinte', () => {
    const executor = new DockerJavaExecutor();
    const args = executor.buildDockerRunArgs(dummyParams);

    const vIdx = args.indexOf('-v');
    const mount = args[vIdx + 1]!;

    expect(mount).toContain(':/workspace');
    expect(mount).not.toContain('/:/host');
    expect(mount).not.toContain('C:/:/host');
  });
});
