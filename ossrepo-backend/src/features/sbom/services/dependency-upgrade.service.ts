import { Injectable, Logger } from '@nestjs/common';
import neo4j from 'neo4j-driver';
import { SbomRepository } from '../repositories/sbom.repository';
import { PrismaService } from '../../../common/prisma/prisma.service';
import axios from 'axios';

const MEMGRAPH_URI = "bolt://localhost:7687";
const USER = "memgraph";
const PASSWORD = "memgraph";

@Injectable()
export class DependencyOptimizerService {
  private readonly logger = new Logger(DependencyOptimizerService.name);
  private readonly driver;

  constructor(
    private readonly sbomRepo: SbomRepository,
    private readonly prisma: PrismaService,
  ) {
    this.driver = neo4j.driver(MEMGRAPH_URI, neo4j.auth.basic(USER, PASSWORD), {
        maxConnectionLifetime: 3 * 60 * 60 * 1000, // 3 hours
        maxConnectionPoolSize: 50,
        connectionAcquisitionTimeout: 2 * 60 * 1000, // 2 minutes
      });
  }

  /**
   * Count total unique packages in the graph.
   */
  async getTotalUniquePackages(): Promise<number> {
    const session = this.driver.session();
    const query = `
      MATCH (m:Package {isMain: true})-[:DEPENDS_ON*1..]->(d:Package)
      WITH collect(DISTINCT d.db_package_id) AS allDeps
      RETURN size(allDeps) AS totalUniquePackages;
    `;
    const result = await session.run(query);
    await session.close();
    return result.records[0].get('totalUniquePackages').toInt();
  }

  /**
   * Given a list of package names, simulate upgrades and measure
   * the change in total transitive dependencies.
   */
  async simulateUpgradeImpact(packageNames: string[]) {
    const session = this.driver.session();

  // Step 1: get all versions + their transitive dependencies
  const pkgDepsMap: Record<string, { version: string, deps: string[] }[]> = {};

  for (const name of packageNames) {
    const q = `
      MATCH (p:Package {name: $name})
      OPTIONAL MATCH (p)-[:DEPENDS_ON*0..]->(dep:Package)
      WITH p, collect(DISTINCT dep.name + '@' + dep.version) AS deps
      RETURN p.version AS version, deps
      ORDER BY p.version DESC
    `;
    const res = await session.run(q, { name });
    pkgDepsMap[name] = res.records.map(r => ({
      version: r.get('version'),
      deps: r.get('deps'),
    }));
  }
  
  // Step 2: generate all combinations of main package versions
  function cartesian<T>(arrays: T[][]): T[][] {
    return arrays.reduce<T[][]>(
      (a, b) =>
        a.flatMap(d => b.map(e => [...d, e])),
      [[]]
    );
  }

  const versionsList = packageNames.map((pkg) => {
    const versions = pkgDepsMap[pkg] || [];
    if (versions.length === 0) {
      return [{ version: 'unknown', deps: [] }];
    }
    return versions;
  });
  
  
  const allCombinations = cartesian(versionsList);
  // 3️⃣ Evaluate conflicts for each combination
  const scored = allCombinations.map((combo) => {
    const allDeps = combo.flatMap((v) => v.deps);
    const versionMap: Record<string, Set<string>> = {};

    for (const dep of allDeps) {
      const [pkg, ver] = dep.split('@');
      if (!versionMap[pkg]) versionMap[pkg] = new Set();
      versionMap[pkg].add(ver);
    }

    const conflicts = Object.values(versionMap).filter((s) => s.size > 1).length;

    return {
      combo: combo.map((v, i) => ({
        name: packageNames[i],
        version: v.version,
      })),
      conflicts,
    };
  });

  // 4️⃣ Sort: fewest conflicts first, then newest versions
  scored.sort((a, b) => {
    if (a.conflicts !== b.conflicts) return a.conflicts - b.conflicts;

    // compare semver strings descending (newest first)
    for (let i = 0; i < packageNames.length; i++) {
      const verA = a.combo[i].version;
      const verB = b.combo[i].version;
      if (verA !== verB) {
        const [a1, a2, a3] = verA.split('.').map(Number);
        const [b1, b2, b3] = verB.split('.').map(Number);
        if (a1 !== b1) return b1 - a1;
        if (a2 !== b2) return b2 - a2;
        if (a3 !== b3) return b3 - a3;
      }
    }
    return 0;
  });

  await session.close();

  // 5️⃣ Return only the top (best + newest) combination
  return scored[0];


  }

