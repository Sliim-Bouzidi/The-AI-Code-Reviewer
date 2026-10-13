# Journal d'évolution : analyse structurelle et diagrammes (AI Code Review Platform)

Document de travail pour le rapport académique. Il distingue ce que l'IA a proposé, ce que l'étudiant a décidé, ce qui a été implémenté et ce qui a réellement été vérifié.

## Étape 1 : audit (2026-10-12)
- **Besoin initial :** faire évoluer la plateforme (inspiration Greptile) : gestion de dépôts, analyse du code, diagrammes, visualisation, questions sur le code, intégration au review.
- **Prompt :** prompt de cadrage en 10 sections (rôle, objectifs, contraintes non négociables, méthode en 4 étapes, tests, checklist de revue, historique). Texte intégral : à coller depuis l'historique de la conversation (non recopié ici).
- **Proposition de l'IA :** audit du ZIP (monorepo TypeScript : Next.js, NestJS, BullMQ, PostgreSQL + pgvector, Tree-sitter), tableau des fonctionnalités, architecture cible, plan en 7 phases, 8 questions.
- **Constats vérifiés par exécution (copie du ZIP) :** `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm typecheck` et `pnpm test` (32 tests) réussis avant toute modification.

## Étape 2 : décisions de l'étudiant (2026-10-12)
- Partir de `main`; l'étudiant teste lui-même après l'implémentation; liberté technique sur les choix courants.
- Règles impératives : ne rien supprimer ni dégrader, réutiliser GitHub / clonage / jobs / auth, pas de refactor global, sécurité des secrets.
- Questions restées sans réponse explicite, tranchées par l'IA : langages prioritaires (TypeScript, Java, Python), `mermaid` ajouté (rendu des diagrammes dans le navigateur), GitLab et Bitbucket reportés, historique dans ce fichier.

## Étape 3 : implémentation (2026-10-13, branche `feat/repo-structure-diagrams`)
Choix techniques de l'IA (non validés individuellement, dans le cadre de la liberté donnée) :
- Graphe stocké en PostgreSQL (4 tables, migration 0009 générée par drizzle-kit), pas de base de graphe.
- Extension additive de `symbols.ts` plutôt qu'un second analyseur; résolution des relations dans une fonction pure (`resolve.ts`) avec trois niveaux de confiance (exact, inferred, unresolved).
- Diagrammes Mermaid générés côté API par une fonction pure et testée; rendu côté navigateur.
- Clonage extrait de l'indexeur dans `git-clone.ts` (même comportement, plus un champ `branch` optionnel).

Difficultés et solutions :
- Premier essai sur le code du projet lui-même : 234 imports sur 762 non résolus (alias `@/` de Next.js) et les dépendances entre packages du monorepo vues comme « externes ». Solution : lecture de `tsconfig.json` (paths) et `package.json` (noms) → 2 imports non résolus ensuite.
- Le message d'erreur brut de `git clone` contient l'en-tête d'authentification (jeton) et était copié dans l'état d'indexation visible dans le tableau de bord. Corrigé dans `git-clone.ts` (erreur réécrite et masquée).
- Les classes abstraites TypeScript et les `enum` / `record` Java n'étaient pas des symboles : ajoutés (ce qui change légèrement leur découpage en chunks pour l'indexation).
- `apps/web/tsconfig.tsbuildinfo` est versionné et change à chaque build : restauré avant les commits.

## Vérifications effectivement exécutées
Voir le bilan de fin d'étape dans la conversation (commandes et résultats réels). Rien n'a été exécuté contre un vrai GitHub, une vraie base de données, Redis ou Clerk.

## Limites et perspectives
- Pas de diagrammes de séquence (informations d'exécution nécessaires), pas de champs dans les diagrammes de classes.
- Non réalisé dans cette itération : questions/réponses sur le dépôt, utilisation du graphe dans le pipeline de revue (callers des fonctions modifiées), GitLab et Bitbucket.
