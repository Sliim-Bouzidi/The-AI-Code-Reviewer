import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { parseUnifiedDiff, reconstructFileFromDiff } from './diff.js';
import { runSemgrep } from './semgrep.js';
import { validateAndRank } from './validate.js';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

describe('Local Diff Semgrep Integration & File Reconstruction', () => {
  describe('1. reconstructFileFromDiff (Diff Content Reconstruction)', () => {
    it('reconstruit fidèlement un fichier nouvellement ajouté (status === added)', () => {
      const diffAdded = `diff --git a/app.py b/app.py
new file mode 100644
--- /dev/null
+++ b/app.py
@@ -0,0 +1,5 @@
+import os
+import sys
+
+def execute(code):
+    eval(code)
`;
      const [file] = parseUnifiedDiff(diffAdded);
      expect(file).toBeDefined();
      expect(file!.status).toBe('added');

      const reconstructed = reconstructFileFromDiff(file!);
      const lines = reconstructed.split('\n');

      expect(lines).toHaveLength(5);
      expect(lines[0]).toBe('import os');
      expect(lines[1]).toBe('import sys');
      expect(lines[2]).toBe('');
      expect(lines[3]).toBe('def execute(code):');
      expect(lines[4]).toBe('    eval(code)');
    });

    it('reconstruit un fichier modifié avec alignement exact des numéros de lignes (padding)', () => {
      const diffModified = `diff --git a/src/auth.ts b/src/auth.ts
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -10,4 +10,5 @@
 function checkAuth(token: string) {
   const valid = verify(token);
+  const apiKey = "SECRET_API_KEY_12345";
   log("verified");
   return valid;
 }
`;
      const [file] = parseUnifiedDiff(diffModified);
      expect(file).toBeDefined();
      expect(file!.status).toBe('modified');

      const reconstructed = reconstructFileFromDiff(file!);
      const lines = reconstructed.split('\n');

      // Le hunk commence à la ligne 10. Les lignes 1 à 9 doivent être paddées avec des lignes vides
      expect(lines.length).toBeGreaterThanOrEqual(14);
      expect(lines[0]).toBe(''); // Ligne 1
      expect(lines[8]).toBe(''); // Ligne 9
      expect(lines[9]).toBe('function checkAuth(token: string) {'); // Ligne 10 (hunk start)
      expect(lines[10]).toBe('  const valid = verify(token);'); // Ligne 11
      expect(lines[11]).toBe('  const apiKey = "SECRET_API_KEY_12345";'); // Ligne 12 (ligne ajoutée)
      expect(lines[12]).toBe('  log("verified");'); // Ligne 13
      expect(lines[13]).toBe('  return valid;'); // Ligne 14
    });

    it('ignore les lignes supprimées ("-") lors de la reconstruction du nouveau fichier', () => {
      const diffWithDeletions = `diff --git a/calc.ts b/calc.ts
--- a/calc.ts
+++ b/calc.ts
@@ -1,3 +1,3 @@
-const oldVal = 1;
+const newVal = 2;
 const stable = 3;
`;
      const [file] = parseUnifiedDiff(diffWithDeletions);
      const reconstructed = reconstructFileFromDiff(file!);
      const lines = reconstructed.split('\n');

      expect(reconstructed).not.toContain('oldVal');
      expect(lines[0]).toBe('const newVal = 2;');
      expect(lines[1]).toBe('const stable = 3;');
    });

    it('retourne une chaîne vide pour les fichiers supprimés ou binaires', () => {
      const diffDeleted = `diff --git a/old.ts b/old.ts
deleted file mode 100644
--- a/old.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-const a = 1;
-const b = 2;
`;
      const [deletedFile] = parseUnifiedDiff(diffDeleted);
      expect(reconstructFileFromDiff(deletedFile!)).toBe('');

      const binaryFile = {
        path: 'image.png',
        oldPath: null,
        status: 'modified' as const,
        binary: true,
        hunks: [],
        addedLines: new Set<number>(),
        commentableLines: new Set<number>(),
      };
      expect(reconstructFileFromDiff(binaryFile)).toBe('');
    });
  });

  describe('2. Sécurité du système de fichiers (Path Traversal & Isolation)', () => {
    let testTempDir: string;

    beforeEach(async () => {
      testTempDir = await mkdtemp(join(tmpdir(), 'codereview-security-test-'));
    });

    afterEach(async () => {
      await rm(testTempDir, { recursive: true, force: true });
    });

    it('bloque les tentatives d’évasion de répertoire (path traversal) dans les chemins de diff', () => {
      const traversalPaths = [
        '../../etc/passwd',
        '..\\..\\windows\\system32\\cmd.exe',
        'sub/../../secret.txt',
      ];

      const resolvedDir = resolve(testTempDir);

      for (const dangerousPath of traversalPaths) {
        const target = resolve(testTempDir, dangerousPath);
        const isSafe = target.startsWith(resolvedDir);
        expect(isSafe).toBe(false);
      }

      // Chemin sécurisé
      const safePath = 'src/components/button.tsx';
      const safeTarget = resolve(testTempDir, safePath);
      expect(safeTarget.startsWith(resolvedDir)).toBe(true);
    });
  });

  describe('3. Exécution Semgrep et gestion des erreurs (runSemgrep)', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'codereview-semgrep-test-'));
    });

    afterEach(async () => {
      vi.clearAllMocks();
      await rm(tempDir, { recursive: true, force: true });
    });

    it('mappe correctement les alertes Semgrep avec chemins relatifs et sévérités', async () => {
      const fakeFindingPath = join(tempDir, 'app.py');
      const fakeOutput = JSON.stringify({
        results: [
          {
            check_id: 'rules.python.security.dangerous-eval',
            path: fakeFindingPath,
            start: { line: 5, col: 5 },
            end: { line: 5, col: 20 },
            extra: {
              severity: 'ERROR',
              message: 'Use of dangerous eval function',
              metadata: { category: 'security' },
              fix: 'ast.literal_eval',
            },
          },
          {
            check_id: 'rules.python.style.unused-import',
            path: fakeFindingPath,
            start: { line: 1, col: 1 },
            end: { line: 1, col: 10 },
            extra: {
              severity: 'WARNING',
              message: 'Unused import sys',
              metadata: { category: 'style' },
            },
          },
        ],
      });

      vi.mocked(execFile).mockImplementation((cmd: any, args: any, opts: any, cb: any) => {
        const callback = (typeof opts === 'function' ? opts : cb) as (err: any, stdout: string, stderr: string) => void;
        callback(null, fakeOutput, '');
        return {} as any;
      });

      const findings = await runSemgrep(tempDir);

      expect(findings).toHaveLength(2);

      const f1 = findings[0]!;
      expect(f1.filePath).toBe('app.py');
      expect(f1.lineStart).toBe(5);
      expect(f1.severity).toBe('high'); // ERROR -> high
      expect(f1.category).toBe('security');
      expect(f1.source).toBe('semgrep');
      expect(f1.ruleId).toBe('rules.python.security.dangerous-eval');
      expect(f1.suggestion).toBe('ast.literal_eval');

      const f2 = findings[1]!;
      expect(f2.filePath).toBe('app.py');
      expect(f2.lineStart).toBe(1);
      expect(f2.severity).toBe('medium'); // WARNING -> medium
      expect(f2.category).toBe('bug'); // non-security category fallback to bug
    });

    it('gère l’indisponibilité de Semgrep (ENOENT) proprement sans lever d’erreur', async () => {
      vi.mocked(execFile).mockImplementation((cmd: any, args: any, opts: any, cb: any) => {
        const callback = (typeof opts === 'function' ? opts : cb) as (err: any, stdout: string, stderr: string) => void;
        const enoentErr = new Error('spawn semgrep ENOENT') as NodeJS.ErrnoException;
        enoentErr.code = 'ENOENT';
        callback(enoentErr, '', '');
        return {} as any;
      });

      const findings = await runSemgrep(tempDir);
      expect(findings).toEqual([]);
    });

    it('gère un plantage ou une sortie non-JSON de Semgrep sans interrompre le pipeline', async () => {
      vi.mocked(execFile).mockImplementation((cmd: any, args: any, opts: any, cb: any) => {
        const callback = (typeof opts === 'function' ? opts : cb) as (err: any, stdout: string, stderr: string) => void;
        callback(null, 'Fatal error: Segmentation fault in semgrep engine', '');
        return {} as any;
      });

      const findings = await runSemgrep(tempDir);
      expect(findings).toEqual([]);
    });
  });

  describe('4. Intégration du cycle de vie local diff (Reconstruction -> Semgrep -> Validation -> Nettoyage)', () => {
    it('exécute le cycle complet : reconstruction, analyse statique, validation sur les lignes du diff et suppression du temp dir', async () => {
      const diff = `diff --git a/app.py b/app.py
new file mode 100644
--- /dev/null
+++ b/app.py
@@ -0,0 +1,5 @@
+import os
+import sys
+
+def execute(code):
+    eval(code)
`;
      const files = parseUnifiedDiff(diff);
      let localTempDir: string | undefined;

      try {
        localTempDir = await mkdtemp(join(tmpdir(), 'codereview-lifecycle-'));
        const resolvedDir = resolve(localTempDir);

        for (const file of files) {
          const content = reconstructFileFromDiff(file);
          expect(content).toBeTruthy();
          const target = resolve(localTempDir, file.path);
          expect(target.startsWith(resolvedDir)).toBe(true);
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, content, 'utf8');
        }

        // Mock Semgrep retournant 1 finding valide sur la ligne 5 et 1 finding hors diff sur la ligne 99
        vi.mocked(execFile).mockImplementation((cmd: any, args: any, opts: any, cb: any) => {
          const callback = (typeof opts === 'function' ? opts : cb) as (err: any, stdout: string, stderr: string) => void;
          const output = JSON.stringify({
            results: [
              {
                check_id: 'rules.python.security.dangerous-eval',
                path: join(localTempDir!, 'app.py'),
                start: { line: 5, col: 5 },
                end: { line: 5, col: 15 },
                extra: { severity: 'ERROR', message: 'Dangerous eval()', metadata: { category: 'security' } },
              },
              {
                check_id: 'rules.python.style.comment',
                path: join(localTempDir!, 'app.py'),
                start: { line: 99, col: 1 },
                end: { line: 99, col: 10 },
                extra: { severity: 'INFO', message: 'Out of diff line', metadata: { category: 'style' } },
              },
            ],
          });
          callback(null, output, '');
          return {} as any;
        });

        const semgrepFindings = await runSemgrep(localTempDir);
        expect(semgrepFindings).toHaveLength(2);

        // Validation & Ranking (vérifie que les alertes correspondent bien aux lignes du diff)
        const validated = validateAndRank(semgrepFindings, files, { strictness: 'medium', maxComments: 10 });
        expect(validated).toHaveLength(1);
        expect(validated[0]!.filePath).toBe('app.py');
        expect(validated[0]!.lineStart).toBe(5);
        expect(validated[0]!.message).toContain('Dangerous eval()');
      } finally {
        if (localTempDir) {
          await rm(localTempDir, { recursive: true, force: true });
        }
      }

      // Vérification que le dossier temporaire a bien été supprimé
      await expect(stat(localTempDir!)).rejects.toThrow();
    });
  });
});
