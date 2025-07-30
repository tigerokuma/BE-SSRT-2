export interface ActivityScore {
  score: number; // 0-100
  level: 'LOW' | 'MODERATE' | 'HIGH' | 'VERY_HIGH';
  factors: {
    commitFrequency: number;        // Recent commit frequency (last 3 months)
    contributorDiversity: number;   // Recent contributor diversity (last 3 months)
    codeChurn: number;             // Recent code churn (last 3 months)
    developmentConsistency: number; // Development consistency (weekly patterns)
  };
} 