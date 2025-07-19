/**
 * Test script to demonstrate the new token-based strategy
 * This shows how repository cloning thresholds scale with available tokens
 */

// Simulate the token-based strategy logic
function getCloningThresholdForTokens(remainingTokens) {
  const baseCloningThreshold = 50000; // 50MB in KB

  if (remainingTokens >= 4000) {
    return 1000000; // 1GB - clone repos > 1GB
  } else if (remainingTokens >= 3000) {
    return 500000; // 500MB - clone repos > 500MB
  } else if (remainingTokens >= 2000) {
    return 250000; // 250MB - clone repos > 250MB
  } else if (remainingTokens >= 1000) {
    return 100000; // 100MB - clone repos > 100MB
  } else {
    return baseCloningThreshold; // 50MB - clone repos > 50MB
  }
}

function shouldUseApiForRepo(repoSizeKB, remainingTokens) {
  const cloningThreshold = getCloningThresholdForTokens(remainingTokens);
  return repoSizeKB > cloningThreshold;
}

function shouldUseApiForCommits(remainingTokens) {
  return remainingTokens >= 1000;
}

// Test scenarios
const testScenarios = [
  { tokens: 5000, repoSize: 50000, description: "Small repo (50MB) with many tokens" },
  { tokens: 5000, repoSize: 200000, description: "Medium repo (200MB) with many tokens" },
  { tokens: 5000, repoSize: 1500000, description: "Large repo (1.5GB) with many tokens" },
  { tokens: 2500, repoSize: 100000, description: "Small repo (100MB) with medium tokens" },
  { tokens: 2500, repoSize: 300000, description: "Medium repo (300MB) with medium tokens" },
  { tokens: 1500, repoSize: 80000, description: "Small repo (80MB) with low tokens" },
  { tokens: 1500, repoSize: 150000, description: "Medium repo (150MB) with low tokens" },
  { tokens: 500, repoSize: 30000, description: "Small repo (30MB) with very low tokens" },
  { tokens: 500, repoSize: 100000, description: "Medium repo (100MB) with very low tokens" },
];

console.log("🔍 Token-Based Strategy Test Results\n");
console.log("=" .repeat(80));

testScenarios.forEach((scenario, index) => {
  const threshold = getCloningThresholdForTokens(scenario.tokens);
  const useApiForRepo = shouldUseApiForRepo(scenario.repoSize, scenario.tokens);
  const useApiForCommits = shouldUseApiForCommits(scenario.tokens);
  
  console.log(`\n${index + 1}. ${scenario.description}`);
  console.log(`   Tokens: ${scenario.tokens}`);
  console.log(`   Repo Size: ${scenario.repoSize}KB (${(scenario.repoSize / 1024).toFixed(1)}MB)`);
  console.log(`   Cloning Threshold: ${threshold}KB (${(threshold / 1024).toFixed(1)}MB)`);
  console.log(`   Use API for Repo: ${useApiForRepo ? '✅ Yes' : '❌ No'}`);
  console.log(`   Use API for Commits: ${useApiForCommits ? '✅ Yes' : '❌ No'}`);
  console.log(`   Strategy: ${useApiForRepo ? 'GitHub API' : 'Local Cloning'}`);
});

console.log("\n" + "=" .repeat(80));
console.log("📊 Strategy Summary:");
console.log("- < 50MB repos: Always cloned (regardless of tokens)");
console.log("- 1000+ tokens: Clone repos > 100MB");
console.log("- 2000+ tokens: Clone repos > 250MB");
console.log("- 3000+ tokens: Clone repos > 500MB");
console.log("- 4000+ tokens: Clone repos > 1GB");
console.log("- Commits API: Only used when 1000+ tokens available");
console.log("\n✅ This strategy efficiently preserves API tokens while ensuring reliable processing!"); 