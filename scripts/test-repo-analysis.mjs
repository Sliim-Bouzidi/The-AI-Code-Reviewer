#!/usr/bin/env node

/**
 * Simple test script for the repository analysis endpoint.
 * Usage: node scripts/test-repo-analysis.mjs <github-repo-url> <api-key>
 * Example: node scripts/test-repo-analysis.mjs https://github.com/owner/repo crk_xxxxx
 */

const repoUrl = process.argv[2];
const apiKey = process.argv[3];
const apiUrl = process.env.API_URL || 'http://localhost:4000';

if (!repoUrl || !apiKey) {
  console.error('Usage: node scripts/test-repo-analysis.mjs <github-repo-url> <api-key>');
  console.error('Example: node scripts/test-repo-analysis.mjs https://github.com/facebook/react crk_xxxxx');
  process.exit(1);
}

console.log(`Analyzing repository: ${repoUrl}\n`);

try {
  const response = await fetch(`${apiUrl}/api/repo-analysis/analyze-url`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ repoUrl }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error(`Error: ${response.status} ${response.statusText}`);
    console.error(error);
    process.exit(1);
  }

  const result = await response.json();

  console.log('='.repeat(80));
  console.log(`Repository: ${result.fullName}`);
  console.log(`Description: ${result.description || 'No description'}`);
  console.log('='.repeat(80));
  console.log(`\n📊 Quality Score: ${result.score}/100\n`);
  console.log(`Summary: ${result.summary}\n`);
  
  console.log('✅ Strengths:');
  result.strengths.forEach((s, i) => console.log(`   ${i + 1}. ${s}`));
  
  console.log('\n⚠️  Concerns:');
  result.concerns.forEach((c, i) => console.log(`   ${i + 1}. ${c}`));
  
  console.log(`\n💡 Recommendation: ${result.recommendation}\n`);
  
  console.log('📈 Metadata:');
  console.log(`   ⭐ Stars: ${result.metadata.stars}`);
  console.log(`   🍴 Forks: ${result.metadata.forks}`);
  console.log(`   🐛 Open Issues: ${result.metadata.openIssues}`);
  console.log(`   💻 Language: ${result.metadata.language || 'Unknown'}`);
  console.log(`   📜 License: ${result.metadata.license || 'None'}`);
  console.log(`   📦 Archived: ${result.metadata.archived ? 'Yes' : 'No'}`);
  console.log(`   🕐 Last Push: ${result.metadata.daysSinceLastPush} days ago`);
  console.log(`   📝 Recent Commits: ${result.metadata.recentCommits}`);
  console.log(`   🔀 Recent PRs: ${result.metadata.recentPRs}`);
  console.log(`   💬 Recent Issues: ${result.metadata.recentIssues}`);
  console.log('='.repeat(80));
} catch (error) {
  console.error('Failed to analyze repository:', error.message);
  process.exit(1);
}