  /**
   * Given a project_id, get upgrade recommendations for packages in that project.
   */
  async getUpgradeRecommendations(projectId: string) {
    // Get packages from project
    let projectDeps = await this.sbomRepo.getProjectDependencies(projectId);
    let projectWatchlist = await this.sbomRepo.getProjectWatchlist(projectId);
    projectDeps = [...projectDeps, ...projectWatchlist];
    
    const packageNames = projectDeps.map((dep) => dep.package_name);
    if (!packageNames.length) {
      return { error: 'No packages found for this project' };
    }
    
    const all = await this.simulateUpgradeImpact(packageNames);
    return all;
  }

  /**
   * Find packages inside a project whose dependency trees have very little
   * overlap with the rest of the project. These are good candidates for
   * isolation or targeted review because changes to them are less likely
   * to ripple through shared dependencies.
   */
  async findLowSimilarityPackages(
    projectId: string,
    options?: {
      sharedThreshold?: number;
      similarityRatio?: number;
      limit?: number;
    },
  ) {
    const sharedThreshold = options?.sharedThreshold ?? 1; // total shared deps allowed
    const similarityRatio = options?.similarityRatio ?? 0.2; // % of deps that can be shared
    const limit = options?.limit ?? 10;

    let projectDeps = await this.sbomRepo.getProjectDependencies(projectId);
    const projectWatchlist = await this.sbomRepo.getProjectWatchlist(projectId);
    projectDeps = [...projectDeps, ...projectWatchlist];

    const uniquePackages = new Map<string, { package_id: string; package_name?: string }>();
    for (const dep of projectDeps) {
      uniquePackages.set(dep.package_id, dep);
    }

    if (!uniquePackages.size) {
      return [];
    }

    const packageIds = Array.from(uniquePackages.keys());
    const session = this.driver.session();

    try {
      const result = await session.run(
        `
        MATCH (p:Package)
        WHERE p.db_package_id IN $packageIds
        OPTIONAL MATCH (p)-[:DEPENDS_ON]->(dep:Package)
        RETURN p.db_package_id AS packageId,
               COALESCE(p.name, p.purl) AS packageName,
               collect(DISTINCT dep.db_package_id) AS dependencies
        `,
        { packageIds },
      );

      type DependencyInfo = { deps: Set<string>; dependencyCount: number };
      const dependencySets = new Map<string, DependencyInfo>();

      for (const pkgId of packageIds) {
        dependencySets.set(pkgId, { deps: new Set<string>(), dependencyCount: 0 });
      }

      for (const record of result.records) {
        const packageId = record.get('packageId');
        const deps = (record.get('dependencies') || []).filter(Boolean);
        dependencySets.set(packageId, {
          deps: new Set<string>(deps),
          dependencyCount: deps.length,
        });
      }

      const stats = packageIds.map((packageId) => {
        const pkgMeta = uniquePackages.get(packageId);
        const info = dependencySets.get(packageId) ?? { deps: new Set(), dependencyCount: 0 };
        const dependencyCount = info.dependencyCount;
        let shared = 0;

        for (const [otherId, otherInfo] of dependencySets.entries()) {
          if (otherId === packageId) continue;
          if (!info.deps.size || !otherInfo.deps.size) continue;
          for (const dep of info.deps) {
            if (otherInfo.deps.has(dep)) {
              shared += 1;
            }
          }
        }

        const ratio = dependencyCount ? shared / dependencyCount : 0;
        const isLowSimilarity =
          dependencyCount === 0 || (shared <= sharedThreshold && ratio <= similarityRatio);

        return {
          packageId,
          packageName: pkgMeta?.package_name,
          dependencyCount,
          sharedDependencyCount: shared,
          sharedRatio: Number(ratio.toFixed(3)),
          isLowSimilarity,
        };
      });

      const filtered = stats
        .filter((stat) => stat.isLowSimilarity)
        .sort((a, b) => {
          if (a.sharedDependencyCount !== b.sharedDependencyCount) {
            return a.sharedDependencyCount - b.sharedDependencyCount;
          }
          return a.dependencyCount - b.dependencyCount;
        });

      return filtered.slice(0, limit);
    } finally {
      await session.close();
    }
  }

