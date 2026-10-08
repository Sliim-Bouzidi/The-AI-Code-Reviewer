import { describe, expect, it, vi } from 'vitest';
import { LlmError } from '@codereview/llm';
import type { LlmProvider } from '@codereview/llm';
import type { JavaMethodContext } from './java-context.js';
import { buildTestGenerationPrompt, generateTestForMethod } from './test-generator.js';

const MOCK_JAVA_CONTEXT: JavaMethodContext = {
  filePath: 'src/main/java/com/example/UserService.java',
  className: 'UserService',
  methodName: 'createUser',
  signature: 'public User createUser(String name, int age)',
  parameters: [
    { type: 'String', name: 'name' },
    { type: 'int', name: 'age' },
  ],
  returnType: 'User',
  annotations: ['Override'],
  methodBody: 'if (name == null) throw new IllegalArgumentException(); return new User(name, age);',
  methodCode: 'public User createUser(String name, int age) {\n  if (name == null) throw new IllegalArgumentException();\n  return new User(name, age);\n}',
  imports: ['import com.example.model.User;'],
  classContext: 'public class UserService {\n  public User createUser(String name, int age) {...}\n}',
  calledMethods: [],
  diffSnippet: '+  if (name == null) throw new IllegalArgumentException();',
  lineStart: 10,
  lineEnd: 15,
};

function createMockLlmProvider(responseText: string): LlmProvider {
  return {
    name: 'mock-provider',
    model: 'mock-model',
    generate: vi.fn().mockResolvedValue({
      text: responseText,
      tokensIn: 150,
      tokensOut: 200,
    }),
  };
}

describe('Test Generator (Phase 3)', () => {
  describe('Prompt Construction', () => {
    it('Section 13: Contient toutes les informations essentielles de JavaMethodContext', () => {
      const prompt = buildTestGenerationPrompt(MOCK_JAVA_CONTEXT);

      expect(prompt).toContain('Target Class: UserService');
      expect(prompt).toContain('Target Method: createUser');
      expect(prompt).toContain('Signature: public User createUser(String name, int age)');
      expect(prompt).toContain('Modified Method Source Code:');
      expect(prompt).toContain('File Imports:');
      expect(prompt).toContain('import com.example.model.User;');
      expect(prompt).toContain('Surrounding Class Context:');
      expect(prompt).toContain('Diff Hunk (Modified Lines):');
      expect(prompt).toContain('+  if (name == null) throw new IllegalArgumentException();');
    });
  });

  describe('LLM Output Generation & Zod Validation', () => {
    it('Test 1 & 2: Un contexte Java valide avec réponse LLM valide est correctement parsé', async () => {
      const validJson = JSON.stringify({
        testClassName: 'UserServiceTest',
        imports: [
          'org.junit.jupiter.api.Test',
          'org.junit.jupiter.api.Assertions.*',
        ],
        annotations: ['@ExtendWith(MockitoExtension.class)'],
        testCode: `package com.example;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class UserServiceTest {
    @Test
    void shouldCreateUserSuccessfully() {
        UserService service = new UserService();
        User user = service.createUser("Alice", 30);
        assertNotNull(user);
    }
}`,
        tests: [
          {
            name: 'shouldCreateUserSuccessfully',
            description: 'Verifies normal user creation',
            category: 'NORMAL',
          },
        ],
      });

      const mockProvider = createMockLlmProvider(validJson);
      const res = await generateTestForMethod([mockProvider], MOCK_JAVA_CONTEXT);

      expect(res.data.testClassName).toBe('UserServiceTest');
      expect(res.data.tests).toHaveLength(1);
      expect(res.data.tests[0]?.category).toBe('NORMAL');
      expect(res.provider).toBe('mock-provider');
      expect(res.model).toBe('mock-model');
    });

    it('Test 3: Une réponse JSON invalide est rejetée', async () => {
      const invalidJson = '{ "malformed": true }';
      const mockProvider = createMockLlmProvider(invalidJson);

      await expect(generateTestForMethod([mockProvider], MOCK_JAVA_CONTEXT)).rejects.toThrow();
    });

    it('Test 4: Une réponse sans testCode valide est rejetée', async () => {
      const missingTestCode = JSON.stringify({
        testClassName: 'UserServiceTest',
        imports: [],
        testCode: '', // empty testCode fails z.string().min(1)
        tests: [
          {
            name: 'test1',
            description: 'desc',
            category: 'NORMAL',
          },
        ],
      });
      const mockProvider = createMockLlmProvider(missingTestCode);

      await expect(generateTestForMethod([mockProvider], MOCK_JAVA_CONTEXT)).rejects.toThrow();
    });

    it('Test 5 & 6: Plusieurs tests et les catégories NORMAL, EDGE_CASE, ERROR sont correctement gérées', async () => {
      const multiCategoryJson = JSON.stringify({
        testClassName: 'UserServiceTest',
        imports: ['org.junit.jupiter.api.Test'],
        testCode: 'class UserServiceTest {}',
        tests: [
          {
            name: 'shouldCreateUser',
            description: 'Normal case',
            category: 'NORMAL',
          },
          {
            name: 'shouldHandleEmptyName',
            description: 'Edge case',
            category: 'EDGE_CASE',
          },
          {
            name: 'shouldThrowOnNullName',
            description: 'Error case',
            category: 'ERROR',
          },
        ],
      });

      const mockProvider = createMockLlmProvider(multiCategoryJson);
      const res = await generateTestForMethod([mockProvider], MOCK_JAVA_CONTEXT);

      expect(res.data.tests).toHaveLength(3);
      expect(res.data.tests[0]?.category).toBe('NORMAL');
      expect(res.data.tests[1]?.category).toBe('EDGE_CASE');
      expect(res.data.tests[2]?.category).toBe('ERROR');
    });

    it('Test 7: Une erreur du provider LLM est correctement propagée', async () => {
      const failingProvider: LlmProvider = {
        name: 'failing-provider',
        model: 'failing-model',
        generate: vi.fn().mockRejectedValue(new LlmError('API quota exceeded', 429, false)),
      };

      await expect(generateTestForMethod([failingProvider], MOCK_JAVA_CONTEXT)).rejects.toThrow('API quota exceeded');
    });

    it('Test 8: System prompt interdit le code narratif et impose JUnit 5 & Mockito', async () => {
      const validJson = JSON.stringify({
        testClassName: 'UserServiceTest',
        imports: ['org.junit.jupiter.api.Test'],
        testCode: 'class UserServiceTest {}',
        tests: [{ name: 'test', description: 'desc', category: 'NORMAL' }],
      });
      const mockProvider = createMockLlmProvider(validJson);

      await generateTestForMethod([mockProvider], MOCK_JAVA_CONTEXT);

      const calls = (mockProvider.generate as any).mock.calls;
      const input = calls[0][0];

      expect(input.system).toContain('JUnit 5');
      expect(input.system).toContain('Mockito');
      expect(input.system).toContain('Do NOT use JUnit 4');
      expect(input.system).toContain('Use only APIs, methods, constructors, and dependencies');
      expect(input.system).toContain('Do not transmit or leak any secrets');
    });
  });
});
