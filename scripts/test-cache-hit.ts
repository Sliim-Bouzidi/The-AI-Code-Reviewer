import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '@codereview/db';
import { eq, llmCache } from '@codereview/db';
import type { LlmProvider } from '@codereview/llm';
import type { DiffFile, SemgrepAlert } from '@codereview/shared';
import { DbLlmCacheStore, createCacheKey } from '../apps/worker/src/review/llm-cache.js';
import { reviewBatches } from '../apps/worker/src/review/llm-review.js';
import { extractTargetedContext } from '../apps/worker/src/review/targeted-context.js';

async function validatePassage2CacheHit() {
  console.log('--- Initialisation de la validation ciblée du Passage 2 (Cache Hit PostgreSQL) ---');

  const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/codereview';
  const dbUrl = new URL(connectionString);

  // Masquage du mot de passe pour la sécurité
  const safeDbUrl = `${dbUrl.protocol}//${dbUrl.hostname}:${dbUrl.port}${dbUrl.pathname}`;
  console.log(`[CIBLE DB] Cible: ${safeDbUrl}`);

  if (dbUrl.hostname !== 'localhost' && dbUrl.hostname !== '127.0.0.1') {
    throw new Error('[ABANDON DE SÉCURITÉ] La base de données ciblée n\'est pas locale.');
  }

  const sqlClient = postgres(connectionString, { max: 2 });
  const db = drizzle(sqlClient, { schema });

  try {
    const TARGET_KEY = '205fae0273ab96e24dae767a18d2d5db440be299273a3ea1b8b1755ffb7a6cf5';

    // 1. Vérification préalable de l'existence et de la cohérence de la ligne dans PostgreSQL
    console.log(`[POSTGRES] Contrôle de la ligne existante (${TARGET_KEY.slice(0, 16)}...)...`);
    const dbRows = await db.select().from(llmCache).where(eq(llmCache.cacheKey, TARGET_KEY));

    if (dbRows.length !== 1) {
      throw new Error(`[ÉCHEC] La ligne de cache pré-existante avec la clé ${TARGET_KEY} est introuvable.`);
    }

    const cachedRow = dbRows[0]!;
    console.log(`[POSTGRES] Entrée présente en base :
    - Provider: ${cachedRow.provider}
    - Model: ${cachedRow.model}
    - Tier: ${cachedRow.tier}
    - Tokens In / Out: ${cachedRow.tokensIn} / ${cachedRow.tokensOut}
    - Decision: ${(cachedRow.data as any)?.decision}`);

    if (cachedRow.provider !== 'gemini' || cachedRow.model !== 'gemini-3.5-flash') {
      throw new Error('[ÉCHEC] Métadonnées de fournisseur incohérentes dans la ligne PostgreSQL.');
    }

    // 2. Provider Stricte sans appel réseau : Si reviewBatches tente un appel LLM, une erreur est immédiatement levée
    let actualLlmCalls = 0;
    const mockStrictLlm: LlmProvider[] = [
      {
        name: 'gemini',
        model: 'gemini-3.5-flash',
        async generate() {
          actualLlmCalls++;
          throw new Error('[SÉCURITÉ VIOLÉE] Un appel réseau LLM non autorisé a été tenté lors du Passage 2 !');
        },
      },
    ];

    // 3. Fichier et alerte exacts ayant produit la clé 205fae02...
    const testFile: DiffFile = {
      path: 'app.py',
      status: 'modified',
      oldPath: 'app.py',
      binary: false,
      addedLines: new Set([10]),
      commentableLines: new Set([10]),
      hunks: [
        {
          header: '@@ -9,2 +9,2 @@',
          oldStart: 9,
          newStart: 9,
          lines: ['+cur = conn.execute("SELECT * FROM users WHERE name = \'" + name + "\'")'],
        },
      ],
    };

    const testAlert: SemgrepAlert = {
      id: 'semgrep-sqli-test-1791563800170',
      ruleId: 'python.sqlalchemy.security.audit.sqli',
      filePath: 'app.py',
      lineStart: 10,
      lineEnd: 10,
      severity: 'critical',
      category: 'security',
      message: 'Directly concatenating user input into SQL query string leads to SQL injection.',
    };

    const escalationPolicy = {
      escalateOnHighSeverity: false,
      escalateOnUncertain: false,
      escalateOnInvalidResponse: false,
      escalateOnLowConfidence: false,
    };

    // 4. Calcul du targetedContext et vérification de la clé avant le passage 2
    const ctxResult = await extractTargetedContext(testFile, {
      findingLines: [10],
      semgrepAlerts: [testAlert],
      linePadding: 5,
    });

    const calculatedKey = createCacheKey({
      targetedContext: ctxResult.formattedText,
      alert: testAlert,
      tier: 1,
      provider: mockStrictLlm[0]!.name,
      model: mockStrictLlm[0]!.model,
      rules: [],
      strictness: 'medium',
      escalationPolicy,
    });

    if (calculatedKey !== TARGET_KEY) {
      throw new Error(`[ÉCHEC DE CONFORMITÉ] La clé calculée (${calculatedKey.slice(0, 16)}) ne correspond pas à la clé cible (${TARGET_KEY.slice(0, 16)}).`);
    }

    const cacheStore = new DbLlmCacheStore(db);

    // 5. EXÉCUTION DU PASSAGE 2 (Lecture pure depuis PostgreSQL sans aucun appel Gemini)
    console.log('\n--> Execution ciblée du Passage 2 (Lecture pure PostgreSQL, 0 appel réseau Gemini)...');
    const res2 = await reviewBatches(
      mockStrictLlm,
      [testFile],
      new Map(),
      new Map(),
      [testAlert],
      new Map(),
      [],
      'medium',
      {
        cacheStore,
        enableCache: true,
        escalationPolicy,
        powerfulLlm: mockStrictLlm,
      },
    );

    console.log(`\n[PASSAGE 2 - RÉSULTATS] :
    - Appels LLM réseau tentés: ${actualLlmCalls} (Attendu STRICTEMENT : 0)
    - Cache Hits: ${res2.metrics.cacheHits} (Attendu: 1)
    - Avoided LLM Calls: ${res2.metrics.avoidedLlmCalls} (Attendu: 1)
    - Tokens économisés (savedTokensIn): ${res2.metrics.savedTokensIn} (Attendu: ${cachedRow.tokensIn})
    - Tokens économisés (savedTokensOut): ${res2.metrics.savedTokensOut} (Attendu: ${cachedRow.tokensOut})
    - Décision réutilisée depuis PostgreSQL: ${res2.findings[0]?.semgrepDecision} (Explication: "${res2.findings[0]?.semgrepReason}")`);

    // Assertions de validation strictes
    if (actualLlmCalls !== 0) {
      throw new Error('[ÉCHEC] Un appel réseau LLM a été effectué lors du Passage 2.');
    }
    if (res2.metrics.cacheHits !== 1 || res2.metrics.avoidedLlmCalls !== 1) {
      throw new Error('[ÉCHEC] Les métriques de cache hit ne correspondent pas aux attentes.');
    }
    if (res2.metrics.savedTokensIn !== cachedRow.tokensIn) {
      throw new Error(`[ÉCHEC] Le nombre de tokens économisés (${res2.metrics.savedTokensIn}) ne correspond pas à la valeur enregistrée en base (${cachedRow.tokensIn}).`);
    }

    console.log('\n✅ VALIDATION DU PASSAGE 2 RÉUSSIE À 100% : Le cache PostgreSQL llm_cache a servi la revue de manière totalement autonome sans aucun appel API Gemini !');
    console.log(`[CONSERVATION] La ligne de cache (${TARGET_KEY.slice(0, 16)}...) a été conservée intacte dans PostgreSQL.`);
  } finally {
    console.log('--- Fermeture propre du pool PostgreSQL ---');
    await sqlClient.end().catch((err) => console.error('[WARN] Erreur lors de la fermeture du pool PostgreSQL:', err));
  }
}

validatePassage2CacheHit().catch((err) => {
  console.error('\n❌ ERREUR LORS DE LA VALIDATION DU PASSAGE 2 :', err);
  process.exit(1);
});