  /**
   * Find packages in a project that have OSV vulnerabilities stored in the database.
   */
  async findPackagesWithVulnerabilities(
    projectId: string,
    options?: {
      includePatched?: boolean;
      minSeverity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
      limit?: number;
    },
  ) {
    const includePatched = options?.includePatched ?? false;
    const minSeverity = options?.minSeverity;
    const limit = options?.limit;

    // Get all project packages
    let projectDeps = await this.sbomRepo.getProjectDependencies(projectId);
    const projectWatchlist = await this.sbomRepo.getProjectWatchlist(projectId);
    projectDeps = [...projectDeps, ...projectWatchlist];

    if (projectDeps.length === 0) {
      return [];
    }

    const packageNames = projectDeps.map((dep) => dep.package_name);

    // Build severity filter if provided
    const severityFilter = minSeverity
      ? {
          severity: {
            in: this.getSeverityLevels(minSeverity),
          },
        }
      : {};

    // Get OSV vulnerabilities for packages from database
    const osvVulnerabilities = await this.prisma.osvVulnerability.findMany({
      where: {
        package_name: { in: packageNames },
        ...(includePatched ? {} : { is_patched: false }),
        ...severityFilter,
      },
      select: {
        id: true,
        package_name: true,
        summary: true,
        severity: true,
        published: true,
        is_patched: true,
        patch_age_days: true,
      },
    });

    // Create a map of package name -> vulnerabilities
    const packageVulnMap = new Map<
      string,
      {
        packageId: string;
        packageName: string;
        vulnerabilities: any[];
        totalCount: number;
        criticalCount: number;
        highCount: number;
        mediumCount: number;
        lowCount: number;
      }
    >();

    // Initialize map with all packages
    for (const dep of projectDeps) {
      packageVulnMap.set(dep.package_name, {
        packageId: dep.package_id,
        packageName: dep.package_name,
        vulnerabilities: [],
        totalCount: 0,
        criticalCount: 0,
        highCount: 0,
        mediumCount: 0,
        lowCount: 0,
      });
    }

    // Add OSV vulnerabilities
    for (const vuln of osvVulnerabilities) {
      const pkg = packageVulnMap.get(vuln.package_name);
      if (pkg) {
        pkg.vulnerabilities.push(vuln);
        pkg.totalCount += 1;
        // Count by severity (OSV uses different severity format)
        const severity = (vuln.severity || '').toUpperCase();
        if (severity.includes('CRITICAL')) pkg.criticalCount += 1;
        else if (severity.includes('HIGH')) pkg.highCount += 1;
        else if (severity.includes('MEDIUM')) pkg.mediumCount += 1;
        else if (severity.includes('LOW')) pkg.lowCount += 1;
      }
    }

    // Filter to only packages with vulnerabilities and sort by severity
    const result = Array.from(packageVulnMap.values())
      .filter((pkg) => pkg.totalCount > 0)
      .sort((a, b) => {
        // Sort by critical count first, then high, then total
        if (a.criticalCount !== b.criticalCount) {
          return b.criticalCount - a.criticalCount;
        }
        if (a.highCount !== b.highCount) {
          return b.highCount - a.highCount;
        }
        return b.totalCount - a.totalCount;
      });

    return limit ? result.slice(0, limit) : result;
  }

  /**
   * Helper to get severity levels for filtering (includes the specified level and above)
   */
  private getSeverityLevels(minSeverity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'): string[] {
    const levels = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
    const minIndex = levels.indexOf(minSeverity);
    return levels.slice(minIndex);
  }

