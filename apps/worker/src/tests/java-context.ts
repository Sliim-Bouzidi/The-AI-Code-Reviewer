/**
 * Java test context extraction (Phase 2).
 *
 * Responsibility chain:
 *   PR diff → modified Java files → Tree-sitter parse → modified Java methods → JavaMethodContext[]
 *
 * Reuses the existing Tree-sitter infrastructure (parseFile, changedSymbols) and diff utilities
 * (parseUnifiedDiff, DiffFile) unchanged.  No second parser is introduced.
 */

import Parser from 'web-tree-sitter';
import { languageOf } from '../index/chunker.js';
import { parseFile, changedSymbols } from '../index/symbols.js';
import type { ParsedFile, Symbol } from '../index/symbols.js';
import type { DiffFile } from '../review/diff.js';

// ─── Public types ─────────────────────────────────────────────────────────────

/** One Java method parameter extracted from the Tree-sitter AST. */
export interface JavaParameter {
  name: string;
  type: string;
}

/**
 * Full structural context for one Java method that was modified in a PR.
 * This is what the LLM receives in Phase 3 to generate JUnit 5 + Mockito tests.
 */
export interface JavaMethodContext {
  /** Relative path to the file inside the repository (e.g. "src/main/java/…/UserService.java"). */
  filePath: string;
  /** Simple Java class name (e.g. "UserService"). */
  className: string;
  /** Method name (e.g. "createUser"). */
  methodName: string;
  /** Full method signature string (e.g. "public User createUser(CreateUserDto dto)"). */
  signature: string;
  /** Parsed parameters. */
  parameters: JavaParameter[];
  /** Return type (e.g. "User", "void", "List<String>"). */
  returnType: string;
  /** Annotation names present on the method (e.g. ["Override", "Transactional"]). */
  annotations: string[];
  /** Raw body of the method (without the signature line). */
  methodBody: string;
  /** Full source of the method including signature and body. */
  methodCode: string;
  /** All import statements of the file (raw, as found in source). */
  imports: string[];
  /**
   * A narrow window of the surrounding class body (up to MAX_CLASS_CONTEXT_LINES lines above
   * and below the method) that gives the LLM just enough class-level context (fields, other
   * method signatures) without sending the entire file.
   */
  classContext: string;
  /** Names of other methods called from inside this method (from Tree-sitter). */
  calledMethods: string[];
  /** The diff hunk text that covers the changed lines of this method. */
  diffSnippet: string;
  /** First line of the method in the file (1-based). */
  lineStart: number;
  /** Last line of the method in the file (1-based). */
  lineEnd: number;
}

/** Outcome of extracting contexts from one DiffFile. */
export interface JavaContextExtractionResult {
  filePath: string;
  /** Successfully extracted method contexts. */
  contexts: JavaMethodContext[];
  /** Non-fatal issues encountered during extraction (logged, not thrown). */
  warnings: string[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Lines of surrounding class code (above + below) to include for class context. */
const MAX_CLASS_CONTEXT_LINES = 40;

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Collects all added-line numbers across every hunk of a DiffFile. */
function modifiedLines(file: DiffFile): Set<number> {
  // addedLines is populated by parseUnifiedDiff – use it directly.
  return file.addedLines;
}

/** Returns the diff text lines that overlap with [methodStart, methodEnd]. */
function diffSnippetForMethod(file: DiffFile, methodStart: number, methodEnd: number): string {
  const lines: string[] = [];
  for (const hunk of file.hunks) {
    let newLine = hunk.newStart;
    for (const raw of hunk.lines) {
      if (raw.startsWith('+') || raw.startsWith(' ')) {
        if (newLine >= methodStart && newLine <= methodEnd) lines.push(raw);
        newLine++;
      } else {
        // removed lines ('-') don't advance newLine
        lines.push(raw);
      }
    }
  }
  return lines.join('\n');
}

/**
 * Extracts a narrow window of the class body around the method to give the LLM
 * field declarations and sibling method signatures without sending the whole file.
 */
function classContextWindow(
  fileLines: string[],
  classStart: number,
  classEnd: number,
  methodStart: number,
  methodEnd: number,
): string {
  const half = Math.floor(MAX_CLASS_CONTEXT_LINES / 2);
  const windowStart = Math.max(classStart, methodStart - half);
  const windowEnd = Math.min(classEnd, methodEnd + half);
  return fileLines.slice(windowStart - 1, windowEnd).join('\n');
}

// ─── Java-specific AST extraction ────────────────────────────────────────────

/**
 * Regex-based fallback extraction for when we can't use the full Tree-sitter node.
 * Parses the first non-comment, non-annotation line of the method source for:
 *   - return type
 *   - parameter list
 *   - annotations
 *
 * This is intentionally simple for V1.  A future version can walk the full CST.
 */
function extractJavaMethodDetails(methodCode: string): {
  returnType: string;
  parameters: JavaParameter[];
  annotations: string[];
  signature: string;
} {
  const lines = methodCode.split('\n');

  // Collect annotations (@Foo, @Bar(x = y))
  const annotations: string[] = [];
  let signatureLine = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('@')) {
      const m = trimmed.match(/^@([\w.]+)/);
      if (m) annotations.push(m[1]!);
    } else if (trimmed.length > 0 && !trimmed.startsWith('//') && !trimmed.startsWith('/*') && !trimmed.startsWith('*')) {
      signatureLine = trimmed;
      break;
    }
  }

  // Extract the part before the opening brace as the signature
  const braceIdx = signatureLine.indexOf('{');
  const signature = (braceIdx !== -1 ? signatureLine.slice(0, braceIdx) : signatureLine).trim();

