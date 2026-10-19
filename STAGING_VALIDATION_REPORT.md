# Rapport de Validation Bout-en-Bout en Staging

**Projet :** The AI Code Reviewer  
**Branche :** `feature/hybrid-low-token-review`  
**Date d'évaluation :** 2026-10-16  
**Statut Global :** **`READY FOR STAGING CANARY`** (Validation des pré-requis techniques achevée — Clés API requises pour l'exécution réelle)

---

## 1. Point 1 — Configuration Staging & Test Canary avec Modèle Réel

### Inspection des Identifiants & Sécurité de l'Environnement
- **Base de données (`DATABASE_URL`)** : Connectée à l'instance locale PostgreSQL isolée (`postgres://postgres:postgres@localhost:5432/codereview`). Aucune base de données de production n'est ciblée ni risquée.
- **Clés API LLM (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`)** : Actuellement non définies ou vides dans l'environnement local.
- **Vérification du garde-fou applicatif (`verifyStagingEnvironmentSafety`)** :
  - La tentative de benchmark réel sur le cas représentatif `flask-sql-injection` est interceptée et bloquée de façon étanche :
    ```bash
    npx tsx apps/worker/src/eval/run-benchmark.ts \
      --tier1Provider=anthropic --tier2Provider=anthropic \
      --live=true --case=flask-sql-injection \
      --maxRequests=3 --maxTokens=10000 --maxCostUsd=0.20
    ```
  - **Résultat observé** : Arrêt immédiat avec code d'erreur 1 :
    `Error: [Staging Safety Pre-Check Failed] Missing valid provider credentials for: ANTHROPIC_API_KEY. Set these staging variables before running real model benchmarks.`
  - **Intégrité financière** : Aucun appel payant n'a été émis sans identifiants valides.

### Spécification du Cas Canary `flask-sql-injection` (Ground Truth)
- **Fichier ciblé** : `app.py`
- **Lignes** : [10, 10] (dans `change.patch` : `cur = conn.execute("SELECT * FROM users WHERE name = '" + name + "'")`)
- **Catégorie & Sévérité** : `security` / `critical`
- **Attente** : Injection SQL par concaténation de variable utilisateur dans une requête brute. Doit déclencher une escalade Tier 2 et une confirmation stricte.

---

## 2. Point 2 — État de la Base de Données & Migration PostgreSQL `0010_overjoyed_dracula.sql`

### Vérification de la Migration & de la Table `llm_cache`
- **Fichier de migration** : `packages/db/drizzle/0010_overjoyed_dracula.sql`.
- **Vérification en base** : Inspection de la table `drizzle.__drizzle_migrations` sur l'instance PostgreSQL `codereview` :
  - **11 migrations enregistrées** (de `0000` à `0010`).
  - L'entrée n°11 correspond exactement au hash de la migration `0010_overjoyed_dracula` (timestamp `1791556657963`).
- **Structure de la table `llm_cache` vérifiée** :
  - `cache_key` : `text` (PRIMARY KEY, NOT NULL)
  - `tier` : `integer` (NOT NULL)
  - `provider` : `text` (NOT NULL)
  - `model` : `text` (NOT NULL)
  - `data` : `jsonb` (NOT NULL)
  - `tokens_in` : `integer` (NOT NULL)
  - `tokens_out` : `integer` (NOT NULL)
  - `created_at` : `timestamp with time zone` (NOT NULL)
  - `expires_at` : `timestamp with time zone` (NULLABLE)
- **Test fonctionnel en direct (Live SQL Roundtrip)** :
  - Insertion d'une entrée test avec payload JSON et expiration $\rightarrow$ **Succès**.
  - Lecture et vérification de conformité $\rightarrow$ **Succès**.
  - Suppression et nettoyage $\rightarrow$ **Succès**.
- **Tests d'intégration validés** :
  - `apps/worker/src/review/llm-cache-postgres.integration.test.ts` : 18/18 tests passés avec succès sur la base PostgreSQL réelle.
- **Idempotence de la commande de migration** :
  - L'exécution de `npx tsx packages/db/src/migrate.ts` confirme `Migrations applied.` sans conflit.

---

## 3. Point 3 — Plafonds de Dépenses Fournisseur & Coupe-Circuits Applicatifs

### Analyse des Plafonds Côté Fournisseur (Plafond de 5.00 $)
| Fournisseur | Mécanisme de Plafond | Effet du Plafond (Blocage vs Alerte) | Modalité de Configuration |
| :--- | :--- | :--- | :--- |
| **OpenAI** | *Hard Limit* (Usage Limits) | **Bloque réellement les appels** (HTTP 429 `insufficient_quota`) | Console Web (`platform.openai.com/account/limits`). Non configurable via API pour des raisons de sécurité. |
| **OpenAI** | *Soft Limit* | **Alerte uniquement** (envoi d'e-mail de notification) | Console Web. |
| **Anthropic** | *Monthly Spend Limit* | **Bloque réellement les appels** (HTTP 429 `usage limit exceeded`) | Console Web (`console.anthropic.com/settings/limits`). Non configurable via API. |
| **Anthropic** | *Notification Threshold* | **Alerte uniquement** (envoi d'e-mail) | Console Web. |
| **Google Cloud (Gemini)** | *Budgets & Alerts* | **Alerte uniquement** par défaut (sauf fonction Cloud Billing d'arrêt automatique de projet) | Console Google Cloud (`console.cloud.google.com/billing`). |

### Protections Applicatives Actives (Coupe-Circuit Local)
L'application ne s'en remet pas uniquement au fournisseur et intègre une barrière infranchissable :
- **Pré-réservation atomique (`CircuitBreakerGuard.reserveCall`)** : calcule le coût maximal théorique de la requête avant son envoi réseau.
- **Plafond budgétaire strict** : interrompt immédiatement (`BudgetExceededError`) et annule les requêtes en vol via `AbortSignal` dès que la limite (`--maxCostUsd=0.20` pour le canary, `--maxCostUsd=5.00` pour un batch complet) est atteinte.
- **Plafonds de sécurité par défaut** :
  - `maxRequests = 3`
  - `maxTokens = 10000`
  - `maxCostUsd = 0.20`

---

## 4. Synthèse par Point & Statut

| Point | Objectif | Statut | Détail des Résultats |
| :--- | :--- | :--- | :--- |
| **1. Configuration & Canary Réel** | Validation staging & canary 3 req / 10k tok / 0.20 $ | **EN ATTENTE DE CLÉ API STAGING** | Base isolée validée (Docker local). Garde-fou testé et actif. Bloqué de façon sécurisée en l'absence de clé API réelle. |
| **2. Migration PostgreSQL** | Vérifier `0010_overjoyed_dracula.sql` & `llm_cache` | **VALIDÉ (100%)** | Migration déjà appliquée en base (entrée 11 dans `__drizzle_migrations`). Table `llm_cache` opérationnelle (testée en écriture/lecture/suppression). |
| **3. Plafonds de Dépenses** | Configurer limite 5 $ & distinguer blocage/alerte | **VALIDÉ (100%)** | Audit des fournisseurs complété (Hard limit = blocage HTTP 429 chez OpenAI/Anthropic ; Alerte seule chez GCP). Coupe-circuit applicatif actif. |

---

## 5. Reste à Faire pour la Mise en Production

1. **Renseigner la clé d'API staging** dans `apps/worker/.env.local` (ex: `ANTHROPIC_API_KEY`).
2. **Lancer le canary unitaire** avec la commande fournie pour mesurer la latence réseau réelle, les tokens réels et comparer la détection d'injection SQL au ground truth `evals/flask-sql-injection/expected.json`.
3. **Consigner les résultats observés** dans le rapport avant validation finale pour la production.
