import { describe, expect, it } from 'vitest';
import type { DiffFile } from '../review/diff.js';
import { extractJavaMethodContexts } from './java-context.js';

const JAVA_FILE_CONTENT = `package com.example;

import java.util.List;
import com.example.model.User;

public class UserService {

    @Override
    public User createUser(String name, int age) {
        if (name == null) {
            throw new IllegalArgumentException("Name cannot be null");
        }
        return new User(name, age);
    }

    public List<User> listUsers() {
        return List.of();
    }
}
`;

function createMockDiffFile(overrides: Partial<DiffFile> = {}): DiffFile {
  return {
    path: 'src/main/java/com/example/UserService.java',
    oldPath: null,
    status: 'modified',
    binary: false,
    hunks: [
      {
        oldStart: 8,
        newStart: 8,
        header: '@@ -8,7 +8,7 @@',
        lines: [
          '     public User createUser(String name, int age) {',
          '+        if (name == null) {',
          '+            throw new IllegalArgumentException("Name cannot be null");',
          '+        }',
          '         return new User(name, age);',
        ],
      },
    ],
    addedLines: new Set([9, 10, 11]),
    commentableLines: new Set([8, 9, 10, 11, 12]),
    ...overrides,
  };
}

describe('Java Context Extractor (Phase 2)', () => {
  it('Test 1: Une méthode Java modifiée est correctement détectée', async () => {
    const diffFile = createMockDiffFile();
    const result = await extractJavaMethodContexts(diffFile, JAVA_FILE_CONTENT);

    expect(result.contexts).toHaveLength(1);
    expect(result.contexts[0]?.methodName).toBe('createUser');
  });

  it('Test 2: Une méthode Java non modifiée n\'est pas sélectionnée', async () => {
    const diffFile = createMockDiffFile();
    const result = await extractJavaMethodContexts(diffFile, JAVA_FILE_CONTENT);

    const methodNames = result.contexts.map((c) => c.methodName);
    expect(methodNames).toContain('createUser');
    expect(methodNames).not.toContain('listUsers');
  });

  it('Test 3: Plusieurs méthodes modifiées produisent plusieurs contextes', async () => {
    const diffFile = createMockDiffFile({
      addedLines: new Set([9, 16]), // line 9 is in createUser, line 16 is in listUsers
    });
    const result = await extractJavaMethodContexts(diffFile, JAVA_FILE_CONTENT);

    expect(result.contexts).toHaveLength(2);
    const methodNames = result.contexts.map((c) => c.methodName);
    expect(methodNames).toContain('createUser');
    expect(methodNames).toContain('listUsers');
  });

  it('Test 4: Une classe Java modifiée sans méthode identifiable est correctement gérée', async () => {
    const diffFile = createMockDiffFile({
      addedLines: new Set([1]), // package statement line
    });
    const result = await extractJavaMethodContexts(diffFile, JAVA_FILE_CONTENT);

    expect(result.contexts).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('no method/constructor identified');
  });

  it('Test 5: Les paramètres et le type de retour sont correctement extraits', async () => {
    const diffFile = createMockDiffFile();
    const result = await extractJavaMethodContexts(diffFile, JAVA_FILE_CONTENT);

    const ctx = result.contexts[0]!;
    expect(ctx.returnType).toBe('User');
    expect(ctx.parameters).toEqual([
      { type: 'String', name: 'name' },
      { type: 'int', name: 'age' },
    ]);
    expect(ctx.annotations).toContain('Override');
  });

  it('Test 6: Le corps de la méthode est correctement extrait', async () => {
    const diffFile = createMockDiffFile();
    const result = await extractJavaMethodContexts(diffFile, JAVA_FILE_CONTENT);

    const ctx = result.contexts[0]!;
    expect(ctx.methodBody).toContain('throw new IllegalArgumentException');
    expect(ctx.methodCode).toContain('public User createUser');
  });

  it('Test 7: Les imports pertinents sont récupérés', async () => {
    const diffFile = createMockDiffFile();
    const result = await extractJavaMethodContexts(diffFile, JAVA_FILE_CONTENT);

    const ctx = result.contexts[0]!;
    expect(ctx.imports).toEqual(
      expect.arrayContaining([
        expect.stringContaining('import java.util.List;'),
        expect.stringContaining('import com.example.model.User;'),
      ]),
    );
  });

  it('Test 8: Une méthode supprimée (fichier supprimé) n\'est pas traitée comme une méthode à tester', async () => {
    const diffFile = createMockDiffFile({
      status: 'deleted',
    });
    const result = await extractJavaMethodContexts(diffFile, JAVA_FILE_CONTENT);

    expect(result.contexts).toHaveLength(0);
    expect(result.warnings[0]).toContain('was deleted, skipping');
  });
});