  // Parse return type and parameter list from signature like:
  //   public User createUser(CreateUserDto dto, boolean notify)
  //   private List<String> getNames()
  const paramMatch = signature.match(/\(([^)]*)\)\s*(?:throws\s+[\w\s,]+)?$/);
  const parameters: JavaParameter[] = [];
  if (paramMatch && paramMatch[1]!.trim().length > 0) {
    for (const part of paramMatch[1]!.split(',')) {
      const tokens = part.trim().split(/\s+/);
      if (tokens.length >= 2) {
        parameters.push({
          type: tokens.slice(0, -1).join(' '),
          name: tokens[tokens.length - 1]!,
        });
      }
    }
  }

  // Return type: the token immediately preceding the method name before '('
  // e.g. "public User createUser(" -> tokens before '(': ["public", "User", "createUser"] -> returnType: "User"
  const beforeParen = signature.split('(')[0]!.trim();
  const sigTokens = beforeParen.split(/\s+/);
  let returnType = 'void';
  if (sigTokens.length >= 2) {
    returnType = sigTokens[sigTokens.length - 2]!;
  }

  return { returnType, parameters, annotations, signature };
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Extracts JavaMethodContext objects for every Java method touched by the diff in `file`.
 *
 * @param file      - Parsed diff file (from parseUnifiedDiff).
 * @param content   - Full source content of the file on the new (HEAD) side.
 * @returns         - Extraction result with contexts and non-fatal warnings.
 */
export async function extractJavaMethodContexts(
  file: DiffFile,
  content: string,
): Promise<JavaContextExtractionResult> {
  const result: JavaContextExtractionResult = { filePath: file.path, contexts: [], warnings: [] };

  // Guard 1: only process Java files
  if (languageOf(file.path) !== 'java') {
    result.warnings.push(`${file.path} is not a Java file, skipping`);
    return result;
  }

  // Guard 2: deleted files must not be processed
  if (file.status === 'deleted') {
    result.warnings.push(`${file.path} was deleted, skipping`);
    return result;
  }

  // Guard 3: no added/modified lines → nothing to generate tests for
  const changed = modifiedLines(file);
  if (changed.size === 0) {
    result.warnings.push(`${file.path} has no added/modified lines, skipping`);
    return result;
  }

  // Parse the file with the existing Tree-sitter infrastructure (java grammar already supported)
  const parsed: ParsedFile | null = await parseFile(file.path, content);
  if (!parsed) {
    result.warnings.push(`${file.path}: Tree-sitter parse failed or language not supported`);
    return result;
  }

  // Find the symbols (methods/constructors) whose line range overlaps the diff
  const touched: Symbol[] = changedSymbols(parsed, changed).filter(
    (s) => s.kind === 'method_declaration' || s.kind === 'constructor_declaration',
  );

  if (touched.length === 0) {
    result.warnings.push(`${file.path}: Java file modified but no method/constructor identified in changed lines`);
    return result;
  }

  const fileLines = content.split(/\r?\n/);

  // Find the enclosing class for each method to provide class-level context
  const classes = parsed.symbols.filter(
    (s) => s.kind === 'class_declaration' || s.kind === 'interface_declaration',
  );

  for (const method of touched) {
    try {
      // Enclosing class: the smallest class that contains the method
      const enclosingClass = classes
        .filter((c) => c.startLine <= method.startLine && c.endLine >= method.endLine)
        .sort((a, b) => b.startLine - a.startLine)[0]; // innermost first

      const className = enclosingClass?.name ?? 'UnknownClass';

      // Raw method source
      const methodCode = fileLines.slice(method.startLine - 1, method.endLine).join('\n');
      // Body = method code minus the first signature line
      const bodyLines = methodCode.split('\n');
      const methodBody = bodyLines.slice(1).join('\n');

      const { returnType, parameters, annotations, signature } = extractJavaMethodDetails(methodCode);

      const classCtx = enclosingClass
        ? classContextWindow(fileLines, enclosingClass.startLine, enclosingClass.endLine, method.startLine, method.endLine)
        : '';

      result.contexts.push({
        filePath: file.path,
        className,
        methodName: method.name,
        signature,
        parameters,
        returnType,
        annotations,
        methodBody,
        methodCode,
        imports: parsed.imports,
        classContext: classCtx,
        calledMethods: method.calls,
        diffSnippet: diffSnippetForMethod(file, method.startLine, method.endLine),
        lineStart: method.startLine,
        lineEnd: method.endLine,
      });
    } catch (err) {
      result.warnings.push(`${file.path}#${method.name}: extraction failed — ${(err as Error).message}`);
    }
  }

  return result;
}

/**
 * Processes a list of diff files and returns JavaMethodContext objects only for
 * Java methods that were actually modified.
 *
 * This is the top-level function called by the future test-generation pipeline.
 *
 * @param files        - All DiffFile objects from parseUnifiedDiff.
 * @param getContent   - Async function to retrieve the HEAD-side file content by path.
 * @returns            - Flat list of JavaMethodContext (one per modified method across all Java files).
 */
export async function extractAllJavaMethodContexts(
  files: DiffFile[],
  getContent: (path: string) => Promise<string>,
): Promise<{ contexts: JavaMethodContext[]; warnings: string[] }> {
  const javaFiles = files.filter((f) => languageOf(f.path) === 'java' && f.status !== 'deleted');

  const allContexts: JavaMethodContext[] = [];
  const allWarnings: string[] = [];

  for (const file of javaFiles) {
    try {
      const content = await getContent(file.path);
      const result = await extractJavaMethodContexts(file, content);
      allContexts.push(...result.contexts);
      allWarnings.push(...result.warnings);
    } catch (err) {
      allWarnings.push(`${file.path}: could not retrieve content — ${(err as Error).message}`);
    }
  }

  return { contexts: allContexts, warnings: allWarnings };
}
