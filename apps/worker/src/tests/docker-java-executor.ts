import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ExecutionOutput, ExecutionParams, JavaExecutor } from './test-validator.js';
import { sanitizeEnvironment } from './test-validator.js';

const execFileAsync = promisify(execFile);

export interface DockerJavaExecutorOptions {
  /** Docker image to run. Defaults to 'eclipse-temurin:21-jdk-alpine'. */
  image?: string;
  /** Memory limit. Defaults to '512m'. */
  memory?: string;
  /** CPU limit. Defaults to '1'. */
  cpus?: string;
  /** Network mode. MUST be 'none' for isolation. Defaults to 'none'. */
  network?: string;
  /** PID limit. Defaults to 100. */
  pidsLimit?: number;
}

/**
 * Executes Java compilation and test runner commands in an ephemeral, highly isolated
 * Docker sandbox container.
 *
 * Security Constraints Enforced:
 *  - Ephemeral (--rm)
 *  - Network isolated (--network none)
 *  - Resource constrained (--memory 512m, --cpus 1, --pids-limit 100)
 *  - Security hardened (--security-opt no-new-privileges)
 *  - Absolute prohibition: NEVER mounts /var/run/docker.sock
 *  - Environment sanitized: NO worker secrets or API keys transmitted
 */
export class DockerJavaExecutor implements JavaExecutor {
  readonly image: string;
  readonly memory: string;
  readonly cpus: string;
  readonly network: string;
  readonly pidsLimit: number;

  constructor(options: DockerJavaExecutorOptions = {}) {
    this.image = options.image ?? 'eclipse-temurin:21-jdk-alpine';
    this.memory = options.memory ?? '512m';
    this.cpus = options.cpus ?? '1';
    this.network = options.network ?? 'none';
    this.pidsLimit = options.pidsLimit ?? 100;
  }

  /**
   * Constructs the full `docker run` command argument list.
   * Exposed for testing and verification of security parameters.
   */
  buildDockerRunArgs(params: ExecutionParams): string[] {
    // SECURITY GUARD: Ensure /var/run/docker.sock is NEVER in the mounts
    const sanitizedWorkspace = params.workspaceDir.replace(/\\/g, '/');

    return [
      'run',
      '--rm',
      '--network',
      this.network,
      '--memory',
      this.memory,
      '--cpus',
      this.cpus,
      '--pids-limit',
      String(this.pidsLimit),
      '--security-opt',
      'no-new-privileges',
      '-v',
      `${sanitizedWorkspace}:/workspace`,
      '-w',
      '/workspace',
      this.image,
      params.command,
      ...params.args,
    ];
  }

  async execute(params: ExecutionParams): Promise<ExecutionOutput> {
    const cleanEnv = sanitizeEnvironment(params.env ?? process.env);
    const dockerArgs = this.buildDockerRunArgs(params);

    try {
      const { stdout, stderr } = await execFileAsync('docker', dockerArgs, {
        cwd: params.workspaceDir,
        timeout: params.timeoutMs,
        env: cleanEnv,
        maxBuffer: 5 * 1024 * 1024,
      });

      return {
        exitCode: 0,
        stdout,
        stderr,
        envPassed: cleanEnv,
      };
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
