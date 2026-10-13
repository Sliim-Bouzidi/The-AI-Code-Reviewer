import { z } from 'zod';

// ---------- repository structure analysis (graph of files, symbols and relations) ----------

export const AnalysisStatusSchema = z.enum(['analyzing', 'ready', 'failed']);
export type AnalysisStatus = z.infer<typeof AnalysisStatusSchema>;

/** import = file imports file/package; extends / implements = symbol-level; call = symbol calls symbol. */
export const RelationKindSchema = z.enum(['import', 'extends', 'implements', 'call']);
export type RelationKind = z.infer<typeof RelationKindSchema>;

/**
 * How sure the analyser is about the target of a relation:
 * - exact: the target is named by the code or by the repository's own configuration (a relative import, a tsconfig path
 *   alias, an imported Java class, an external package);
 * - inferred: matched by name or by convention only (same file, one candidate in the repo, a monorepo package's guessed
 *   entry file): probably right, not proven;
 * - unresolved: several candidates or an alias the analyser cannot follow (the relation is kept, but never drawn as certain).
 */
export const ConfidenceSchema = z.enum(['exact', 'inferred', 'unresolved']);
export type Confidence = z.infer<typeof ConfidenceSchema>;

/** Git branch names we accept: conservative, and never starts with "-" (it ends up in a git command line). */
export const BranchNameSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._/-]+$/, 'Invalid branch name')
  .refine((b) => !b.startsWith('-') && !b.includes('..') && !b.endsWith('/') && !b.endsWith('.lock'), 'Invalid branch name');

export const AnalyzeBodySchema = z.object({ branch: BranchNameSchema.optional() });
export type AnalyzeBody = z.infer<typeof AnalyzeBodySchema>;

export const BranchQuerySchema = z.object({ branch: BranchNameSchema.optional() });

export const AnalysisSchema = z.object({
  branch: z.string(),
  status: AnalysisStatusSchema,
  commitSha: z.string().nullable(),
  /** Progress text while analysing, or the reason it failed. */
  progress: z.string().nullable(),
  filesCount: z.number(),
  symbolsCount: z.number(),
  relationsCount: z.number(),
  updatedAt: z.string(),
});
export type Analysis = z.infer<typeof AnalysisSchema>;

export const BranchesResponseSchema = z.object({
  defaultBranch: z.string().nullable(),
  branches: z.array(z.string()),
  /** True when the repository has more branches than the list returned. */
  truncated: z.boolean(),
});
export type BranchesResponse = z.infer<typeof BranchesResponseSchema>;

// ---------- diagrams ----------

export const DiagramKindSchema = z.enum(['packages', 'dependencies', 'classes']);
export type DiagramKind = z.infer<typeof DiagramKindSchema>;

export const DiagramQuerySchema = z.object({
  kind: DiagramKindSchema,
  branch: BranchNameSchema.optional(),
  /** Only elements whose path starts with this prefix ("apps/api/src"). */
  scope: z
    .string()
    .max(300)
    .regex(/^[^\0\\]*$/)
    .optional(),
  /** packages: directory depth to group by (default: chosen automatically). */
  depth: z.coerce.number().int().min(1).max(8).optional(),
  /** dependencies: also draw external packages. */
  external: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  /** Cap on drawn nodes: the most connected ones are kept. */
  limit: z.coerce.number().int().min(5).max(200).optional(),
});
export type DiagramQuery = z.infer<typeof DiagramQuerySchema>;

export const DiagramNodeSchema = z.object({
  /** Id used in the Mermaid text. */
  id: z.string(),
  label: z.string(),
  kind: z.enum(['directory', 'file', 'class', 'interface', 'enum', 'external']),
  /** Repository-relative path (directory or file), absent for external packages. */
  path: z.string().nullable(),
  line: z.number().nullable(),
});
export const DiagramEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  kind: RelationKindSchema,
  confidence: ConfidenceSchema,
  /** Number of underlying relations (grouped edges of the packages diagram). */
  weight: z.number(),
});
export const DiagramSchema = z.object({
  kind: DiagramKindSchema,
  branch: z.string(),
  commitSha: z.string().nullable(),
  mermaid: z.string(),
  nodes: z.array(DiagramNodeSchema),
  edges: z.array(DiagramEdgeSchema),
  /** Human-readable facts about what is shown (chosen depth, caps, limits of the analysis). */
  notes: z.array(z.string()),
  truncated: z.boolean(),
});
export type DiagramNode = z.infer<typeof DiagramNodeSchema>;
export type DiagramEdge = z.infer<typeof DiagramEdgeSchema>;
export type Diagram = z.infer<typeof DiagramSchema>;

/**
 * Kind of type a Tree-sitter symbol node is, or null for functions, methods and other symbols.
 * Shared by the worker (to resolve base types) and the API (to draw class diagrams).
 */
export function typeKindOf(symbolKind: string): 'class' | 'interface' | 'enum' | null {
  switch (symbolKind) {
    case 'class_declaration':
    case 'abstract_class_declaration':
    case 'class_definition':
    case 'record_declaration':
      return 'class';
    case 'interface_declaration':
      return 'interface';
    case 'enum_declaration':
      return 'enum';
    default:
      return null;
  }
}

/** Languages that carry code (the others, like markdown or json, are not part of the structure graph). */
export const NON_CODE_LANGUAGES = new Set(['markdown', 'yaml', 'json', 'sql']);
