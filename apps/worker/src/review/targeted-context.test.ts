import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff, renderFileForLlm } from './diff.js';
import { parseFile } from '../index/symbols.js';
import { extractTargetedContext, renderTargetedContextForLlm, estimateTokens } from './targeted-context.js';

describe('Targeted Context Extraction (Step 1 Optimization)', () => {
  it('does not send full file content for a large file with a small change', async () => {
    const func1 = Array.from({ length: 50 }, (_, i) => `  const a${i} = ${i};`).join('\n');
    const func2 = `function calculateTotal(items: number[]) {\n  let sum = 0;\n  for (const item of items.filter(Boolean)) {\n    sum += item;\n  }\n  return sum;\n}`;
    const func3 = Array.from({ length: 100 }, (_, i) => `  const b${i} = ${i};`).join('\n');
    const fullContent = `// Header\nfunction helper1() {\n${func1}\n}\n\n${func2}\n\nfunction helper2() {\n${func3}\n}`;

    const diffText = `diff --git a/src/math.ts b/src/math.ts
index 1111111..2222222 100644
--- a/src/math.ts
+++ b/src/math.ts
@@ -58,3 +58,3 @@ function calculateTotal(items: number[]) {
   let sum = 0;
-  for (const item of items) {
+  for (const item of items.filter(Boolean)) {
     sum += item;
`;

    const files = parseUnifiedDiff(diffText);
    const file = files[0]!;
    const parsed = await parseFile('src/math.ts', fullContent);

    const result = await extractTargetedContext(file, { fileContent: fullContent, parsed });

    expect(result.formattedText.length).toBeLessThan(800);
    expect(result.formattedText).toContain('calculateTotal');
    expect(result.formattedText).not.toContain('const a49');
    expect(result.formattedText).not.toContain('const b99');

    const estimatedBefore = estimateTokens(fullContent);
    const estimatedAfter = result.estimatedTokens;
    expect(estimatedAfter).toBeLessThan(estimatedBefore / 3);
  });

  it('preserves concerned lines, added lines (+), and surrounding context', async () => {
    const content = `function processOrder(orderId: string) {\n  const order = await fetchOrderAsync(orderId);\n  if (!order) return null;\n  return order.total;\n}`;
    const diffText = `diff --git a/src/order.ts b/src/order.ts
index 1111111..2222222 100644
--- a/src/order.ts
+++ b/src/order.ts
@@ -1,5 +1,5 @@
 function processOrder(orderId: string) {
-  const order = fetchOrder(orderId);
+  const order = await fetchOrderAsync(orderId);
   if (!order) return null;
   return order.total;
 }`;

    const file = parseUnifiedDiff(diffText)[0]!;
    const result = await extractTargetedContext(file, { fileContent: content });

    expect(result.formattedText).toContain('processOrder');
    expect(result.formattedText).toContain('   2 +   const order = await fetchOrderAsync(orderId);');
    expect(result.formattedText).toContain('      -   const order = fetchOrder(orderId);');
    expect(result.formattedText).toContain('   1   function processOrder');
  });

  it('retains correct 1-based line numbers and file path headers', async () => {
    const linesBefore = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`);
    const linesAfter = Array.from({ length: 50 }, (_, i) => `line ${i + 51}`);
    const content = [...linesBefore, 'line 50.5', ...linesAfter].join('\n');
    const diffText = `diff --git a/src/utils.ts b/src/utils.ts
index 1111111..2222222 100644
--- a/src/utils.ts
+++ b/src/utils.ts
@@ -50,2 +50,3 @@
 line 50
+line 50.5
 line 51`;

    const file = parseUnifiedDiff(diffText)[0]!;
    const result = await extractTargetedContext(file, { fileContent: content });

    expect(result.formattedText).toContain('--- src/utils.ts:');
    expect(result.formattedText).toContain('  51 + line 50.5');
    expect(result.formattedText).toContain('  50   line 50');
  });

  it('extracts relevant symbols using syntax parsing', async () => {
    const content = `export class UserService {\n  async login(user: string) {\n    const query = db.sanitize(user);\n    return query;\n  }\n  async logout() {\n    return true;\n  }\n}`;
    const diffText = `diff --git a/src/user.ts b/src/user.ts
index 1111111..2222222 100644
--- a/src/user.ts
+++ b/src/user.ts
@@ -3,2 +3,2 @@ export class UserService {
-    const query = "SELECT * FROM users WHERE name = '" + user + "'";
+    const query = db.sanitize(user);
`;

    const file = parseUnifiedDiff(diffText)[0]!;
    const result = await extractTargetedContext(file, { fileContent: content });

    expect(result.formattedText).toContain('login');
    expect(result.formattedText).toContain('db.sanitize(user)');
  });

  it('handles files without AST symbols by using line windows', async () => {
    const content = `{\n  "name": "app",\n  "version": "1.0.0",\n  "port": 9090\n}`;
    const diffText = `diff --git a/config.json b/config.json
index 1111111..2222222 100644
--- a/config.json
+++ b/config.json
@@ -4,2 +4,2 @@
-  "port": 8080
+  "port": 9090
`;

    const file = parseUnifiedDiff(diffText)[0]!;
    const result = await extractTargetedContext(file, { fileContent: content });

    expect(result.formattedText).toContain('config.json');
    expect(result.formattedText).toContain('  4 +   "port": 9090');
  });

  it('handles deletion-only diffs correctly', async () => {
    const content = `function legacy() {\n  return true;\n}`;
    const diffText = `diff --git a/src/legacy.ts b/src/legacy.ts
index 1111111..2222222 100644
--- a/src/legacy.ts
+++ b/src/legacy.ts
@@ -2,1 +2,0 @@ function legacy() {
-  oldHelper();
`;

    const file = parseUnifiedDiff(diffText)[0]!;
    const result = await extractTargetedContext(file, { fileContent: content });

    expect(result.formattedText).toContain('legacy');
    expect(result.formattedText).toContain('      -   oldHelper();');
  });

  it('respects configurable maxChars size limit and appends truncation note', async () => {
    const content = Array.from({ length: 200 }, (_, i) => `// Line ${i + 1}: long content block`).join('\n');
    const diffText = `diff --git a/src/big.ts b/src/big.ts
index 1111111..2222222 100644
--- a/src/big.ts
+++ b/src/big.ts
@@ -10,100 +10,100 @@
- // line 10
+ // line 10 changed
`;

    const file = parseUnifiedDiff(diffText)[0]!;
    const result = await extractTargetedContext(file, { fileContent: content, maxChars: 250 });

    expect(result.formattedText.length).toBeLessThanOrEqual(250);
    expect(result.formattedText).toContain('context truncated');
  });

  it('maintains compatibility with renderFileForLlm fallback', () => {
    const diffText = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,2 @@
-foo
+bar
`;
    const file = parseUnifiedDiff(diffText)[0]!;
    const fallbackText = renderFileForLlm(file);
    const targetedText = renderTargetedContextForLlm(file);

    expect(fallbackText).toContain('   1 +bar');
    expect(targetedText).toContain('   1 +bar');
  });

  it('provides estimated token reduction metrics before vs after', async () => {
    const funcLines = Array.from({ length: 400 }, (_, i) => `function unused${i}() { return ${i}; }`).join('\n');
    const fullContent = `${funcLines}\n\nfunction target() {\n  const secret = process.env.SECRET;\n  return secret;\n}`;

    const diffText = `diff --git a/src/auth.ts b/src/auth.ts
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -402,2 +402,2 @@ function target() {
-  const secret = "hardcoded_token";
+  const secret = process.env.SECRET;
`;

    const file = parseUnifiedDiff(diffText)[0]!;
    const parsed = await parseFile('src/auth.ts', fullContent);

    const estimatedFullFileTokens = estimateTokens(fullContent);
    const result = await extractTargetedContext(file, { fileContent: fullContent, parsed });

    expect(result.estimatedTokens).toBeLessThan(estimatedFullFileTokens);
    expect(result.estimatedTokens).toBeLessThan(200);
  });
});
