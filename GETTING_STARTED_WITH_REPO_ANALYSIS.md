# Getting Started with Repository Analysis

This guide will help you set up and use the new repository analysis feature.

## Prerequisites

Before you start, ensure you have:
- **Node.js 22+** installed
- **pnpm** package manager (install with `npm install -g pnpm`)
- **Docker Desktop** (for running the full stack)

## Quick Start

### Option 1: Using Docker (Recommended)

1. **Clone and setup** (if you haven't already):
   ```bash
   git clone https://github.com/Sliim-Bouzidi/The-AI-Code-Reviewer.git
   cd The-AI-Code-Reviewer
   cp .env.example .env
   ```

2. **Build and start the stack**:
   ```bash
   docker compose up --build
   ```

3. **Open the dashboard** at http://localhost:3000
   - Complete the Clerk setup (paste your Clerk keys)
   - Sign in with your account
   - Add a Gemini API key (free at https://aistudio.google.com/apikey) in Settings → AI Providers

4. **Create an API key**:
   - Go to the dashboard → API Keys
   - Click "Create New Key"
   - Copy the key (shown only once)

5. **Test the feature**:
   ```bash
   node scripts/test-repo-analysis.mjs https://github.com/facebook/react <your-api-key>
   ```

### Option 2: Local Development

1. **Install dependencies**:
   ```bash
   pnpm install
   ```

2. **Start required services**:
   ```bash
   docker compose up -d postgres redis smee
   ```

3. **Run migrations**:
   ```bash
   pnpm db:migrate
   ```

4. **Start the development servers**:
   ```bash
   pnpm dev
   ```
   This starts:
   - Web dashboard (http://localhost:3000)
   - API server (http://localhost:4000)
   - Worker (background jobs)
   - MCP server (http://localhost:4100)

5. **Setup in the dashboard**:
   - Open http://localhost:3000
   - Complete Clerk setup
   - Add AI provider keys
   - Create an API key

6. **Test the feature**:
   ```bash
   node scripts/test-repo-analysis.mjs https://github.com/vercel/next.js <your-api-key>
   ```

## Using the API

### From Command Line

```bash
# Basic usage
node scripts/test-repo-analysis.mjs <github-url> <api-key>

# Examples
node scripts/test-repo-analysis.mjs https://github.com/facebook/react crk_xxxxx
node scripts/test-repo-analysis.mjs https://github.com/microsoft/vscode crk_xxxxx
node scripts/test-repo-analysis.mjs https://github.com/vercel/next.js crk_xxxxx
```

### From JavaScript/TypeScript

```typescript
const apiKey = 'crk_xxxxx'; // Your API key from the dashboard
const repoUrl = 'https://github.com/owner/repository';

const response = await fetch('http://localhost:4000/api/repo-analysis/analyze-url', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`
  },
  body: JSON.stringify({ repoUrl })
});

const analysis = await response.json();

console.log(`Score: ${analysis.score}/100`);
console.log(`Summary: ${analysis.summary}`);
console.log('Strengths:', analysis.strengths);
console.log('Concerns:', analysis.concerns);
console.log('Recommendation:', analysis.recommendation);
```

### From cURL

```bash
curl -X POST http://localhost:4000/api/repo-analysis/analyze-url \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer crk_xxxxx" \
  -d '{"repoUrl": "https://github.com/facebook/react"}'
```

## What You'll Get

The analysis provides:

```json
{
  "repoUrl": "https://github.com/facebook/react",
  "fullName": "facebook/react",
  "description": "The library for web and native user interfaces.",
  "score": 95,
  "summary": "React is an exceptionally well-maintained project...",
  "strengths": [
    "Extremely high star count shows strong community trust",
    "Very active development with consistent commits",
    "Well-documented with comprehensive guides",
    "MIT license allows flexible usage"
  ],
  "concerns": [
    "High number of open issues (common for large projects)",
    "Complex codebase with steep learning curve"
  ],
  "recommendation": "This is a top-tier project definitely worth using.",
  "metadata": {
    "stars": 220000,
    "forks": 45000,
    "openIssues": 1200,
    "language": "JavaScript",
    "license": "MIT",
    "archived": false,
    "lastPush": "2024-10-10T12:00:00Z",
    "daysSinceLastPush": 2,
    "recentCommits": 10,
    "recentPRs": 8,
    "recentIssues": 10
  }
}
```

## Troubleshooting

### "pnpm command not found"
```bash
npm install -g pnpm
```

### "Docker is not running"
Start Docker Desktop, then run `docker compose up`

### "LLM is not configured"
1. Go to http://localhost:3000
2. Sign in
3. Go to Settings → AI Providers
4. Add a Gemini API key (free at https://aistudio.google.com/apikey)

### "Invalid GitHub repository URL"
Ensure the URL is in the format:
```
https://github.com/owner/repository
```

### "Repository not found"
- Check that the repository exists and is public
- Verify the URL is correct

### Port Already in Use
If ports 3000, 4000, 5432, or 6379 are in use:
```bash
docker compose down
# Stop any other services using those ports
docker compose up
```

## Testing Different Repositories

Try analyzing various types of repositories:

**Popular frameworks:**
```bash
node scripts/test-repo-analysis.mjs https://github.com/facebook/react crk_xxxxx
node scripts/test-repo-analysis.mjs https://github.com/vuejs/vue crk_xxxxx
node scripts/test-repo-analysis.mjs https://github.com/angular/angular crk_xxxxx
```

**AI/ML projects:**
```bash
node scripts/test-repo-analysis.mjs https://github.com/huggingface/transformers crk_xxxxx
node scripts/test-repo-analysis.mjs https://github.com/openai/gpt-2 crk_xxxxx
```

**Your own projects:**
```bash
node scripts/test-repo-analysis.mjs https://github.com/your-username/your-repo crk_xxxxx
```

## Next Steps

After analyzing repositories:

1. **For promising projects**: Install the GitHub App to enable full code reviews
2. **For your own projects**: Enable reviews and indexing for deep analysis
3. **For evaluation**: Use the analysis to decide which projects to contribute to

## Integration Ideas

This feature can be integrated into:
- **CI/CD pipelines**: Analyze dependencies before adding them
- **Project dashboards**: Display quality scores for tracked repos
- **Automated reports**: Generate weekly summaries of interesting repos
- **Contribution tools**: Help developers find good projects to contribute to

## Support

For issues or questions:
- Check the [main documentation](README.md)
- Review the [full API documentation](REPO_ANALYSIS.md)
- Open an issue on GitHub

## Example Output

When you run the test script, you'll see:

```
Analyzing repository: https://github.com/facebook/react

================================================================================
Repository: facebook/react
Description: The library for web and native user interfaces.
================================================================================

📊 Quality Score: 95/100

Summary: React is an exceptionally well-maintained project with massive 
community support and active development.

✅ Strengths:
   1. Extremely high number of stars (220k+) indicates strong community trust
   2. Very active development with consistent recent commits
   3. Well-documented with comprehensive guides
   4. MIT license allows flexible usage

⚠️  Concerns:
   1. High number of open issues reflects the large user base
   2. Complex codebase may have steep learning curve

💡 Recommendation: This is a top-tier project that's definitely worth using.

📈 Metadata:
   ⭐ Stars: 220000
   🍴 Forks: 45000
   🐛 Open Issues: 1200
   💻 Language: JavaScript
   📜 License: MIT
   📦 Archived: No
   🕐 Last Push: 2 days ago
   📝 Recent Commits: 10
   🔀 Recent PRs: 8
   💬 Recent Issues: 10
================================================================================
```

Happy analyzing! 🚀
