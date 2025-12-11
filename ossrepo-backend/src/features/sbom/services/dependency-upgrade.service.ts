import { Injectable, Logger } from '@nestjs/common';
import neo4j from 'neo4j-driver';
import { SbomRepository } from '../repositories/sbom.repository';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConnectionService } from '../../../common/azure/azure.service';
import axios from 'axios';
import * as semver from 'semver';

@Injectable()
export class DependencyOptimizerService {
  private readonly logger = new Logger(DependencyOptimizerService.name);
  
  private get driver() {
    return this.connectionService.getMemgraph();
  }

  constructor(
    private readonly sbomRepo: SbomRepository,
    private readonly prisma: PrismaService,
    private readonly connectionService: ConnectionService,
  ) {}

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
   * Fetch package information from NPM registry including dependencies and available versions
   */
  private async fetchNpmPackageInfo(packageName: string, version?: string): Promise<{
    dependencies?: Record<string, string>;
    versions?: string[];
    error?: string;
  }> {
    try {
      const response = await axios.get(`https://registry.npmjs.org/${packageName}`, {
        timeout: 5000,
      });
      const data = response.data;
      
      if (version && data.versions && data.versions[version]) {
        const versionData = data.versions[version];
        return {
          dependencies: {
            ...versionData.dependencies,
            ...versionData.peerDependencies,
            ...versionData.optionalDependencies,
          },
          versions: Object.keys(data.versions).filter(v => !v.includes('-')), // Exclude pre-releases
        };
      }
      
      return {
        dependencies: {},
        versions: Object.keys(data.versions || {}).filter(v => !v.includes('-')),
      };
    } catch (error) {
      this.logger.warn(`Failed to fetch NPM info for ${packageName}:`, error.message);
      return { error: error.message };
    }
  }

  /**
   * Check if a version satisfies a semver range
   */
  private satisfiesVersion(version: string, range: string): boolean {
    try {
      // Clean up range (remove npm: prefix, etc.)
      const cleanRange = range.replace(/^npm:/, '').trim();
      return semver.satisfies(version, cleanRange);
    } catch (error) {
      // If semver parsing fails, try simple comparison
      return false;
    }
  }

  /**
   * Find compatible versions for a package that satisfy all dependency requirements
   */
  private async findCompatibleVersions(
    packageName: string,
    requiredBy: Array<{ requiredBy?: string; name?: string; version?: string; range: string }>,
    currentVersion: string
  ): Promise<string[]> {
    try {
      const npmInfo = await this.fetchNpmPackageInfo(packageName);
      if (npmInfo.error || !npmInfo.versions) {
        return [currentVersion]; // Fallback to current version
      }

      // Filter versions that satisfy all requirements
      const compatibleVersions = npmInfo.versions.filter(v => {
        return requiredBy.every(req => this.satisfiesVersion(v, req.range));
      });

      // Sort by semver (newest first)
      compatibleVersions.sort((a, b) => semver.rcompare(a, b));

      return compatibleVersions.length > 0 ? compatibleVersions : [currentVersion];
    } catch (error) {
      this.logger.warn(`Error finding compatible versions for ${packageName}:`, error.message);
      return [currentVersion];
    }
  }

  /**
   * Given a list of package names, simulate upgrades/downgrades and measure
   * the change in total transitive dependencies, considering actual dependency requirements.
   */
  async simulateUpgradeImpact(projectId: string) {
    // Step 1: Get all packages from project_dependencies table (including main package)
    let projectDeps = await this.prisma.project_dependencies.findMany({
      where: { project_id: projectId },
      select: {
        name: true,
        version: true,
        package_id: true,
      },
      orderBy: { name: 'asc' },
    });

    // If no project_dependencies found, try to get from BranchDependency via monitored branch
    if (projectDeps.length === 0) {
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        select: {
          monitored_branch_id: true,
        },
      });

