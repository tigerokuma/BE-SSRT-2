import { Injectable } from "@nestjs/common";
import neo4j from "neo4j-driver";
import { v4 as uuidv4 } from 'uuid';
import { SbomRepository } from "../repositories/sbom.repository";
import { DependencyQueueService } from "../../dependencies/services/dependency-queue.service";
import { ConnectionService } from "../../../common/azure/azure.service";

@Injectable()
export class SbomMemgraph {
  private get driver() {
    return this.connectionService.getMemgraph();
  }

  constructor(
    private readonly sbomRepo: SbomRepository,
    private readonly dependencyQueueService: DependencyQueueService,
    private readonly connectionService: ConnectionService,
  ) {}

  async close() {
    // Don't close the shared connection - it's managed by ConnectionService
  }

  // --- Helper function to extract package name from PURL ---
  private extractNameFromPurl(purl: string): string {
    // PURL format: pkg:type/namespace/name@version
    const match = purl.match(/^pkg:\w+\/[^@\/]+\/([^@\/]+)/) || purl.match(/^pkg:\w+\/([^@\/]+)/);
    return match ? match[1] : purl;
  }


  // --- Create SBOM Node ---
  async createSbom(
    id: string,
    source: string,
    tool: string,
    metadata?: any,
    packageName?: string,
    version?: string,
  ) {
    const session = this.driver.session();
    try {
      // Extract purl from metadata.component if available
      let purl: string | null = null;
      if (metadata?.component) {
        purl = metadata.component.purl || metadata.component['bom-ref'] || null;
      }
      
      await session.run(
        `
        MERGE (s:SBOM {id: $id})
        SET s.source = $source,
            s.tool = $tool,
            s.created_at = timestamp(),
            s.metadata = $metadata,
            s.purl = $purl,
            s.package_name = $packageName,
            s.version = $version
        `,
        { id, source, tool, metadata, purl, packageName: packageName || null, version: version || null }
      );
    } finally {
      await session.close();
    }
  }

  // --- Add Package Node ---
  async addPackage(purl: string, name: string, version: string, license?: string) {
    const session = this.driver.session();
    try {
      await session.run(
        `
        MERGE (p:Package {purl: $purl})
        SET p.name = $name,
            p.version = $version,
            p.license = $license
        `,
        { purl, name, version, license }
      );
    } finally {
      await session.close();
    }
  }

  // --- Link Package → SBOM ---
  async linkPackageToSbom(purl: string, sbomId: string) {
    const session = this.driver.session();
    try {
      await session.run(
        `
        MATCH (p:Package {purl: $purl}), (s:SBOM {id: $sbomId})
        MERGE (p)-[:BELONGS_TO]->(s)
        `,
        { purl, sbomId }
      );
    } finally {
      await session.close();
    }
  }

  // --- Add Dependency Edge ---
  async addDependency(fromPurl: string, toPurl: string) {
    const session = this.driver.session();
    try {
      await session.run(
        `
        MATCH (a:Package {purl: $from}), (b:Package {purl: $to})
        MERGE (a)-[:DEPENDS_ON]->(b)
        `,
        { from: fromPurl, to: toPurl }
      );
    } finally {
      await session.close();
    }
  }

  // --- Query Dependencies of a Package ---
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