  /**
   * Get dependency graph data for a package upgrade recommendation.
   * Returns: project name, package name, old version, new version, separate dependencies count, shared dependencies count
   */
  async getUpgradeDependencyGraph(
    projectId: string,
    packageName: string,
    oldVersion: string,
    newVersion: string,
  ) {
    const session = this.driver.session();

    try {
      // Get project name
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        select: { name: true },
      });
      const projectName = project?.name || 'Unknown Project';

      // Get all project package names
      let projectDeps = await this.sbomRepo.getProjectDependencies(projectId);
      let projectWatchlist = await this.sbomRepo.getProjectWatchlist(projectId);
      projectDeps = [...projectDeps, ...projectWatchlist];
      const projectPackageNames = projectDeps.map((dep) => dep.package_name);
      const otherProjectPackages = projectPackageNames.filter(
        (name) => name.toLowerCase() !== packageName.toLowerCase(),
      );

      // Helper to get dependencies for a version
      const getDependencies = async (version: string) => {
        const query = `
          MATCH (p:Package {name: $packageName, version: $version})
          OPTIONAL MATCH (p)-[:DEPENDS_ON*1..]->(dep:Package)
          WITH collect(DISTINCT dep.name) AS deps
          RETURN deps
        `;
        const result = await session.run(query, { packageName, version });
        if (result.records.length === 0) return [];
        return result.records[0].get('deps').filter(Boolean);
      };

      // Get dependencies of other project packages
      const getOtherProjectDependencies = async () => {
        if (otherProjectPackages.length === 0) return [];
        const query = `
          MATCH (p:Package)
          WHERE p.name IN $packageNames
          OPTIONAL MATCH (p)-[:DEPENDS_ON*1..]->(dep:Package)
          WITH collect(DISTINCT dep.name) AS deps
          RETURN deps
        `;
        const result = await session.run(query, {
          packageNames: otherProjectPackages,
        });
        if (result.records.length === 0) return [];
        return result.records[0].get('deps').filter(Boolean);
      };

      // Get dependencies for old and new versions
      const [oldDeps, newDeps, otherDeps] = await Promise.all([
        getDependencies(oldVersion),
        getDependencies(newVersion),
        getOtherProjectDependencies(),
      ]);

      // Calculate unique and shared dependencies for both versions
      const calculateStats = (upgradeDeps: string[]) => {
        const upgradeDepSet = new Set(upgradeDeps);
        const otherDepSet = new Set(otherDeps);

        // Dependencies unique to upgrade package (not in rest of project)
        const separateDeps = upgradeDeps.filter((dep) => !otherDepSet.has(dep));

        // Dependencies shared between upgrade package and rest of project
        const sharedDeps = upgradeDeps.filter((dep) => otherDepSet.has(dep));

        return {
          separateCount: separateDeps.length,
          sharedCount: sharedDeps.length,
        };
      };

      const oldStats = calculateStats(oldDeps);
      const newStats = calculateStats(newDeps);

