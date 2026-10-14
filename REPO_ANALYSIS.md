# Repository Analysis Feature

This feature allows you to analyze any public GitHub repository and get an AI-powered assessment of its quality, activity, and whether it's a good project to use or contribute to.

## How It Works

The repository analysis feature:

1. **Fetches repository metadata** from the GitHub API:
   - Stars, forks, and open issues
   - Language and license information
   - Creation and last update dates
   - Recent activity (commits, PRs, issues)

2. **Uses AI to analyze** the collected data:
   - Generates a quality score (0-100)
   - Identifies key strengths
   - Highlights potential concerns
   - Provides actionable recommendations

3. **Returns a comprehensive report** with all findings

## Usage

### API Endpoint

**POST** `/api/repo-analysis/analyze-url`

**Request Body:**
```json
{
  "repoUrl": "https://github.com/owner/repository"
}
```

**Response:**
```json
{
  "repoUrl": "https://github.com/owner/repository",
  "fullName": "owner/repository",
  "description": "Repository description",
  "score": 85,
  "summary": "This is a well-maintained project with active development...",
  "strengths": [
    "High number of stars indicates community trust",
    "Active development with recent commits",
    "Good documentation and license"
  ],
  "concerns": [
    "High number of open issues",
    "Limited recent pull request activity"
  ],
  "recommendation": "This is a solid project worth using or contributing to.",
  "metadata": {
    "stars": 12500,
    "forks": 2500,
    "openIssues": 150,
    "language": "TypeScript",
    "license": "MIT",
    "archived": false,
    "lastPush": "2024-10-10T12:00:00Z",
    "daysSinceLastPush": 4,
    "recentCommits": 10,
    "recentPRs": 8,
    "recentIssues": 5
  }
}
```

### Using the Test Script

A convenient test script is provided to analyze repositories from the command line:

```bash
node scripts/test-repo-analysis.mjs <github-repo-url> <api-key>
```

**Example:**
```bash
node scripts/test-repo-analysis.mjs https://github.com/facebook/react crk_xxxxx
```

**Output:**
```
================================================================================
Repository: facebook/react
Description: The library for web and native user interfaces.
================================================================================

📊 Quality Score: 95/100

Summary: React is an exceptionally well-maintained project with massive community support...

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

### Authentication

You need an API key to use this feature. Generate one from the dashboard:
1. Go to the **API Keys** page
2. Click **Create New Key**
3. Copy the key (it's shown only once)
4. Use it in the `Authorization: Bearer <key>` header

### From Your Application

```javascript
const response = await fetch('http://localhost:4000/api/repo-analysis/analyze-url', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer crk_xxxxx'
  },
  body: JSON.stringify({
    repoUrl: 'https://github.com/owner/repository'
  })
});

const analysis = await response.json();
console.log(`Score: ${analysis.score}/100`);
console.log(`Recommendation: ${analysis.recommendation}`);
```

## What Gets Analyzed

The analysis considers:

- **Popularity**: Stars and forks count
- **Activity**: Recent commits, PRs, and issues
- **Maintenance**: Days since last push
- **Health**: Open issues count relative to activity
- **Documentation**: Presence of license and description
- **Status**: Whether the repository is archived or active

## Requirements

- A configured AI provider (Gemini, OpenAI, etc.) in your dashboard settings
- Valid API key for authentication
- Public GitHub repository (private repos require GitHub App installation)

## Limitations

- Only works with public GitHub repositories
- Rate limited by GitHub API (60 requests/hour for unauthenticated)
- Analysis quality depends on the configured AI provider
- Does not perform deep code analysis (use the regular review feature for that)

## Integration with Existing Features

This feature complements the existing code review system:

- **Repository Analysis**: Quick high-level assessment of any public repo
- **Code Review**: Deep analysis of pull requests and diffs for repos you own

Use repository analysis to evaluate projects before installing the GitHub App, then use the full code review features for your own repositories.

## Next Steps

After analyzing a repository:
1. If the analysis is positive, consider installing the GitHub App on your fork
2. Enable reviews to get AI-powered code reviews on your pull requests
3. Use the full indexing and search features for deep code analysis

## Troubleshooting

**"Invalid GitHub repository URL"**
- Ensure the URL is in the format: `https://github.com/owner/repo`

**"Repository not found"**
- Check that the repository exists and is public
- Verify the owner and repository name are correct

**"LLM is not configured"**
- Go to the dashboard settings and add an AI provider API key
- Gemini offers a free tier that works well for this feature

**"GitHub API error: 403"**
- You may have hit GitHub's rate limit
- Wait a few minutes and try again
- Consider adding a GitHub token for higher rate limits (future enhancement)
