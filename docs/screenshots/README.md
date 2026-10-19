# Feature screenshots

Captured from the local Docker stack (`docker compose up`) against `http://localhost:3000` while signed in as the project owner after connecting GitHub App `ai-code-reviewer-3922`.

| File | Screen | Notes |
|---|---|---|
| `01-landing.png` | Public landing (`/`) | Captured |
| `02-sign-in.png` | Clerk first-run key setup (`/sign-in`) | Captured before keys were saved |
| `02b-onboarding.png` | Connect GitHub onboarding | Captured after Clerk sign-in |
| `03-overview.png` | Dashboard overview | Empty stats (0 reviews / findings / active repos) |
| `04-repositories.png` | Repositories list | Repos installed; reviews off; indexing not set up |
| `05-repo-detail.png` | Repo detail (`The-AI-Code-Reviewer`) | Reviews tab empty state; Settings tab available |
| `06-review-detail.png` | One review (timeline + findings) | Skipped — no reviews yet |
| `07-quality.png` | Quality / evals | Empty state; Run evals available |
| `08-ai-providers.png` | AI providers | Main / fallback / indexing not configured |
| `09-api-keys.png` | API keys and MCP | No keys yet; MCP JSON install block shown |

Not in this set (no browser UI): MCP slash commands in an IDE, GitHub inline PR comments, worker logs.