      return {
        projectName,
        packageName,
        oldVersion,
        newVersion,
        oldSeparateDependencies: oldStats.separateCount,
        oldSharedDependencies: oldStats.sharedCount,
        newSeparateDependencies: newStats.separateCount,
        newSharedDependencies: newStats.sharedCount,
        changeSeparate: newStats.separateCount - oldStats.separateCount,
        changeShared: newStats.sharedCount - oldStats.sharedCount,
      };
    } catch (error) {
      this.logger.error(
        `Error getting upgrade dependency graph for ${packageName}:`,
        error,
      );
      return {
        error: 'Failed to get dependency graph',
        projectName: '',
        packageName,
        oldVersion,
        newVersion,
        oldSeparateDependencies: 0,
        oldSharedDependencies: 0,
        newSeparateDependencies: 0,
        newSharedDependencies: 0,
        changeSeparate: 0,
        changeShared: 0,
      };
    } finally {
      await session.close();
    }
  }

  /**
   * Get combined flattening analysis including score, recommendations, and low similarity packages.
   * This combines upgrade recommendations and low similarity analysis into a single score.
   */
  async getFlatteningAnalysis(projectId: string) {
    // Get upgrade recommendations
    const upgradeRecommendations = await this.getUpgradeRecommendations(projectId);
    
    // Get low similarity packages
    const lowSimilarityPackages = await this.findLowSimilarityPackages(projectId, {
      sharedThreshold: 1,
      similarityRatio: 0.2,
      limit: 10,
    });

    // Get current project dependencies to find old versions
    let projectDeps = await this.sbomRepo.getProjectDependencies(projectId);
    let projectWatchlist = await this.sbomRepo.getProjectWatchlist(projectId);
    projectDeps = [...projectDeps, ...projectWatchlist];
    
    // Create a map of package name to current version
    const currentVersions = new Map<string, string>();
    for (const dep of projectDeps) {
      const pkgName = dep.package_name?.toLowerCase();
      if (pkgName && dep.version) {
        currentVersions.set(pkgName, dep.version);
      }
    }

    // Calculate score based on:
    // 1. Number of conflicts (fewer is better)
    // 2. Number of low similarity packages (fewer is better)
    // 3. Number of upgrade recommendations (fewer is better)
    
    let score = 100;
    let conflicts = 0;
    let recommendationCount = 0;
    let formattedRecommendations: any[] = [];
    
    // Check if upgradeRecommendations has an error property (type guard)
    if (upgradeRecommendations && !('error' in upgradeRecommendations)) {
      conflicts = upgradeRecommendations.conflicts || 0;
      const combo = upgradeRecommendations.combo || [];
      recommendationCount = combo.length;
      
      // Format recommendations with all needed fields
      formattedRecommendations = combo.map((item: { name: string; version: string }) => {
        const pkgName = item.name;
        const newVersion = item.version;
        const oldVersion = currentVersions.get(pkgName.toLowerCase()) || 'unknown';
        
        // Determine impact based on conflicts
        let impact: 'low' | 'medium' | 'high' = 'low';
        if (conflicts > 5) {
          impact = 'high';
        } else if (conflicts > 2) {
          impact = 'medium';
        }
        
        return {
          packageName: pkgName,
          oldVersion: oldVersion,
          newVersion: newVersion,
          title: `Upgrade ${pkgName} to ${newVersion}`,
          description: `Upgrading from ${oldVersion} to ${newVersion} will help reduce dependency conflicts (${conflicts} conflicts detected).`,
          impact: impact,
          dependencies: [`${pkgName}@${newVersion}`],
        };
      });
      
      // Penalize for conflicts (each conflict reduces score by 5 points)
      score -= conflicts * 5;
      
      // Penalize for having many recommendations (each recommendation beyond 3 reduces score by 2 points)
      if (recommendationCount > 3) {
        score -= (recommendationCount - 3) * 2;
      }
    }
    
    // Format low similarity packages
    const formattedLowSimilarity = lowSimilarityPackages.map((pkg: any) => {
      const pkgName = pkg.packageName || pkg.packageId || 'unknown';
      return {
        packageName: pkgName,
        title: `Review high-risk anchor package: ${pkgName}`,
        description: `This package has low similarity with the rest of your dependency tree (${pkg.sharedDependencyCount || 0} shared dependencies, ${pkg.dependencyCount || 0} total). Consider reviewing or isolating this package.`,
        impact: 'high' as const,
        dependencies: [pkgName],
        sharedDependencyCount: pkg.sharedDependencyCount || 0,
        dependencyCount: pkg.dependencyCount || 0,
      };
    });
    
    // Penalize for low similarity packages (each package reduces score by 3 points)
    const lowSimilarityCount = lowSimilarityPackages.length;
    score -= lowSimilarityCount * 3;
    
    // Ensure score is between 0 and 100
    score = Math.max(0, Math.min(100, Math.round(score)));
    
    return {
      score,
      duplicateCount: conflicts, // Conflicts represent duplicate/conflicting versions
      highRiskCount: lowSimilarityCount, // Low similarity packages are high-risk anchors
      recommendationCount,
      recommendations: formattedRecommendations,
      lowSimilarityPackages: formattedLowSimilarity,
    };
  }
}