      if (project?.monitored_branch_id) {
        const branchDeps = await this.prisma.branchDependency.findMany({
          where: { monitored_branch_id: project.monitored_branch_id },
          select: {
            name: true,
            version: true,
            package_id: true,
          },
          orderBy: { name: 'asc' },
        });

        // Convert BranchDependency to same format as project_dependencies
        projectDeps = branchDeps.map(dep => ({
          name: dep.name,
          version: dep.version,
          package_id: dep.package_id,
        }));
      }
    }

    if (projectDeps.length === 0) {
      return { error: 'No packages found in project' };
    }

    // Get the main package (project itself) - it might be in project_dependencies or we need to get it from Project
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true },
    });

    const currentPackages: Array<{ name: string; version: string; deps: string[] }> = [];
    const allDependenciesInProject = new Map<string, Set<string>>(); // Map: depName -> Set of versions

    // Track all packages (including main) for duplicate detection
    for (const dep of projectDeps) {
      const depName = dep.name;
      const depVersion = dep.version;
      
      if (depName && depVersion) {
        if (!allDependenciesInProject.has(depName)) {
          allDependenciesInProject.set(depName, new Set());
        }
        allDependenciesInProject.get(depName)!.add(depVersion);
      }
    }

    // Add main package if it exists and isn't already in project_dependencies
    if (project) {
      const mainPackageName = project.name;
      // Check if main package is already in dependencies
      const mainPackageInDeps = projectDeps.find(d => d.name === mainPackageName);
      
      if (!mainPackageInDeps) {
        // Main package not in dependencies, add it with a default version
        // We'll try to get version from Packages table if it exists
        const mainPackageInfo = await this.prisma.packages.findUnique({
          where: { name: mainPackageName },
          select: { name: true },
        });
        
        if (mainPackageInfo) {
          // Use a placeholder version for main package if not found
          const mainVersion = '1.0.0'; // Default version
          if (!allDependenciesInProject.has(mainPackageName)) {
            allDependenciesInProject.set(mainPackageName, new Set());
          }
          allDependenciesInProject.get(mainPackageName)!.add(mainVersion);
          
          currentPackages.push({
            name: mainPackageName,
            version: mainVersion,
            deps: projectDeps.map(d => `${d.name}@${d.version}`),
          });
        }
      } else {
        // Main package is in dependencies, use it
        currentPackages.push({
          name: mainPackageName,
          version: mainPackageInDeps.version,
          deps: projectDeps.filter(d => d.name !== mainPackageName).map(d => `${d.name}@${d.version}`),
        });
      }
    }

    // If no main package found, use the first dependency as the main package
    if (currentPackages.length === 0 && projectDeps.length > 0) {
      const firstDep = projectDeps[0];
      currentPackages.push({
        name: firstDep.name,
        version: firstDep.version,
        deps: projectDeps.slice(1).map(d => `${d.name}@${d.version}`),
      });
    }

    if (currentPackages.length === 0) {
      this.logger.warn(`No packages to analyze for project ${projectId}`);
      return { error: 'No packages to analyze' };
    }

  // Step 2: Collect all dependency requirements from NPM
  // Map: dependencyName -> array of { requiredBy: package, version: packageVersion, range: semverRange }
  const dependencyRequirements = new Map<string, Array<{ requiredBy: string; version: string; range: string }>>();
  const allDependencyNames = new Set<string>();
  
  for (const pkg of currentPackages) {
    try {
      const npmInfo = await this.fetchNpmPackageInfo(pkg.name, pkg.version);
      if (npmInfo.dependencies) {
        for (const [depName, depRange] of Object.entries(npmInfo.dependencies)) {
          allDependencyNames.add(depName);
          if (!dependencyRequirements.has(depName)) {
            dependencyRequirements.set(depName, []);
          }
          dependencyRequirements.get(depName)!.push({
            requiredBy: pkg.name,
            version: pkg.version,
            range: depRange as string,
          });
        }
      }
    } catch (error) {
      // Failed to fetch requirements
    }
  }

  // Step 3: Identify conflicts - dependencies with multiple incompatible version requirements
  // First, explicitly detect duplicate packages (same name, different versions) from project dependencies
  const duplicatePackages = new Map<string, Set<string>>(); // Map: packageName -> Set of versions
  
  // Check all dependencies in project for duplicates
  for (const [depName, versions] of allDependenciesInProject.entries()) {
    if (versions.size > 1) {
      duplicatePackages.set(depName, versions);
    }
  }
  
  // Also check for duplicates in direct dependencies of main packages
  for (const pkg of currentPackages) {
    const directDeps = new Map<string, Set<string>>();
    for (const dep of pkg.deps) {
      const [name, version] = dep.split('@');
      if (name && version) {
        if (!directDeps.has(name)) {
          directDeps.set(name, new Set());
        }
        directDeps.get(name)!.add(version);
      }
    }
    // Check for duplicates in direct dependencies
    for (const [depName, versions] of directDeps.entries()) {
      if (versions.size > 1) {
        if (!duplicatePackages.has(depName)) {
          duplicatePackages.set(depName, new Set());
        }
        versions.forEach(v => duplicatePackages.get(depName)!.add(v));
      }
    }
  }
  
  const conflicts: Array<{ dependency: string; currentVersions: string[]; requirements: Array<{ requiredBy: string; range: string }> }> = [];
  
  // Check all dependencies that are either:
  // 1. Have duplicates (same name, different versions)
  // 2. Are required by packages and have version conflicts
  const allDepsToCheck = new Set<string>();
  duplicatePackages.forEach((_, depName) => allDepsToCheck.add(depName));
  allDependencyNames.forEach(depName => allDepsToCheck.add(depName));
  
  for (const depName of allDepsToCheck) {
    const requirements = dependencyRequirements.get(depName) || [];
    
    // Get current versions of this dependency from project
    const currentVersions = new Set<string>();
    
    // Check in all dependencies tracked from project
    if (allDependenciesInProject.has(depName)) {
      allDependenciesInProject.get(depName)!.forEach(ver => currentVersions.add(ver));
    }
    
    // Also check in package deps (for direct dependencies)
    for (const pkg of currentPackages) {
      for (const dep of pkg.deps) {
        const [name, version] = dep.split('@');
        if (name === depName && version) {
          currentVersions.add(version);
        }
      }
    }

    if (currentVersions.size === 0) {
      // Dependency is required but not present in project - might be a missing dependency
      continue;
    }

    // If we have duplicates, it's always a conflict
    const hasDuplicates = currentVersions.size > 1;
    
    // Check if current versions satisfy all requirements
    const hasVersionConflict = requirements.length > 0 && Array.from(currentVersions).some(version => {
      const satisfiesAll = requirements.every(req => {
        return this.satisfiesVersion(version, req.range);
      });
      return !satisfiesAll;
    });

    if (hasDuplicates || hasVersionConflict) {
      conflicts.push({
        dependency: depName,
        currentVersions: Array.from(currentVersions),
        requirements,
      });
    }
  }
  
  // Step 4: For each conflicting dependency, find compatible versions (including downgrades)
  const recommendations: Array<{ name: string; oldVersion: string; newVersion: string; isDowngrade: boolean }> = [];
  
  for (const conflict of conflicts) {
    const compatibleVersions = await this.findCompatibleVersions(
      conflict.dependency,
      conflict.requirements,
      conflict.currentVersions[0] || '0.0.0'
    );

    if (compatibleVersions.length > 0) {
      const bestVersion = compatibleVersions[0]; // Already sorted newest first
      const currentVersion = conflict.currentVersions[0];
      
      // Check if this is a downgrade
      const isDowngrade = currentVersion && semver.lt(bestVersion, currentVersion);
      
      // Only recommend if it's different from current
      if (bestVersion !== currentVersion) {
        // Recommend the change (whether it's a direct dependency or transitive)
        recommendations.push({
          name: conflict.dependency,
          oldVersion: currentVersion,
          newVersion: bestVersion,
          isDowngrade: !!isDowngrade,
        });
      }
    }
  }

  // Step 5: Format recommendations
  // Group by package name and pick the best recommendation
  const recommendationMap = new Map<string, typeof recommendations[0]>();
  for (const rec of recommendations) {
    const existing = recommendationMap.get(rec.name);
    if (!existing || (rec.isDowngrade && !existing.isDowngrade)) {
      recommendationMap.set(rec.name, rec);
    }
  }

  const combo = Array.from(recommendationMap.values()).map(rec => ({
    name: rec.name,
    version: rec.newVersion,
  }));

  return {
    combo,
    conflicts: conflicts.length,
    recommendations: Array.from(recommendationMap.values()),
  };


  }

  /**
   * Given a project_id, get upgrade recommendations for packages in that project.
   */
  async getUpgradeRecommendations(projectId: string) {
    // Pass projectId directly to simulateUpgradeImpact which now uses project_dependencies
    const all = await this.simulateUpgradeImpact(projectId);
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

    const uniquePackages = new Map<string, { package_id: string; package_name?: string; version?: string }>();
    const packageNames = new Map<string, string>();
    for (const dep of projectDeps) {
      uniquePackages.set(dep.package_id, dep);
      if (dep.package_name) {
        packageNames.set(dep.package_id, dep.package_name);
      }
    }

    if (!uniquePackages.size) {
      return [];
    }

    const packageIds = Array.from(uniquePackages.keys());
    const session = this.driver.session();

    try {
      // Query by db_package_id first, then fallback to package name
      const result = await session.run(
        `
        MATCH (p:Package)
        WHERE p.db_package_id IN $packageIds
           OR (p.db_package_id IS NULL AND p.name IN $packageNames)
        OPTIONAL MATCH (p)-[:DEPENDS_ON]->(dep:Package)
        WITH p, collect(DISTINCT dep.name) AS depNames, collect(DISTINCT dep.db_package_id) AS depIds
        RETURN COALESCE(p.db_package_id, p.name) AS packageId,
               COALESCE(p.name, p.purl) AS packageName,
               depNames AS dependencyNames,
               depIds AS dependencies,
               size(depNames) AS dependencyCount
        `,
        { 
          packageIds: packageIds.filter(id => id !== null),
          packageNames: Array.from(packageNames.values())
        },
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

      // Get packages that depend on each anchor package (from SBOMs)
      // Query all SBOMs and find which packages depend on the anchor packages
      const dependentsQuery = await session.run(
        `
        MATCH (s:SBOM)
        MATCH (anchor:Package)-[:BELONGS_TO]->(s)
        WHERE anchor.db_package_id IN $packageIds
        WITH anchor, s
        MATCH (dependent:Package)-[:DEPENDS_ON]->(anchor)
        WHERE (dependent)-[:BELONGS_TO]->(s)
        RETURN anchor.db_package_id AS packageId,
               collect(DISTINCT dependent.name) AS dependents
        `,
        { packageIds },
      );

      const dependentsMap = new Map<string, string[]>();
      for (const record of dependentsQuery.records) {
        const pkgId = record.get('packageId');
        const dependents = (record.get('dependents') || []).filter(Boolean);
        dependentsMap.set(pkgId, dependents);
      }

      const stats = packageIds
        .filter((packageId) => {
          // Only include packages with at least 5 dependencies in flattening calculation
          const info = dependencySets.get(packageId);
          return info && info.dependencyCount >= 3;
        })
        .map((packageId) => {
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
          dependents: dependentsMap.get(packageId) || [],
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
    try {
      // Get project name
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        select: { name: true },
      });
      const projectName = project?.name || 'Unknown Project';

      // Get all project package names
      let projectDeps = await this.sbomRepo.getProjectDependencies(projectId);
      const projectPackageNames = projectDeps.map((dep) => dep.package_name);
      const otherProjectPackages = projectPackageNames.filter(
        (name) => name.toLowerCase() !== packageName.toLowerCase(),
      );

      // Helper to get dependencies for a version (creates its own session to avoid transaction conflicts)
      const getDependencies = async (version: string) => {
        const session = this.driver.session();
        try {
          const query = `
            MATCH (p:Package {name: $packageName, version: $version})
            OPTIONAL MATCH (p)-[:DEPENDS_ON]->(dep:Package)
            WITH collect(DISTINCT dep.name) AS deps
            RETURN deps
          `;
          const result = await session.run(query, { packageName, version });
          if (result.records.length === 0) return [];
          return result.records[0].get('deps').filter(Boolean);
        } finally {
          await session.close();
        }
      };

      // Get dependencies of other project packages (creates its own session to avoid transaction conflicts)
      const getOtherProjectDependencies = async () => {
        if (otherProjectPackages.length === 0) return [];
        const session = this.driver.session();
        try {
          const query = `
            MATCH (p:Package)
            WHERE p.name IN $packageNames
            OPTIONAL MATCH (p)-[:DEPENDS_ON]->(dep:Package)
            WITH collect(DISTINCT dep.name) AS deps
            RETURN deps
          `;
          const result = await session.run(query, {
            packageNames: otherProjectPackages,
          });
          if (result.records.length === 0) return [];
          return result.records[0].get('deps').filter(Boolean);
        } finally {
          await session.close();
        }
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
    }
  }

  /**
   * Get combined flattening analysis including score, recommendations, and low similarity packages.
   * This combines upgrade recommendations and low similarity analysis into a single score.
   */
  /**
   * Calculate separate and shared dependency counts for a specific package version
   * by comparing its dependencies with the total project packages (excluding the upgrade package)
   * Separate: dependencies NOT in project packages
   * Shared: dependencies IN project packages
   */
  private async calculatePackageDependencyStats(
    projectId: string,
    packageName: string,
    packageVersion: string | null | undefined,
    excludePackageName?: string
  ) {
    const session = this.driver.session();
    try {
      // Get project packages
      let projectDeps = await this.sbomRepo.getProjectDependencies(projectId);
      
      // Always check BranchDependency to ensure we have all packages
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        select: { monitored_branch_id: true },
      });
      
      if (project?.monitored_branch_id) {
        const branchDeps = await this.prisma.branchDependency.findMany({
          where: { monitored_branch_id: project.monitored_branch_id },
          select: { name: true, version: true },
        });
        
        // Add any missing packages from branch dependencies
        for (const branchDep of branchDeps) {
          const exists = projectDeps.some(
            d => d.package_name?.toLowerCase() === branchDep.name?.toLowerCase()
          );
          if (!exists && branchDep.name) {
            projectDeps.push({
              package_id: null,
              package_name: branchDep.name,
              version: branchDep.version || 'unknown',
            });
          }
        }
      }
  
      // Get all OTHER project packages (excluding the target package)
      const otherPackages = projectDeps
        .filter(
          d =>
            d.package_name &&
            d.package_name.toLowerCase() !== packageName.toLowerCase() &&
            d.version
        )
        .map(d => ({
          name: d.package_name!,
          version: d.version || 'unknown'
        }));
  
      // --- QUERY FOR TARGET PACKAGE DEPENDENCIES (by PURL) ---
      // For packages without version, find the latest version in Memgraph
      let effectiveVersion = packageVersion;
      if (!effectiveVersion || effectiveVersion === 'null' || effectiveVersion === '' || effectiveVersion === 'unknown') {
        const latestVersionResult = await session.run(
          `
          MATCH (p:Package)
          WHERE toLower(p.name) = toLower($name)
            AND p.version IS NOT NULL 
            AND p.version <> ''
            AND p.version <> 'unknown'
          WITH p.version AS version
          ORDER BY version DESC
          LIMIT 1
          RETURN version
          `,
          { name: packageName },
        );
        if (latestVersionResult.records.length > 0) {
          effectiveVersion = latestVersionResult.records[0].get('version');
          this.logger.debug(`Found latest version for package ${packageName}: ${effectiveVersion}`);
        } else {
          // No version found in Memgraph, return empty stats
          this.logger.warn(`No version found in Memgraph for package: ${packageName}`);
          return {
            separateCount: 0,
            sharedCount: 0,
            dependencyDetails: [],
          };
        }
      }
      
      // First, find the target package's PURL using the effective version
      const findTargetPurlQuery = `
        MATCH (p:Package)
        WHERE toLower(p.name) = toLower($name) AND p.version = $version
        RETURN p.purl AS purl
        LIMIT 1
      `;
      
      const targetPurlResult = await session.run(findTargetPurlQuery, { 
        name: packageName, 
        version: effectiveVersion 
      });
      
      let targetPurl: string | null = null;
      if (targetPurlResult.records.length > 0) {
        targetPurl = targetPurlResult.records[0].get("purl");
      }
      
      // If no PURL found, construct one (fallback)
      if (!targetPurl) {
        targetPurl = `pkg:npm/${packageName}@${effectiveVersion}`;
      }
  
      const targetQuery = `
        MATCH (p:Package {purl: $purl})
        OPTIONAL MATCH (p)-[:DEPENDS_ON*1..]->(dep:Package)
        WITH DISTINCT dep
        WHERE dep IS NOT NULL AND dep.purl IS NOT NULL
        RETURN dep.purl AS purl, dep.name AS name, dep.version AS version
      `;
  
      const targetResult = await session.run(targetQuery, { purl: targetPurl });
  
      const targetDependencies = new Set<string>();
      const dependencyDetails = new Map<string, { name: string; version: string }>();
  
      for (const record of targetResult.records) {
        const depPurl = record.get("purl");
        const depName = record.get("name");
        const depVersion = record.get("version") || "unknown";
  
        if (!depPurl) continue;
  
        targetDependencies.add(depPurl);
  
        // Store dependency details by PURL
        if (!dependencyDetails.has(depPurl)) {
          dependencyDetails.set(depPurl, { name: depName || 'unknown', version: depVersion });
        } else {
          const existing = dependencyDetails.get(depPurl)!;
          if (
            semver.valid(depVersion) &&
            semver.valid(existing.version) &&
            semver.gt(depVersion, existing.version)
          ) {
            dependencyDetails.set(depPurl, { name: depName || existing.name, version: depVersion });
          } else if (existing.version === "unknown" && depVersion !== "unknown") {
            dependencyDetails.set(depPurl, { name: depName || existing.name, version: depVersion });
          }
        }
      }
  
      // --- QUERY FOR ALL OTHER PROJECT PACKAGES' DEPENDENCIES (by PURL) ---
      const allOtherDependencies = new Set<string>();
      
      if (otherPackages.length > 0) {
        try {
          // First, find PURLs for all other packages
          const findPurlsQuery = `
            UNWIND $packages AS pkg
            MATCH (p:Package {name: pkg.name, version: pkg.version})
            RETURN p.purl AS purl
          `;
          
          const purlsResult = await session.run(findPurlsQuery, { packages: otherPackages });
          const otherPurls: string[] = [];
          
          for (const record of purlsResult.records) {
            const purl = record.get("purl");
            if (purl) {
              otherPurls.push(purl);
            }
          }
          
          // If no PURLs found, construct them (fallback)
          if (otherPurls.length === 0) {
            for (const pkg of otherPackages) {
              otherPurls.push(`pkg:npm/${pkg.name}@${pkg.version}`);
            }
          }
          
          if (otherPurls.length > 0) {
            const otherQuery = `
              UNWIND $purls AS purl
              MATCH (p:Package {purl: purl})
              OPTIONAL MATCH (p)-[:DEPENDS_ON*1..]->(dep:Package)
              WITH DISTINCT dep
              WHERE dep IS NOT NULL AND dep.purl IS NOT NULL
              RETURN dep.purl AS purl
            `;
  
            const otherResult = await session.run(otherQuery, { purls: otherPurls });
  
            for (const record of otherResult.records) {
              const depPurl = record.get("purl");
              if (depPurl) {
                allOtherDependencies.add(depPurl);
              }
            }
          }
        } catch (error) {
          this.logger.warn(`Failed to get other packages' dependencies:`, error.message);
          // Fallback: try without version constraint
          if (otherPackages.length > 0) {
            const fallbackQuery = `
              UNWIND $packageNames AS pkgName
              MATCH (p:Package {name: pkgName})
              OPTIONAL MATCH (p)-[:DEPENDS_ON*1..]->(dep:Package)
              WITH DISTINCT dep
              WHERE dep IS NOT NULL AND dep.purl IS NOT NULL
              RETURN dep.purl AS purl
              LIMIT 10000
            `;
  
            const packageNames = otherPackages.map(p => p.name);
            const fallbackResult = await session.run(fallbackQuery, { packageNames });
  
            for (const record of fallbackResult.records) {
              const depPurl = record.get("purl");
              if (depPurl) {
                allOtherDependencies.add(depPurl);
              }
            }
          }
        }
      }
  
      // Count shared / separate and collect shared dependencies
      // Shared: dependencies that are in both target package AND other project packages (by PURL)
      // Separate: dependencies that are ONLY in target package (not in other packages)
      let sharedCount = 0;
      let separateCount = 0;
      const sharedDependencies: Array<{ name: string; version: string; purl: string }> = [];
      const separateDependencies: Array<{ name: string; version: string; purl: string }> = [];
  
      for (const depPurl of targetDependencies) {
        const depDetail = dependencyDetails.get(depPurl);
        if (depDetail) {
          if (allOtherDependencies.has(depPurl)) {
            sharedCount++;
            sharedDependencies.push({
              name: depDetail.name,
              version: depDetail.version,
              purl: depPurl,
            });
          } else {
            separateCount++;
            separateDependencies.push({
              name: depDetail.name,
              version: depDetail.version,
              purl: depPurl,
            });
          }
        }
      }
  
      return {
        separateCount,
        sharedCount,
        dependencyDetails: Array.from(dependencyDetails.values()),
        sharedDependencies,
        separateDependencies,
      };
  
    } catch (error) {
      this.logger.error("Error calculating package dependency stats:", error);
      return { 
        separateCount: 0, 
        sharedCount: 0, 
        dependencyDetails: [],
        sharedDependencies: [],
        separateDependencies: [],
      };
    } finally {
      await session.close();
    }
  }
  

  /**
   * Calculate overall separate and shared dependency counts for the project
   * by comparing all dependencies from all packages with the total project packages list
   */
  private async calculateProjectDependencyStats(projectId: string, packageVersions?: Map<string, string>) {
    const session = this.driver.session();
    try {
      // Get all project packages
      let projectDeps = await this.sbomRepo.getProjectDependencies(projectId);
      
      if (projectDeps.length === 0) {
        return { separateCount: 0, sharedCount: 0, dependencyDetails: [] };
      }

      // Get package names and versions
      const packageNames: string[] = [];
      const packageVersionMap = new Map<string, string>();
      
      for (const dep of projectDeps) {
        const pkgName = dep.package_name;
        const version = packageVersions?.get(pkgName.toLowerCase()) || dep.version;
        if (pkgName) {
          packageNames.push(pkgName);
          packageVersionMap.set(pkgName, version);
        }
      }

      if (packageNames.length === 0) {
        return { separateCount: 0, sharedCount: 0, dependencyDetails: [] };
      }

      // First, find PURLs for all project packages
       const findPurlsQuery = `
         UNWIND $packagePairs AS pair
         MATCH (p:Package {name: pair.name, version: pair.version})
         RETURN p.purl AS purl
       `;
       
       const packagePairs = packageNames.map((name, idx) => ({
         name: name,
         version: packageVersionMap.get(name) || 'unknown'
       }));
       
       const purlsResult = await session.run(findPurlsQuery, { packagePairs });
       const projectPurls: string[] = [];
       
       for (const record of purlsResult.records) {
         const purl = record.get("purl");
         if (purl) {
           projectPurls.push(purl);
         }
       }
       
       // If no PURLs found, construct them (fallback)
       if (projectPurls.length === 0) {
         for (const pkg of packagePairs) {
           projectPurls.push(`pkg:npm/${pkg.name}@${pkg.version}`);
         }
       }

       // Get all dependencies for all packages from Memgraph (by PURL)
       const allDependencies = new Set<string>();
       const dependencyDetails = new Map<string, { name: string; version: string }>();

       try {
         // Get all transitive dependencies for all project packages
         const query = `
           UNWIND $purls AS purl
           MATCH (p:Package {purl: purl})
           OPTIONAL MATCH (p)-[:DEPENDS_ON*1..]->(dep:Package)
           WITH DISTINCT dep
           WHERE dep IS NOT NULL AND dep.purl IS NOT NULL
           RETURN dep.purl AS purl, dep.name AS name, dep.version AS version
         `;
         
         const result = await session.run(query, { purls: projectPurls });
         
         for (const record of result.records) {
           const depPurl = record.get('purl');
           const depName = record.get('name');
           const depVersion = record.get('version') || 'unknown';
           
           if (depPurl) {
             allDependencies.add(depPurl);
             
             if (!dependencyDetails.has(depPurl)) {
               dependencyDetails.set(depPurl, {
                 name: depName || 'unknown',
                 version: depVersion,
               });
             } else if (depVersion !== 'unknown') {
               const existing = dependencyDetails.get(depPurl);
               try {
                 if (semver.valid(depVersion) && semver.valid(existing?.version)) {
                   if (semver.gt(depVersion, existing.version)) {
                     dependencyDetails.set(depPurl, {
                       name: depName || existing?.name || 'unknown',
                       version: depVersion,
                     });
                   }
                 } else if (existing?.version === 'unknown') {
                   dependencyDetails.set(depPurl, {
                     name: depName || existing?.name || 'unknown',
                     version: depVersion,
                   });
                 }
               } catch (e) {
                 if (existing?.version === 'unknown') {
                   dependencyDetails.set(depPurl, {
                     name: depName || existing?.name || 'unknown',
                     version: depVersion,
                   });
                 }
               }
             }
           }
         }
       } catch (error) {
         this.logger.error(`Failed to get dependencies from Memgraph:`, error);
         return { separateCount: 0, sharedCount: 0, dependencyDetails: [] };
       }

      // Get branch_dependencies (all dependencies used by the project) for comparison
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        select: { monitored_branch_id: true },
      });

      // Get PURLs for branch_dependencies from Memgraph
      const branchDependencyPurls = new Set<string>();
      if (project?.monitored_branch_id) {
        const branchDeps = await this.prisma.branchDependency.findMany({
          where: { monitored_branch_id: project.monitored_branch_id },
          select: { name: true, version: true },
        });
        
        // Query Memgraph to find PURLs for branch dependencies
        if (branchDeps.length > 0) {
          const branchDepPairs = branchDeps
            .filter(d => d.name && d.version)
            .map(d => ({ name: d.name!, version: d.version! }));
          
          if (branchDepPairs.length > 0) {
            try {
              const findBranchPurlsQuery = `
                UNWIND $pairs AS pair
                MATCH (p:Package {name: pair.name, version: pair.version})
                RETURN p.purl AS purl
              `;
              
              const branchPurlsResult = await session.run(findBranchPurlsQuery, { pairs: branchDepPairs });
              
              for (const record of branchPurlsResult.records) {
                const purl = record.get("purl");
                if (purl) {
                  branchDependencyPurls.add(purl);
                }
              }
              
              // Fallback: construct PURLs if not found in Memgraph
              if (branchDependencyPurls.size === 0) {
                for (const dep of branchDepPairs) {
                  branchDependencyPurls.add(`pkg:npm/${dep.name}@${dep.version}`);
                }
              }
            } catch (error) {
              this.logger.warn(`Failed to get PURLs for branch dependencies:`, error.message);
              // Fallback: construct PURLs
              for (const dep of branchDepPairs) {
                branchDependencyPurls.add(`pkg:npm/${dep.name}@${dep.version}`);
              }
            }
          }
        }
      }

      // Compare dependencies with branch_dependencies (by PURL)
      // Shared: dependencies that are in branch_dependencies (used by the project)
      // Separate: dependencies that are NOT in branch_dependencies
      let separateCount = 0;
      let sharedCount = 0;

      for (const depPurl of allDependencies) {
        if (branchDependencyPurls.has(depPurl)) {
          sharedCount++;
        } else {
          separateCount++;
        }
      }

      return { separateCount, sharedCount, dependencyDetails: Array.from(dependencyDetails.values()) };
    } catch (error) {
      this.logger.error(`Error calculating dependency stats:`, error);
      return { separateCount: 0, sharedCount: 0, dependencyDetails: [] };
    } finally {
      await session.close();
    }
  }

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
    
    // Create a map of package name to current version
    const currentVersions = new Map<string, string>();
    for (const dep of projectDeps) {
      const pkgName = dep.package_name?.toLowerCase();
      if (pkgName && dep.version) {
        currentVersions.set(pkgName, dep.version);
      }
    }

    // Calculate overall before stats (current state of all packages)
    const beforeStatsResult = await this.calculateProjectDependencyStats(projectId);
    const beforeStats = {
      separateCount: beforeStatsResult.separateCount,
      sharedCount: beforeStatsResult.sharedCount,
    };

    // Calculate score based on:
    // 1. Number of conflicts (fewer is better)
    // 2. Number of low similarity packages (fewer is better)
    // 3. Number of upgrade recommendations (fewer is better)
    
    let score = 100;
    let conflicts = 0;
    let recommendationCount = 0;
    let formattedRecommendations: any[] = [];
    
    // Check if upgradeRecommendations has an error property (type guard)
    let afterStats = { separateCount: 0, sharedCount: 0 };
    
    if (upgradeRecommendations && !('error' in upgradeRecommendations)) {
      conflicts = upgradeRecommendations.conflicts || 0;
      const combo = upgradeRecommendations.combo || [];
      recommendationCount = combo.length;
      
      // Get recommendations with downgrade info if available
      const recommendationsWithInfo = (upgradeRecommendations as any).recommendations || [];
      
      // Create map of recommended versions
      const recommendedVersions = new Map<string, string>();
      for (const item of combo) {
        recommendedVersions.set(item.name.toLowerCase(), item.version);
      }
      
      // Merge current versions with recommended versions
      const afterVersions = new Map(currentVersions);
      for (const [pkgName, newVersion] of recommendedVersions.entries()) {
        afterVersions.set(pkgName, newVersion);
      }
      
      // Calculate after stats (with recommended versions applied to all packages)
      const afterStatsResult = await this.calculateProjectDependencyStats(projectId, afterVersions);
      afterStats = {
        separateCount: afterStatsResult.separateCount,
        sharedCount: afterStatsResult.sharedCount,
      };
      
      // For each recommendation, calculate before/after stats for that specific package
      // by comparing its dependencies with total project packages (excluding the upgrade package)
      for (const rec of formattedRecommendations) {
        if (rec.packageName && rec.oldVersion && rec.newVersion) {
          // Calculate before stats for this package version
          const beforePkgStats = await this.calculatePackageDependencyStats(
            projectId,
            rec.packageName,
            rec.oldVersion,
            rec.packageName // Exclude this package from project packages
          );
          
          // Calculate after stats for this package version
          const afterPkgStats = await this.calculatePackageDependencyStats(
            projectId,
            rec.packageName,
            rec.newVersion,
            rec.packageName // Exclude this package from project packages
          );
          
          // Store stats in the recommendation
          (rec as any).beforeStats = {
            separate: beforePkgStats.separateCount,
            shared: beforePkgStats.sharedCount,
            sharedDependencies: beforePkgStats.sharedDependencies || [],
          };
          (rec as any).afterStats = {
            separate: afterPkgStats.separateCount,
            shared: afterPkgStats.sharedCount,
            sharedDependencies: afterPkgStats.sharedDependencies || [],
          };
          
          // Track dependency version changes for this package
          const beforeDeps = new Map<string, string>();
          const afterDeps = new Map<string, string>();
          
          if (beforePkgStats.dependencyDetails) {
            for (const dep of beforePkgStats.dependencyDetails) {
              beforeDeps.set(dep.name.toLowerCase(), dep.version);
            }
          }
          
          if (afterPkgStats.dependencyDetails) {
            for (const dep of afterPkgStats.dependencyDetails) {
              afterDeps.set(dep.name.toLowerCase(), dep.version);
            }
          }
          
          // Find version changes for this package's dependencies
          const versionChanges: Array<{ name: string; oldVersion: string; newVersion: string }> = [];
          const allDepNames = new Set([...beforeDeps.keys(), ...afterDeps.keys()]);
          
          for (const depName of allDepNames) {
            const oldVer = beforeDeps.get(depName) || 'unknown';
            const newVer = afterDeps.get(depName) || 'unknown';
            if (oldVer !== newVer && oldVer !== 'unknown' && newVer !== 'unknown') {
              versionChanges.push({
                name: depName,
                oldVersion: oldVer,
                newVersion: newVer,
              });
            }
          }
          
          // Store version changes in the recommendation
          (rec as any).dependencyVersionChanges = versionChanges;
        }
      }
      
      // Get all dependency version changes across all packages
      const beforeDeps = new Map<string, string>();
      const afterDeps = new Map<string, string>();
      
      // Store before dependency versions
      if (beforeStatsResult.dependencyDetails) {
        for (const dep of beforeStatsResult.dependencyDetails) {
          beforeDeps.set(dep.name.toLowerCase(), dep.version);
        }
      }
      
      // Store after dependency versions
      if (afterStatsResult.dependencyDetails) {
        for (const dep of afterStatsResult.dependencyDetails) {
          afterDeps.set(dep.name.toLowerCase(), dep.version);
        }
      }
      
      // Find all version changes
      const versionChanges: Array<{ name: string; oldVersion: string; newVersion: string }> = [];
      const allDepNames = new Set([...beforeDeps.keys(), ...afterDeps.keys()]);
      
      for (const depName of allDepNames) {
        const oldVer = beforeDeps.get(depName) || 'unknown';
        const newVer = afterDeps.get(depName) || 'unknown';
        if (oldVer !== newVer && oldVer !== 'unknown' && newVer !== 'unknown') {
          versionChanges.push({
            name: depName,
            oldVersion: oldVer,
            newVersion: newVer,
          });
        }
      }
      
      // Add version changes to formatted recommendations (for dependencies not already covered)
      if (versionChanges.length > 0) {
        const existingRecNames = new Set(formattedRecommendations.map(r => r.packageName?.toLowerCase()));
        for (const change of versionChanges) {
          // Only add if not already in recommendations (to avoid duplicates)
          if (!existingRecNames.has(change.name.toLowerCase())) {
            // Check if it's a downgrade (only if both versions are valid semver)
            let isDowngrade = false;
            try {
              if (semver.valid(change.oldVersion) && semver.valid(change.newVersion)) {
                isDowngrade = semver.lt(change.newVersion, change.oldVersion);
              }
            } catch (e) {
              // If semver comparison fails, assume it's not a downgrade
            }
            
            formattedRecommendations.push({
              packageName: change.name,
              oldVersion: change.oldVersion,
              newVersion: change.newVersion,
              title: `Dependency ${change.name} version change`,
              description: `Version changed from ${change.oldVersion} to ${change.newVersion} due to package upgrades.`,
              impact: 'low' as const,
              dependencies: [`${change.name}@${change.newVersion}`],
              isDowngrade,
            });
          }
        }
      }
      
      // Format recommendations with all needed fields
      formattedRecommendations = combo.map((item: { name: string; version: string }) => {
        const pkgName = item.name;
        const newVersion = item.version;
        // TEMP: Use version 5.4.0 for the current package
        let oldVersion = currentVersions.get(pkgName.toLowerCase()) || 'unknown';
        if (oldVersion === 'unknown' || !oldVersion) {
          oldVersion = '5.4.0'; // Temporary hardcode
        }
        
        // Check if this is a downgrade
        const recInfo = recommendationsWithInfo.find((r: any) => r.name === pkgName);
        const isDowngrade = recInfo?.isDowngrade || false;
        
        // Determine impact based on conflicts
        let impact: 'low' | 'medium' | 'high' = 'low';
        if (conflicts > 5) {
          impact = 'high';
        } else if (conflicts > 2) {
          impact = 'medium';
        }
        
        const action = isDowngrade ? 'Downgrade' : 'Upgrade';
        const reason = isDowngrade 
          ? `Downgrading from ${oldVersion} to ${newVersion} will resolve dependency conflicts (${conflicts} conflicts detected). A dependency requires a lower version.`
          : `Upgrading from ${oldVersion} to ${newVersion} will help reduce dependency conflicts (${conflicts} conflicts detected).`;
        
        return {
          packageName: pkgName,
          oldVersion: oldVersion,
          newVersion: newVersion,
          title: `${action} ${pkgName} to ${newVersion}`,
          description: reason,
          impact: impact,
          dependencies: [`${pkgName}@${newVersion}`],
          isDowngrade,
        };
      });
      
      // For each recommendation, calculate before/after stats for that specific package
      // by comparing its dependencies with total project packages (excluding the upgrade package)
      for (const rec of formattedRecommendations) {
        if (rec.packageName && rec.oldVersion && rec.newVersion) {
          try {
            // Calculate before stats for this package version
            const beforePkgStats = await this.calculatePackageDependencyStats(
              projectId,
              rec.packageName,
              rec.oldVersion,
              rec.packageName // Exclude this package from project packages
            );
            
            // Calculate after stats for this package version
            const afterPkgStats = await this.calculatePackageDependencyStats(
              projectId,
              rec.packageName,
              rec.newVersion,
              rec.packageName // Exclude this package from project packages
            );
            
            // Store stats in the recommendation
            (rec as any).beforeStats = {
              separate: beforePkgStats.separateCount,
              shared: beforePkgStats.sharedCount,
              sharedDependencies: beforePkgStats.sharedDependencies || [],
            };
            (rec as any).afterStats = {
              separate: afterPkgStats.separateCount,
              shared: afterPkgStats.sharedCount,
              sharedDependencies: afterPkgStats.sharedDependencies || [],
            };
            
            // Track dependency version changes for this package
            const beforeDeps = new Map<string, string>();
            const afterDeps = new Map<string, string>();
            
            if (beforePkgStats.dependencyDetails) {
              for (const dep of beforePkgStats.dependencyDetails) {
                beforeDeps.set(dep.name.toLowerCase(), dep.version);
              }
            }
            
            if (afterPkgStats.dependencyDetails) {
              for (const dep of afterPkgStats.dependencyDetails) {
                afterDeps.set(dep.name.toLowerCase(), dep.version);
              }
            }
            
            // Find version changes for this package's dependencies
            const versionChanges: Array<{ name: string; oldVersion: string; newVersion: string }> = [];
            const allDepNames = new Set([...beforeDeps.keys(), ...afterDeps.keys()]);
            
            for (const depName of allDepNames) {
              const oldVer = beforeDeps.get(depName) || 'unknown';
              const newVer = afterDeps.get(depName) || 'unknown';
              if (oldVer !== newVer && oldVer !== 'unknown' && newVer !== 'unknown') {
                versionChanges.push({
                  name: depName,
                  oldVersion: oldVer,
                  newVersion: newVer,
                });
              }
            }
            
            // Store version changes in the recommendation
            (rec as any).dependencyVersionChanges = versionChanges;
          } catch (error) {
            this.logger.warn(`Failed to calculate stats for ${rec.packageName}:`, error);
            // Set default stats if calculation fails
            (rec as any).beforeStats = { separate: 0, shared: 0, sharedDependencies: [] };
            (rec as any).afterStats = { separate: 0, shared: 0, sharedDependencies: [] };
            (rec as any).dependencyVersionChanges = [];
          }
        }
      }
      
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
      const dependents = pkg.dependents || [];
      // Include the anchor package and packages that depend on it
      const allDependencies = [pkgName, ...dependents];
      
      return {
        packageName: pkgName,
        title: `Review high-risk anchor package: ${pkgName}`,
        description: dependents.length > 0
          ? `This package is an anchor for ${dependents.length} package${dependents.length > 1 ? 's' : ''} (${dependents.slice(0, 3).join(', ')}${dependents.length > 3 ? '...' : ''}) and has low similarity with the rest of your dependency tree (${pkg.sharedDependencyCount || 0} shared dependencies, ${pkg.dependencyCount || 0} total). Consider reviewing or isolating this package.`
          : `This package has low similarity with the rest of your dependency tree (${pkg.sharedDependencyCount || 0} shared dependencies, ${pkg.dependencyCount || 0} total). Consider reviewing or isolating this package.`,
        impact: 'high' as const,
        dependencies: allDependencies,
        dependents: dependents,
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
      // Dependency stats
      dependencyStats: {
        before: {
          separate: beforeStats.separateCount,
          shared: beforeStats.sharedCount,
        },
        after: {
          separate: afterStats.separateCount,
          shared: afterStats.sharedCount,
        },
      },
      recommendations: {
        // Include raw recommendations for frontend compatibility
        combo: upgradeRecommendations && !('error' in upgradeRecommendations) 
          ? (upgradeRecommendations.combo || [])
          : [],
        conflicts: conflicts,
        // Also include formatted recommendations with all package changes
        formatted: formattedRecommendations,
      },
      lowSimilarityPackages: formattedLowSimilarity,
    };
  }
}
