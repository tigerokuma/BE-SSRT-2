import { Injectable, Logger } from '@nestjs/common';
import neo4j from 'neo4j-driver';
import { SbomRepository } from '../repositories/sbom.repository';

const MEMGRAPH_URI = "bolt://localhost:7687";
const USER = "memgraph";
const PASSWORD = "memgraph";

@Injectable()
export class DependencyOptimizerService {
  private readonly logger = new Logger(DependencyOptimizerService.name);
  private readonly driver;

  constructor(private readonly sbomRepo: SbomRepository) {
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
}