  // --- Get Full Dependency Tree Recursively from Memgraph ---
  async getFullDependencyTree(sbomId: string) {
    const session = this.driver.session();
    try {
      // Get all packages and their dependencies recursively from Memgraph
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

      // Process all packages and dependencies
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

        // Build dependency relationships
        if (pkg && dep && pkg.properties.purl !== dep.properties.purl) {
          const fromPurl = pkg.properties.purl;
          const toPurl = dep.properties.purl;
          
          if (!dependencyMap.has(fromPurl)) {
            dependencyMap.set(fromPurl, new Set());
          }
          dependencyMap.get(fromPurl).add(toPurl);
        }
      }

      // Convert dependency map to CycloneDX format
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
      console.error(`Error getting full dependency tree from Memgraph for ${sbomId}:`, error);
      return null;
    } finally {
      await session.close();
    }
  }

  // --- Query Version Conflicts ---
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
      
      // If not found by ID, try to find by name
      if (!packageInfo) {
        const packageByName = await this.sbomRepo.findPackageByName(packageIdOrName);
        if (packageByName) {
          // Found by name, now get full package info
          packageInfo = await this.sbomRepo.getPackageById(packageByName.id);
        }
      }
      
      if (packageInfo) {
        packageId = packageInfo.package_id;
        packageName = packageInfo.package_name;
      } else {
        // If still not found, try using the input as package name directly
        packageName = packageIdOrName;
      }

      const query = options?.query?.toLowerCase() || '';
      const scope = options?.scope || 'all';
      const riskFilter = options?.risk || 'all';

      // STEP 1: Try to find SBOM first (by package ID or package name)
      if (packageId || packageName) {
        let sbomResult;
        if (packageId) {
          // Try to find SBOM by package ID
          sbomResult = await session.run(
            `
            MATCH (s:SBOM {id: $packageId})
            RETURN s.id AS sbomId
            LIMIT 1
            `,
            { packageId }
          );
        }
        
        // If not found by ID, try by package name and version (if provided)
        if ((!sbomResult || sbomResult.records.length === 0) && packageName) {
          if (version) {
            // Try to find SBOM by package name and version
            sbomResult = await session.run(
              `
              MATCH (s:SBOM {package_name: $packageName, version: $version})
              RETURN s.id AS sbomId
              ORDER BY s.created_at DESC
              LIMIT 1
              `,
              { packageName, version }
            );
          }
          
          // If still not found, try by package name only
          if ((!sbomResult || sbomResult.records.length === 0)) {
            sbomResult = await session.run(
              `
              MATCH (s:SBOM {package_name: $packageName})
              RETURN s.id AS sbomId
              ORDER BY s.created_at DESC
              LIMIT 1
              `,
              { packageName }
            );
          }
        }

        // If SBOM found, query dependencies from SBOM
        if (sbomResult && sbomResult.records.length > 0) {
          const sbomId = sbomResult.records[0].get('sbomId');
          console.log(`Found SBOM ${sbomId} for package ${packageName || packageId}, querying from SBOM`);
          
          // Query dependencies from SBOM structure
          // Find the main package in the SBOM, then get its direct dependencies
          // The main package should match the package name or be linked via db_package_id
          let directDepsResult;
          if (packageId) {
            // Try to find by db_package_id first (more specific)
            // Only get DIRECT dependencies (one hop, no transitive)
            // Use a pattern that explicitly excludes any path through intermediate nodes
            const versionCondition = version ? 'AND main.version = $version' : '';
            directDepsResult = await session.run(
              `
              MATCH (s:SBOM {id: $sbomId})<-[:BELONGS_TO]-(main:Package)
              WHERE main.db_package_id = $packageId
              ${versionCondition}
              WITH main, s
              MATCH (main)-[:DEPENDS_ON]->(direct:Package)
              WHERE (direct)-[:BELONGS_TO]->(s)
              AND NOT (main)-[:DEPENDS_ON*2..]->(direct)
              RETURN DISTINCT direct.name AS name, direct.version AS version
              `,
              version ? { sbomId, packageId, version } : { sbomId, packageId }
            );
          }
          
          // If not found by packageId or packageId not available, try by name and version
          // Only get DIRECT dependencies (one hop, no transitive)
          // Use a pattern that explicitly excludes any path through intermediate nodes
          if ((!directDepsResult || directDepsResult.records.length === 0) && packageName) {
            const versionCondition = version ? 'AND main.version = $version' : '';
            directDepsResult = await session.run(
              `
              MATCH (s:SBOM {id: $sbomId})<-[:BELONGS_TO]-(main:Package)
              WHERE main.name = $packageName
              ${versionCondition}
              WITH main, s
              MATCH (main)-[:DEPENDS_ON]->(direct:Package)
              WHERE (direct)-[:BELONGS_TO]->(s)
              AND NOT (main)-[:DEPENDS_ON*2..]->(direct)
              RETURN DISTINCT direct.name AS name, direct.version AS version
              `,
              version ? { sbomId, packageName, version } : { sbomId, packageName }
            );
          }

          if (directDepsResult.records.length > 0) {
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

              // Skip if query doesn't match (when scope is 'direct')
              if (query && scope === 'direct' && !depName.toLowerCase().includes(query)) {
                continue;
              }

              // Get transitive dependencies for this direct dependency from SBOM
              const transitiveResult = await session.run(
                `
                MATCH (s:SBOM {id: $sbomId})<-[:BELONGS_TO]-(direct:Package {name: $depName})
                WITH direct, s
                MATCH (direct)-[:DEPENDS_ON*1..]->(transitive:Package)
                WHERE (transitive)-[:BELONGS_TO]->(s)
                RETURN DISTINCT transitive.name AS name, transitive.version AS version
                ORDER BY transitive.name
                LIMIT 10
                `,
                { depName, sbomId }
              );

              const children: Array<{ id: string; label: string; version?: string; riskScore: number }> = [];

              for (const transRecord of transitiveResult.records) {
                const transName = transRecord.get('name');
                const transVersion = transRecord.get('version');

                // Apply query filter for transitive dependencies when scope is 'all'
                if (query && scope === 'all' && !transName.toLowerCase().includes(query)) {
                  continue;
                }

                // Get risk score from database
                const riskScore = await this.calculatePackageRiskScore(transName);

                // Apply risk filter
                if (this.matchesRiskFilter(riskScore, riskFilter)) {
                  children.push({
                    id: transName,
                    label: transName,
                    version: transVersion || undefined,
                    riskScore,
                  });
                }
              }

              // Get risk score for direct dependency from database
              const directRiskScore = await this.calculatePackageRiskScore(depName);

              // Apply risk filter to direct dependency
              if (this.matchesRiskFilter(directRiskScore, riskFilter)) {
                // Sort children by risk score and limit
                const sortedChildren = children
                  .sort((a, b) => b.riskScore - a.riskScore)
                  .slice(0, 6);

                directDependencies.push({
                  id: depName,
                  label: depName,
                  version: depVersion || undefined,
                  riskScore: directRiskScore,
                  children: sortedChildren,
                });
              }
            }

            // Sort by risk score and limit to top 6
            return {
              directDependencies: directDependencies
                .sort((a, b) => b.riskScore - a.riskScore)
                .slice(0, 6),
            };
          }
        }
      }

      // STEP 2: Fallback to regular Package dependencies if no SBOM found
      console.log(`No SBOM found for package ${packageName || packageIdOrName}, falling back to Package dependencies`);
      
      if (!packageName) {
        packageName = packageIdOrName;
      }

      // Query Memgraph for DIRECT dependencies only (one hop, no transitive)
      // Use a pattern that explicitly excludes any path through intermediate nodes
      // Filter by version if provided
      const directDepsResult = await session.run(
        version
          ? `
          MATCH (p:Package {name: $packageName, version: $version})-[:DEPENDS_ON]->(direct:Package)
          WHERE NOT (p)-[:DEPENDS_ON*2..]->(direct)
          RETURN DISTINCT direct.name AS name, direct.version AS version
          ORDER BY direct.name
          LIMIT 20
          `
          : `
          MATCH (p:Package {name: $packageName})-[:DEPENDS_ON]->(direct:Package)
          WHERE NOT (p)-[:DEPENDS_ON*2..]->(direct)
          RETURN DISTINCT direct.name AS name, direct.version AS version
          ORDER BY direct.name
          LIMIT 20
          `,
        version ? { packageName, version } : { packageName },
      );

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

        // Skip if query doesn't match (when scope is 'direct')
        if (query && scope === 'direct' && !depName.toLowerCase().includes(query)) {
          continue;
        }

        // Get transitive dependencies for this direct dependency
        const transitiveResult = await session.run(
          `
          MATCH (direct:Package {name: $depName})-[:DEPENDS_ON*1..]->(transitive:Package)
          RETURN DISTINCT transitive.name AS name, transitive.version AS version
          ORDER BY transitive.name
          LIMIT 10
          `,
          { depName },
        );

        const children: Array<{ id: string; label: string; version?: string; riskScore: number }> = [];

        for (const transRecord of transitiveResult.records) {
          const transName = transRecord.get('name');
          const transVersion = transRecord.get('version');

          // Apply query filter for transitive dependencies when scope is 'all'
          if (query && scope === 'all' && !transName.toLowerCase().includes(query)) {
            continue;
          }

          // Get risk score from database
          const riskScore = await this.calculatePackageRiskScore(transName);

          // Apply risk filter
          if (this.matchesRiskFilter(riskScore, riskFilter)) {
            children.push({
              id: transName,
              label: transName,
              version: transVersion || undefined,
              riskScore,
            });
          }
        }

        // Get risk score for direct dependency from database
        const directRiskScore = await this.calculatePackageRiskScore(depName);

        // Apply risk filter to direct dependency
        if (this.matchesRiskFilter(directRiskScore, riskFilter)) {
          // Sort children by risk score and limit
          const sortedChildren = children
            .sort((a, b) => b.riskScore - a.riskScore)
            .slice(0, 6);

          directDependencies.push({
            id: depName,
            label: depName,
            version: depVersion || undefined,
            riskScore: directRiskScore,
            children: sortedChildren,
          });
        }
      }

      // Sort by risk score and limit to top 6
      return {
        directDependencies: directDependencies
          .sort((a, b) => b.riskScore - a.riskScore)
          .slice(0, 6),
      };
    } catch (error) {
      console.error(`Error getting filtered dependency graph for package ${packageIdOrName}:`, error);
      return { directDependencies: [] };
    } finally {
      await session.close();
    }
  }

  /**
   * Get risk score for a package from the database
   * Inverts total_score (health score) to risk score (higher = worse)
   */
  private async calculatePackageRiskScore(packageName: string): Promise<number> {
    // Fetch risk score from database (already inverted if from total_score)
    const riskScore = await this.sbomRepo.getPackageRiskScore(packageName);
    
    // If risk score exists in database, use it
    if (riskScore !== null && riskScore !== undefined) {
      return riskScore;
    }
    
    // Fallback: return a default score if not in database
    // This should rarely happen, but provides a default for packages not yet analyzed
    return 50;
  }

  /**
   * Check if risk score matches the risk filter
   * Risk ranges:
   * - low: 0-10
   * - medium: 10-30
   * - high: 30+
   */
  private matchesRiskFilter(riskScore: number, filter: 'all' | 'low' | 'medium' | 'high'): boolean {
    if (filter === 'all') return true;
    if (filter === 'high') return riskScore >= 30;
    if (filter === 'medium') return riskScore >= 10 && riskScore < 30;
    if (filter === 'low') return riskScore >= 0 && riskScore < 10;
    return true;
  }

  /**
   * Get dependency graph for a package by package_id
   * Returns nodes and edges for visualization
   */
  async getPackageDependencyGraph(packageId: string) {
    const session = this.driver.session();
    try {
      // First, get the package name from PostgreSQL (using new Packages table)
      const packageInfo = await this.sbomRepo.getPackageById(packageId);
      if (!packageInfo) {
        return { error: 'Package not found' };
      }

      const packageName = packageInfo.package_name;

      // Query Memgraph for the dependency graph
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

        // Add main package node
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

        // Add dependency node and edge
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

          // Add edge if not already present
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
      console.error(`Error getting dependency graph for package ${packageId}:`, error);
      return { error: 'Failed to get dependency graph' };
    } finally {
      await session.close();
    }
  }

  /**
   * Get dependency graph for a package by name and version
   * Returns nodes and edges for visualization
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

        // Add main package node
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

        // Add dependency node and edge
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

          // Add edge if not already present
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
      console.error(
        `Error getting dependency graph for package ${packageName}${version ? `@${version}` : ''}:`,
        error,
      );
      return { error: 'Failed to get dependency graph' };
    } finally {
      await session.close();
    }
  }


  async getRepoUrlFromNpm(packageName: string): Promise<string | null> {
    try {
      const res = await fetch(`https://registry.npmjs.org/${packageName}`);

      if (!res.ok) {
        console.warn(`Failed to fetch metadata for ${packageName}: ${res.status}`);
        return null;
      }

      const data = await res.json();
      const repoUrl = data?.repository?.url;

      if (!repoUrl) return null;

      return this.normalizeRepoUrl(repoUrl);
    } catch (err) {
      // console.error(`Error fetching metadata for ${packageName}`);
      return null;
    }
  }

  /** Clean / normalize npm repo URL */
  private normalizeRepoUrl(repo: string): string | null {
    if (!repo) return null;

    let url = repo.trim();

    // Remove "git+"
    url = url.replace(/^git\+/, '');

    // Convert "git://" → "https://"
    url = url.replace(/^git:\/\//, 'https://');

    // Convert "git@github.com:" → "https://github.com/"
    url = url.replace(/^git@([^:]+):/, 'https://$1/');

    // Remove trailing ".git"
    url = url.replace(/\.git$/, '');

    // Remove any trailing slashes
    url = url.replace(/\/+$/, '');

    // Fix double slashes (but preserve https://)
    url = url.replace(/([^:]\/)\/+/g, '$1');

    return url;
  }

  // --- Import CycloneDX SBOM (components + dependencies) into Memgraph ---
  async importCycloneDxSbom(sbomJson: any, sbomId: string) {
    console.log(`Importing SBOM components and dependencies`);
    
    // Extract projectId from SBOM metadata if available
    const projectId = sbomJson.metadata?.properties?.find(
      (prop: any) => prop.name === 'deply:project:id'
    )?.value || sbomId; // Fallback to sbomId if projectId not found
    
    // Batch create all components at once
    const components = sbomJson.components || [];
    const queuePromises: Promise<void>[] = [];
    if (components.length > 0) {
      // Process all components in parallel for better performance
      const componentPromises = components.map(async (c) => {
        const purl = c.purl || c['bom-ref'] || `${c.name}@${c.version || ''}`;
        const packageName = c.name;
        
        // Extract package data using helper functions
        const purlName = this.extractNameFromPurl(purl);
        const finalPackageName = purlName || packageName;
        const license = c.licenses?.[0]?.license?.id || c.licenses?.[0]?.license?.name || null;
        const repoUrl = await this.getRepoUrlFromNpm(finalPackageName);
        
        // Check if package already exists (read-only operation)
        let existingPackage = null;
        try {
          existingPackage = await this.sbomRepo.findPackageByName(finalPackageName);
        } catch (error) {
          console.error(`Error checking for existing package ${finalPackageName}:`, error);
        }
        this.sbomRepo.upsertPackage(finalPackageName, repoUrl, license);
        
        // Queue package setup through dependencies module instead of direct database call
        // await queuePromises.push(
        //   this.dependencyQueueService
        //     .queueFastSetup({
        //       packageId: existingPackage?.id, // Use existing package ID if available
        //       packageName: finalPackageName,
        //       repoUrl: repoUrl,
        //       projectId: projectId,
        //     })
        //     .then(() => {
        //       console.log(
        //         `✅ Queued fast setup for package: ${finalPackageName}${
        //           existingPackage ? ' (existing)' : ' (new)'
        //         }`,
        //       );
        //     })
        //     .catch((error) => {
        //       console.error(
        //         `❌ Error queueing fast setup for package ${finalPackageName}:`,
        //         error,
        //       );
        //     }),
        // );
        
        // Use existing package ID if available, otherwise null (will be populated by fast-setup processor)
        const dbPackageId = existingPackage?.id || null;
        
        return {
          purl: purl,
          name: packageName,
          version: c.version || '',
          license: c.licenses?.[0]?.license?.id || c.licenses?.[0]?.license?.name || null,
          scope: c.scope || '',
          type: c.type || '',
          bom_ref: c['bom-ref'] || '',
          hashes: Object.values(c.hashes || {}),
          db_package_id: dbPackageId,
        };
      });

      // Wait for all components to be processed in parallel
      const componentData = await Promise.all(componentPromises);
      // Ensure all queue jobs have been dispatched asynchronously
      await Promise.all(queuePromises);

      const session = this.driver.session();
      try {
        await session.run(
          `
          UNWIND $components AS comp
          MERGE (p:Package {purl: comp.purl})
          SET p.name = comp.name,
              p.version = comp.version,
              p.license = comp.license,
              p.scope = comp.scope,
              p.type = comp.type,
              p.bom_ref = comp.bom_ref,
              p.hashes = comp.hashes,
              p.db_package_id = comp.db_package_id
          WITH p
          MATCH (s:SBOM {id: $sbomId})
          MERGE (p)-[:BELONGS_TO]->(s)
          `,
          { components: componentData, sbomId }
        );
        console.log(`Batch created ${components.length} package nodes with PostgreSQL links`);
      } catch (error) {
        console.error(`Error batch creating package nodes:`, error);
      } finally {
        await session.close();
      }
    }

    // Batch create all dependencies at once
    const dependencies = [];
    for (const dep of (sbomJson.dependencies || [])) {
      const fromRef = dep.ref;
      for (const toRef of (dep.dependsOn || [])) {
        dependencies.push({ from: fromRef, to: toRef });
      }
    }

    if (dependencies.length > 0) {
      const session = this.driver.session();
      try {
        await session.run(
          `
          UNWIND $dependencies AS dep
          MATCH (a:Package {purl: dep.from}), (b:Package {purl: dep.to})
          MERGE (a)-[:DEPENDS_ON]->(b)
          `,
          { dependencies }
        );
        console.log(`Batch created ${dependencies.length} dependency relationships`);
      } catch (error) {
        console.error(`Error batch creating dependencies:`, error);
      } finally {
        await session.close();
      }
    }
    
    console.log(`Importing SBOM components and dependencies completed`);
  }
  // --- Get SBOM data from Memgraph and convert to CycloneDX format ---
  async getCompDeps(watchlistIds) {
    const session = this.driver.session();
    try {
      // Normalize to array
      const ids = Array.isArray(watchlistIds) ? watchlistIds : [watchlistIds];
  
      // Query all SBOMs at once
      const result = await session.run(
        `
        MATCH (s:SBOM)
        WHERE s.id IN $watchlistIds
        MATCH (s)<-[:BELONGS_TO]-(p:Package)
        OPTIONAL MATCH (p)-[:DEPENDS_ON]->(dep:Package)
        RETURN s.id AS sbomId, p, dep
        `,
        { watchlistIds: ids }
      );
  
      const components = [];
      const dependencies = [];
      const componentMap = new Map();   // purl -> component
      const dependencyMap = new Map();  // purl -> Set(depPurls)
  
      // Single pass over all returned records
      for (const record of result.records) {
        const pkg = record.get('p');
        const dep = record.get('dep');
        if (!pkg) continue;
  
        const pkgProps = pkg.properties;
        const purl = pkgProps.purl;
  
        // Add component once
        if (!componentMap.has(purl)) {
          const component = {
            name: pkgProps.name,
            version: pkgProps.version,
            purl,
            type: pkgProps.type || 'library',
            scope: pkgProps.scope || '',
            'bom-ref': pkgProps.bom_ref || purl,
            licenses: pkgProps.license
              ? pkgProps.license
                  .replace(/[()]/g, '') // remove parentheses
                  .split(/\s*(?:AND|OR)\s*/) // split multiple license expressions
                  .map(id => {
                    const trimmed = id.trim();
                    if (/public\s*domain/i.test(trimmed)) {
                      return { license: { name: 'Public Domain' } };
                    }
                    return {
                      license: /^[A-Za-z0-9.\-+]+$/.test(trimmed)
                        ? { id: trimmed }
                        : { name: trimmed },
                    };
                  })
              : [],

            hashes: pkgProps.hashes ? this.parseHashes(pkgProps.hashes) : [],
          };
          components.push(component);
          componentMap.set(purl, component);
        }
  
        // Add dependency relationship if present
        if (dep) {
          const fromPurl = pkgProps.purl;
          const toPurl = dep.properties.purl;
  
          if (!dependencyMap.has(fromPurl)) {
            dependencyMap.set(fromPurl, new Set());
          }
          dependencyMap.get(fromPurl).add(toPurl);
        }
      }
  
      // Convert to CycloneDX dependency array
      for (const [fromRef, toRefs] of dependencyMap) {
        dependencies.push({
          ref: fromRef,
          dependsOn: [...toRefs],
        });
      }
  
      return { components, dependencies };
  
    } catch (error) {
      console.error(`Error getting SBOMs from Memgraph:`, error);
      return { components: [], dependencies: [] };
    } finally {
      await session.close();
    }
  }
  
  async createDependencySbom(packageId: any) {
    try {
      const { components, dependencies } = await this.getCompDeps(packageId);
      const packageInfo = await this.sbomRepo.getPackageInfo(packageId);
      

      const metadata = {
        timestamp: new Date().toISOString(),
        tools: [
          {
            vendor: 'Deply',
            name: 'Deply SBOM Generator',
            version: '1.0.0',
          },
          {
            vendor: 'CycloneDX',
            name: 'CycloneDX',
            version: '1.5',
          },
        ],
        authors: [
          {
            name: 'Deply Platform',
            email: 'support@deply.com',
          },
        ],
        component: {
          type: 'application',
          name: packageInfo?.name || 'Unknown Project',
          ...(packageInfo?.license && { 
            licenses: packageInfo.license
              .replace(/[()]/g, '') // remove parentheses
              .split(/\s*(?:AND|OR)\s*/) // split on AND/OR
              .map(id => {
                const trimmed = id.trim();
                if (/public\s*domain/i.test(trimmed)) {
                  // special case: "Public Domain" → name form, not SPDX id
                  return { license: { name: 'Public Domain' } };
                }
                // choose {id} if it looks like a valid SPDX identifier, otherwise fallback to name
                return {
                  license: /^[A-Za-z0-9\.\-\+]+$/.test(trimmed)
                    ? { id: trimmed }
                    : { name: trimmed }
                };
              })
          }),
        },
        properties: [
          {
            name: 'deply:sbom:type',
            value: 'package',
          },
          {
            name: 'deply:sbom:components',
            value: components.length.toString(),
          },
          ...(packageInfo?.id ? [{
            name: 'deply:project:id',
            value: packageInfo.id,
          }] : []),
          ...(packageInfo?.license ? [{
            name: 'deply:project:license',
            value: packageInfo.license,
          }] : []),
        ],
      };
      
      const sbomData = {
        $schema: 'http://cyclonedx.org/schema/bom-1.5.schema.json',
        bomFormat: 'CycloneDX',
        specVersion: '1.5',
        serialNumber: `urn:uuid:${uuidv4()}`,
        version: 1,
        metadata,
        components,
        dependencies
      };

      return sbomData;
    } catch (error) {
      console.error(`Error creating dependency SBOM:`, error);
      return null;
    }
  }
  async createCustomSbom(options: {
    project_id: string;
    format?: 'cyclonedx' | 'spdx';
    version?: '1.4' | '1.5';
    include_dependencies?: boolean;
    include_watchlist_dependencies?: boolean;
  }) {
    try {
      const projectInfo = await this.sbomRepo.getProjectInfo(options.project_id);
      // 1️⃣ Gather dependencies (and optional watchlist)
      const deps = await this.sbomRepo.getProjectDependencies(options.project_id);

      if (options.include_watchlist_dependencies) {
        deps.push(...await this.sbomRepo.getProjectWatchlist(options.project_id));
      }

      // 2️⃣ Fetch everything in parallel
      const packageIds = deps.map(dep => dep.package_id);

      const results = await this.getCompDeps(packageIds);


      // 3️⃣ Flatten all results
      const allComponents = results.components;
      const allDependencies = results.dependencies;

      // 4️⃣ Deduplicate once at the end (fast!)
      const mergedComponents = Object.values(
        Object.fromEntries(allComponents.map(c => [c.purl, c]))
      );
      const mergedDependencies = Object.values(
        Object.fromEntries(allDependencies.map(d => [d.ref, d]))
      );

      // 5️⃣ Build the final SBOM
      let mergedSbom = this.buildMergedSbomFromComponents(
        mergedComponents,
        mergedDependencies,
        projectInfo
      );  
      
      // Convert to SPDX if requested
      if (options.format === 'spdx') {
        mergedSbom = this.convertToSpdx(mergedSbom, options.version || '1.5');
      }
      
      return mergedSbom;

    } catch (error) {
      console.error(`Error creating custom SBOM:`, error);
      return null;
    }
  }

  private buildMergedSbomFromComponents(components: any[], dependencies: any[], project?: any): any {
    const timestamp = new Date().toISOString();
    const uuid = `urn:uuid:${uuidv4()}`;
    
    // Build comprehensive metadata
    const metadata = {
      timestamp,
      tools: [
        {
          vendor: 'Deply',
          name: 'Deply SBOM Generator',
          version: '1.0.0',
        },
        {
          vendor: 'CycloneDX',
          name: 'CycloneDX',
          version: '1.5',
        },
      ],
      authors: [
        {
          name: 'Deply Platform',
          email: 'support@deply.com',
        },
      ],
      component: {
        type: 'application',
        name: project?.name || 'Unknown Project',
        ...(project?.description && { description: project.description }),
        ...(project?.license && { 
          licenses: project.license
            .replace(/[()]/g, '') // remove parentheses
            .split(/\s*(?:AND|OR)\s*/) // split on AND/OR
            .map(id => {
              const trimmed = id.trim();
              if (/public\s*domain/i.test(trimmed)) {
                // special case: "Public Domain" → name form, not SPDX id
                return { license: { name: 'Public Domain' } };
              }
              // choose {id} if it looks like a valid SPDX identifier, otherwise fallback to name
              return {
                license: /^[A-Za-z0-9\.\-\+]+$/.test(trimmed)
                  ? { id: trimmed }
                  : { name: trimmed }
              };
            })
        }),
      },
      properties: [
        {
          name: 'deply:sbom:type',
          value: 'merged',
        },
        {
          name: 'deply:sbom:components',
          value: components.length.toString(),
        },
        ...(project?.id ? [{
          name: 'deply:project:id',
          value: project.id,
        }] : []),
        ...(project?.license ? [{
          name: 'deply:project:license',
          value: project.license,
        }] : []),
      ],
    };

    // Enrich components
    const enrichedComponents = components.map(comp => this.enrichComponent(comp));

    return {
      $schema: 'http://cyclonedx.org/schema/bom-1.5.schema.json',
      bomFormat: 'CycloneDX',
      specVersion: '1.5',
      serialNumber: uuid,
      version: 1,
      metadata,
      components: enrichedComponents,
      dependencies: dependencies,
    };
  }

  private enrichComponent(component: any): any {
    // Enhance component with CycloneDX standard fields if missing
    return {
      ...component,
      
      // Ensure these core fields exist
      type: component.type || 'library',
      scope: component.scope || 'required',
      
      // Add description if missing
      ...(component.description ? {} : { description: component.name }),
      
      // Ensure bom-ref exists
      'bom-ref': component['bom-ref'] || component.purl || `pkg:generic/${component.name}@${component.version || 'unknown'}`,
      
      // Enhance externalReferences
      externalReferences: this.enrichExternalReferences(component),
      
      // Add properties if they don't exist
      ...(component.properties ? {} : {
        properties: [
          {
            name: 'deply:component:type',
            value: component.type || 'library',
          },
        ],
      }),
      
      // Add hashes if they don't exist (empty array is valid)
      hashes: component.hashes || [],
      
      // Add evidence if not present
      ...(component.evidence ? {} : {
        evidence: {
          licenses: component.licenses || [],
          copyright: [],
        },
      }),
    };
  }

  private enrichExternalReferences(component: any): any[] {
    const refs = component.externalReferences || [];
    
    // Add standard references if missing
    const refMap = new Map();
    
    refs.forEach((ref: any) => {
      refMap.set(ref.type, ref);
    });
    
    // Add vcs reference if we have repo_url in data but not in references
    if (component.repo_url && !refMap.has('vcs') && !refMap.has('repository')) {
      refMap.set('vcs', {
        type: 'vcs',
        url: component.repo_url,
      });
    }
    
    // Add website reference if we have homepage but no website reference
    if (component.homepage && !refMap.has('website')) {
      refMap.set('website', {
        type: 'website',
        url: component.homepage,
      });
    }
    
    // Add distribution reference if we have npm_url or registry info
    if (component.npm_url && !refMap.has('distribution')) {
      refMap.set('distribution', {
        type: 'distribution',
        url: component.npm_url,
      });
    }
    
    return Array.from(refMap.values());
  }

  private excludePackages(sbom: any, packages: string[]): any {
    const packageSet = new Set(packages.map(p => p.toLowerCase()));
    
    return {
      ...sbom,
      components: sbom.components.filter((comp: any) => {
        const name = (comp.name || '').toLowerCase();
        return !packageSet.has(name);
      }),
      dependencies: sbom.dependencies.filter((dep: any) => {
        // Filter out dependencies that reference excluded packages
        return !dep.dependsOn?.some((pkg: string) => 
          packages.some(p => pkg.toLowerCase().includes(p.toLowerCase()))
        );
      }),
    };
  }

  private convertToSpdx(sbom: any, version: string): any {
    const refToSpdxId = new Map(
      sbom.components.map((comp, i) => [comp.bomRef || comp.purl,  `SPDXRef-${i}`])
    );
    const describesRelationship = {
      spdxElementId: 'SPDXRef-DOCUMENT',
      relationshipType: 'DESCRIBES',
      relatedSpdxElement: `SPDXRef-${sbom.metadata?.component?.name}`,
    };
    const rootPackage = {
      name: sbom.metadata?.component?.name || 'deply-cli',
      SPDXID: `SPDXRef-${sbom.metadata?.component?.name}`,
      versionInfo: sbom.metadata?.component?.version || '1.0.0',
      downloadLocation: 'NOASSERTION',
      licenseDeclared: 'NOASSERTION',
      filesAnalyzed: false
    };
  
    
    
    return {
      spdxVersion: 'SPDX-2.3',
      dataLicense: 'CC0-1.0',
      SPDXID: 'SPDXRef-DOCUMENT',
      name: `SBOM-${Date.now()}`,
      documentNamespace: `https://spdx.org/spdxdocs/${Date.now()}`,
      creationInfo: {
        created: new Date().toISOString(),
        creators: 
        [
          'Tool: Deply SBOM Generator',
          'Organization: Deply'
        ],
        licenseListVersion: '3.25'
      },
      packages: [rootPackage, ...sbom.components.map((comp: any, index: number) => ({
        name: comp.name,
        SPDXID: `SPDXRef-${index}`,
        versionInfo: comp.version,
        downloadLocation: 'NOASSERTION',
        licenseDeclared: comp.licenses?.map(l =>
          l.license?.id === 'Public Domain' || l.license?.name === 'Public Domain' 
            ? 'CC0-1.0'
            : l.license?.id || l.license?.name
        ).join(' AND ') || 'NOASSERTION',
        packageVerificationCode: {
          packageVerificationCodeValue: 'NOASSERTION',
        },
      }))],
      relationships:[
        describesRelationship,
        ...sbom.dependencies.flatMap((dep: any) =>
        (dep.dependsOn || []).map((toRef: string) => ({
          spdxElementId: refToSpdxId.get(dep.ref),
          relationshipType: 'DEPENDS_ON',
          relatedSpdxElement: refToSpdxId.get(toRef) || 'NONE',
        }))
      )],
    };
    
  }
  // --- Helper method to parse hashes ---
  private parseHashes(hashes: any[]): any[] {
    if (!Array.isArray(hashes)) return [];
    return hashes.map(hash => ({
      alg: hash.alg || 'SHA-256', // Default algorithm
      content: typeof hash.content === 'string' ? hash.content : String(hash.content),
    }));
  }
}