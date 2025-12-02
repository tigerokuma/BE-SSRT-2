import { Injectable, Logger } from '@nestjs/common';
import neo4j from 'neo4j-driver';
import { SbomRepository } from '../repositories/sbom.repository';
import { ConnectionService } from '../../../common/azure/azure.service';

/**
 * Service for querying dependency graphs from Memgraph
 * Handles graph queries, dependency trees, and risk calculations
 */
@Injectable()
export class SbomGraphService {
  private readonly logger = new Logger(SbomGraphService.name);
  
  private get driver() {
    return this.connectionService.getMemgraph();
  }

  constructor(
    private readonly sbomRepo: SbomRepository,
    private readonly connectionService: ConnectionService,
  ) {}

  /**
   * Get dependencies of a package
   */
  async getDependencies(pkgName: string) {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `
        MATCH (p:Package {name: $name})-[:DEPENDS_ON*]->(d)
        RETURN DISTINCT d.name AS name, d.version AS version
        `,
        { name: pkgName }
      );
      return result.records.map(r => ({
        name: r.get("name"),
        version: r.get("version"),
      }));
    } finally {
      await session.close();
    }
  }

  /**
   * Get full dependency tree recursively from Memgraph
   */
  async getFullDependencyTree(sbomId: string) {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `
        MATCH (s:SBOM {id: $sbomId})
        MATCH (s)<-[:BELONGS_TO]-(p:Package)
        OPTIONAL MATCH path = (p)-[:DEPENDS_ON*0..]->(dep:Package)
        RETURN p, dep, relationships(path) as rels
        `,
        { sbomId }
      );

      const components = [];
      const componentMap = new Map();
      const dependencyMap = new Map();

      for (const record of result.records) {
        const pkg = record.get('p');
        const dep = record.get('dep');
        
        if (pkg) {
          const purl = pkg.properties.purl;
          if (!componentMap.has(purl)) {
            const component = {
              type: pkg.properties.type || 'library',
              name: pkg.properties.name,
              version: pkg.properties.version,
              purl: purl,
              scope: pkg.properties.scope || 'required',
              'bom-ref': pkg.properties.bom_ref || purl,
              license: pkg.properties.license ? [{ license: { id: pkg.properties.license } }] : [],
              hashes: pkg.properties.hashes || [],
            };
            components.push(component);
            componentMap.set(purl, component);
          }
        }

        if (pkg && dep && pkg.properties.purl !== dep.properties.purl) {
          const fromPurl = pkg.properties.purl;
          const toPurl = dep.properties.purl;
          
          if (!dependencyMap.has(fromPurl)) {
            dependencyMap.set(fromPurl, new Set());
          }
          dependencyMap.get(fromPurl).add(toPurl);
        }
      }

      const dependencies = [];
      for (const [fromRef, toRefs] of dependencyMap) {
        dependencies.push({
          ref: fromRef,
          dependsOn: Array.from(toRefs),
        });
      }

      return {
        components,
        dependencies,
      };
    } catch (error) {
      this.logger.error(`Error getting full dependency tree from Memgraph for ${sbomId}:`, error);
      return null;
    } finally {
      await session.close();
    }
  }

  /**
   * Find version conflicts in the graph
   */
  async findVersionConflicts() {
    const session = this.driver.session();
    try {
      const result = await session.run(`
        MATCH (p:Package)-[:BELONGS_TO]->(s:SBOM)
        WITH p.name AS name, COLLECT(DISTINCT p.version) AS versions
        WHERE size(versions) > 1
        RETURN name, versions
      `);
      return result.records.map(r => ({
        name: r.get("name"),
        versions: r.get("versions"),
      }));
    } finally {
      await session.close();
    }
  }

  /**
   * Get risk score for a package from the database
   */
  async calculatePackageRiskScore(packageName: string): Promise<number> {
    const riskScore = await this.sbomRepo.getPackageRiskScore(packageName);
    if (riskScore !== null && riskScore !== undefined) {
      return riskScore;
    }
    return 50; // Default fallback
  }

  /**
   * Check if risk score matches the risk filter
   */
  matchesRiskFilter(riskScore: number, filter: 'all' | 'low' | 'medium' | 'high'): boolean {
    if (filter === 'all') return true;
    if (filter === 'high') return riskScore >= 30;
    if (filter === 'medium') return riskScore >= 10 && riskScore < 30;
    if (filter === 'low') return riskScore >= 0 && riskScore < 10;
    return true;
  }

  /**
   * Get dependency graph for a package by package_id
   */
  async getPackageDependencyGraph(packageId: string) {
    const session = this.driver.session();
    try {
      const packageInfo = await this.sbomRepo.getPackageById(packageId);
      if (!packageInfo) {
        return { error: 'Package not found' };
      }

      const packageName = packageInfo.package_name;

      const result = await session.run(
        `
        MATCH (p:Package {name: $packageName})
        OPTIONAL MATCH path = (p)-[:DEPENDS_ON*0..]->(dep:Package)
        WITH p, dep, relationships(path) as rels
        RETURN DISTINCT p, dep
        `,
        { packageName }
      );

      const nodes = new Map<string, any>();
      const edges: Array<{ from: string; to: string }> = [];

      for (const record of result.records) {
        const pkg = record.get('p');
        const dep = record.get('dep');

        if (pkg) {
          const purl = pkg.properties.purl || `${pkg.properties.name}@${pkg.properties.version}`;
          if (!nodes.has(purl)) {
            nodes.set(purl, {
              id: purl,
              name: pkg.properties.name,
              version: pkg.properties.version,
              type: pkg.properties.type || 'library',
              license: pkg.properties.license || null,
            });
          }
        }

        if (dep && pkg) {
          const fromPurl = pkg.properties.purl || `${pkg.properties.name}@${pkg.properties.version}`;
          const toPurl = dep.properties.purl || `${dep.properties.name}@${dep.properties.version}`;

          if (!nodes.has(toPurl)) {
            nodes.set(toPurl, {
              id: toPurl,
              name: dep.properties.name,
              version: dep.properties.version,
              type: dep.properties.type || 'library',
              license: dep.properties.license || null,
            });
          }

          const edgeExists = edges.some(
            (e) => e.from === fromPurl && e.to === toPurl,
          );
          if (!edgeExists && fromPurl !== toPurl) {
            edges.push({ from: fromPurl, to: toPurl });
          }
        }
      }

      return {
        package: {
          id: packageId,
          name: packageName,
        },
        nodes: Array.from(nodes.values()),
        edges: edges,
      };
    } catch (error) {
      this.logger.error(`Error getting dependency graph for package ${packageId}:`, error);
      return { error: 'Failed to get dependency graph' };
    } finally {
      await session.close();
    }
  }

  /**
   * Get dependency graph for a package by name and version
   */
  async getPackageDependencyGraphByName(
    packageName: string,
    version?: string,
  ) {
    const session = this.driver.session();
    try {
      const query = version
        ? `
        MATCH (p:Package {name: $packageName, version: $version})
        OPTIONAL MATCH path = (p)-[:DEPENDS_ON*0..]->(dep:Package)
        WITH p, dep, relationships(path) as rels
        RETURN DISTINCT p, dep
        `
        : `
        MATCH (p:Package {name: $packageName})
        OPTIONAL MATCH path = (p)-[:DEPENDS_ON*0..]->(dep:Package)
        WITH p, dep, relationships(path) as rels
        RETURN DISTINCT p, dep
        ORDER BY p.version DESC
        LIMIT 1
        `;

      const params = version
        ? { packageName, version }
        : { packageName };

      const result = await session.run(query, params);

      const nodes = new Map<string, any>();
      const edges: Array<{ from: string; to: string }> = [];

      for (const record of result.records) {
        const pkg = record.get('p');
        const dep = record.get('dep');

        if (pkg) {
          const purl = pkg.properties.purl || `${pkg.properties.name}@${pkg.properties.version}`;
          if (!nodes.has(purl)) {
            nodes.set(purl, {
              id: purl,
              name: pkg.properties.name,
              version: pkg.properties.version,
              type: pkg.properties.type || 'library',
              license: pkg.properties.license || null,
            });
          }
        }

        if (dep && pkg) {
          const fromPurl = pkg.properties.purl || `${pkg.properties.name}@${pkg.properties.version}`;
          const toPurl = dep.properties.purl || `${dep.properties.name}@${dep.properties.version}`;

          if (!nodes.has(toPurl)) {
            nodes.set(toPurl, {
              id: toPurl,
              name: dep.properties.name,
              version: dep.properties.version,
              type: dep.properties.type || 'library',
              license: dep.properties.license || null,
            });
          }

          const edgeExists = edges.some(
            (e) => e.from === fromPurl && e.to === toPurl,
          );
          if (!edgeExists && fromPurl !== toPurl) {
            edges.push({ from: fromPurl, to: toPurl });
          }
        }
      }

      return {
        package: {
          name: packageName,
          version: version || (result.records[0]?.get('p')?.properties?.version || null),
        },
        nodes: Array.from(nodes.values()),
        edges: edges,
      };
    } catch (error) {
      this.logger.error(
        `Error getting dependency graph for package ${packageName}${version ? `@${version}` : ''}:`,
        error,
      );
      return { error: 'Failed to get dependency graph' };
    } finally {
      await session.close();
    }
  }

  /**
   * Get filtered dependency graph for a package formatted for frontend visualization
   * Returns direct dependencies with their transitive children, filtered by query, scope, and risk
   */
  async getFilteredPackageDependencyGraph(
    packageIdOrName: string,
    version?: string,
    options?: {
      query?: string;
      scope?: 'direct' | 'all';
      risk?: 'all' | 'low' | 'medium' | 'high';
    },
  ) {
    const session = this.driver.session();
    try {
      // Try to get package info by ID first
      let packageInfo = await this.sbomRepo.getPackageById(packageIdOrName);
      let packageId: string | null = null;
      let packageName: string | null = null;
      
      if (!packageInfo) {
        const packageByName = await this.sbomRepo.findPackageByName(packageIdOrName);
        if (packageByName) {
          packageInfo = await this.sbomRepo.getPackageById(packageByName.id);
        }
      }
      
      if (packageInfo) {
        packageId = packageInfo.package_id;
        packageName = packageInfo.package_name;
      } else {
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(packageIdOrName);
        if (isUUID) {
          packageId = packageIdOrName;
        } else {
          packageName = packageIdOrName;
        }
      }

      const query = options?.query?.toLowerCase() || '';
      const scope = options?.scope || 'all';
      const riskFilter = options?.risk || 'all';
      const directLimit = 100000;
      const transitiveLimit = 100000;

      // Query Memgraph for DIRECT dependencies
      let directDepsResult;
      
      if (packageName) {
        directDepsResult = await session.run(
          version
            ? `
            MATCH (p:Package {name: $packageName, version: $version})-[:DEPENDS_ON]->(direct:Package)
            WHERE NOT (p)-[:DEPENDS_ON*2..]->(direct)
            RETURN DISTINCT direct.name AS name, direct.version AS version
            ORDER BY direct.name
            LIMIT ${directLimit}
            `
            : `
            MATCH (p:Package {name: $packageName})-[:DEPENDS_ON]->(direct:Package)
            WHERE NOT (p)-[:DEPENDS_ON*2..]->(direct)
            RETURN DISTINCT direct.name AS name, direct.version AS version
            ORDER BY direct.name
            LIMIT ${directLimit}
            `,
          version ? { packageName, version } : { packageName },
        );
      } else if (packageId) {
        directDepsResult = await session.run(
          `
          MATCH (p:Package {db_package_id: $packageId})-[:DEPENDS_ON]->(direct:Package)
          WHERE NOT (p)-[:DEPENDS_ON*2..]->(direct)
          RETURN DISTINCT direct.name AS name, direct.version AS version
          ORDER BY direct.name
          LIMIT ${directLimit}
          `,
          { packageId },
        );
      }

      if (!directDepsResult || directDepsResult.records.length === 0) {
        return { directDependencies: [] };
      }

      const directDependencies: Array<{
        id: string;
        label: string;
        version?: string;
        riskScore: number;
        children: Array<{ id: string; label: string; version?: string; riskScore: number }>;
      }> = [];

      for (const record of directDepsResult.records) {
        const depName = record.get('name');
        const depVersion = record.get('version');

        const directRiskScore = await this.calculatePackageRiskScore(depName);
        
        if (query && scope === 'direct' && !depName.toLowerCase().includes(query)) {
          continue;
        }

        if (!this.matchesRiskFilter(directRiskScore, riskFilter)) {
          if (scope === 'all' && query) {
            const transitiveCheckResult = await session.run(
              `
              MATCH (direct:Package {name: $depName})-[:DEPENDS_ON*1..]->(transitive:Package)
              WHERE toLower(transitive.name) CONTAINS toLower($query)
              RETURN COUNT(transitive) AS count
              LIMIT 1
              `,
              { depName, query }
            );
            
            if (transitiveCheckResult.records.length === 0 || transitiveCheckResult.records[0].get('count') === 0) {
              continue;
            }
          } else {
            continue;
          }
        }

        // Get transitive dependencies
        const transitiveResult = await session.run(
          `
          MATCH (direct:Package {name: $depName})-[:DEPENDS_ON*1..]->(transitive:Package)
          RETURN DISTINCT transitive.name AS name, transitive.version AS version
          ORDER BY transitive.name
          LIMIT ${transitiveLimit}
          `,
          { depName },
        );

        const children: Array<{ id: string; label: string; version?: string; riskScore: number }> = [];

        for (const transRecord of transitiveResult.records) {
          const transName = transRecord.get('name');
          const transVersion = transRecord.get('version');

          if (query && scope === 'all' && !transName.toLowerCase().includes(query)) {
            continue;
          }

          const riskScore = await this.calculatePackageRiskScore(transName);

          if (this.matchesRiskFilter(riskScore, riskFilter)) {
            children.push({
              id: transName,
              label: transName,
              version: transVersion || undefined,
              riskScore,
            });
          }
        }

        if (this.matchesRiskFilter(directRiskScore, riskFilter) || (scope === 'all' && children.length > 0)) {
          const sortedChildren = children.sort((a, b) => b.riskScore - a.riskScore);

          directDependencies.push({
            id: depName,
            label: depName,
            version: depVersion || undefined,
            riskScore: directRiskScore,
            children: sortedChildren,
          });
        }
      }

      const sortedDeps = directDependencies.sort((a, b) => b.riskScore - a.riskScore);
      return {
        directDependencies: sortedDeps,
      };
    } catch (error) {
      this.logger.error(`Error getting filtered dependency graph for package ${packageIdOrName}:`, error);
      return { directDependencies: [] };
    } finally {
      await session.close();
    }
  }
}
