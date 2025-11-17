import { Injectable } from "@nestjs/common";
import neo4j from "neo4j-driver";
import { v4 as uuidv4 } from 'uuid';
import { SbomRepository } from "../repositories/sbom.repository";

const MEMGRAPH_URI = "bolt://localhost:7687";
const USER = "memgraph";
const PASSWORD = "memgraph";

@Injectable()
export class SbomMemgraph {
  private driver;
  private session;

  constructor(private readonly sbomRepo: SbomRepository) {
    this.driver = neo4j.driver(MEMGRAPH_URI, neo4j.auth.basic(USER, PASSWORD), {
      maxConnectionLifetime: 3 * 60 * 60 * 1000, // 3 hours
      maxConnectionPoolSize: 50,
      connectionAcquisitionTimeout: 2 * 60 * 1000, // 2 minutes
    });
    this.session = this.driver.session();
  }

  async close() {
    await this.session.close();
    await this.driver.close();
  }

  // --- Helper function to extract package name from PURL ---
  private extractNameFromPurl(purl: string): string {
    // PURL format: pkg:type/namespace/name@version
    const match = purl.match(/^pkg:\w+\/[^@\/]+\/([^@\/]+)/) || purl.match(/^pkg:\w+\/([^@\/]+)/);
    return match ? match[1] : purl;
  }


  // --- Create SBOM Node ---
  async createSbom(id: string, source: string, tool: string, metadata?: any) {
    await this.session.run(
      `
      MERGE (s:SBOM {id: $id})
      SET s.source = $source,
          s.tool = $tool,
          s.created_at = timestamp(),
          s.metadata = $metadata
      `,
      { id, source, tool, metadata }
    );
  }

  // --- Add Package Node ---
  async addPackage(purl: string, name: string, version: string, license?: string) {
    await this.session.run(
      `
      MERGE (p:Package {purl: $purl})
      SET p.name = $name,
          p.version = $version,
          p.license = $license
      `,
      { purl, name, version, license }
    );
  }

  // --- Link Package → SBOM ---
  async linkPackageToSbom(purl: string, sbomId: string) {
    await this.session.run(
      `
      MATCH (p:Package {purl: $purl}), (s:SBOM {id: $sbomId})
      MERGE (p)-[:BELONGS_TO]->(s)
      `,
      { purl, sbomId }
    );
  }

  // --- Add Dependency Edge ---
  async addDependency(fromPurl: string, toPurl: string) {
    await this.session.run(
      `
      MATCH (a:Package {purl: $from}), (b:Package {purl: $to})
      MERGE (a)-[:DEPENDS_ON]->(b)
      `,
      { from: fromPurl, to: toPurl }
    );
  }

  // --- Query Dependencies of a Package ---
  async getDependencies(pkgName: string) {
    const result = await this.session.run(
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
  }

  // --- Get Full Dependency Tree Recursively from Memgraph ---
  async getFullDependencyTree(sbomId: string) {
    try {
      // Get all packages and their dependencies recursively from Memgraph
      const result = await this.session.run(
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
    }
  }

  // --- Query Version Conflicts ---
  async findVersionConflicts() {
    const result = await this.session.run(`
      MATCH (p:Package)-[:BELONGS_TO]->(s:SBOM)
      WITH p.name AS name, COLLECT(DISTINCT p.version) AS versions
      WHERE size(versions) > 1
      RETURN name, versions
    `);
    return result.records.map(r => ({
      name: r.get("name"),
      versions: r.get("versions"),
    }));
  }

  /**
   * Get filtered dependency graph for a package formatted for frontend visualization
   * Returns direct dependencies with their transitive children, filtered by query, scope, and risk
   */
  async getFilteredPackageDependencyGraph(
    packageId: string,
    options?: {
      query?: string;
      scope?: 'direct' | 'all';
      risk?: 'all' | 'low' | 'medium' | 'high';
    },
  ) {
    try {
      // Get package info
      const packageInfo = await this.sbomRepo.getPackageById(packageId);
      if (!packageInfo) {
        return { directDependencies: [] };
      }

      const packageName = packageInfo.package_name;
      const query = options?.query?.toLowerCase() || '';
      const scope = options?.scope || 'all';
      const riskFilter = options?.risk || 'all';

      // Query Memgraph for direct dependencies
      const directDepsResult = await this.session.run(
        `
        MATCH (p:Package {name: $packageName})-[:DEPENDS_ON]->(direct:Package)
        RETURN DISTINCT direct.name AS name, direct.version AS version
        ORDER BY direct.name
        LIMIT 20
        `,
        { packageName },
      );

      const directDependencies: Array<{
        id: string;
        label: string;
        riskScore: number;
        children: Array<{ id: string; label: string; riskScore: number }>;
      }> = [];

      for (const record of directDepsResult.records) {
        const depName = record.get('name');
        const depVersion = record.get('version');

        // Skip if query doesn't match (when scope is 'direct')
        if (query && scope === 'direct' && !depName.toLowerCase().includes(query)) {
          continue;
        }

        // Get transitive dependencies for this direct dependency
        const transitiveResult = await this.session.run(
          `
          MATCH (direct:Package {name: $depName})-[:DEPENDS_ON*1..]->(transitive:Package)
          RETURN DISTINCT transitive.name AS name, transitive.version AS version
          ORDER BY transitive.name
          LIMIT 10
          `,
          { depName },
        );

        const children: Array<{ id: string; label: string; riskScore: number }> = [];

        for (const transRecord of transitiveResult.records) {
          const transName = transRecord.get('name');
          const transVersion = transRecord.get('version');

          // Apply query filter for transitive dependencies when scope is 'all'
          if (query && scope === 'all' && !transName.toLowerCase().includes(query)) {
            continue;
          }

          // Calculate risk score (placeholder - you can enhance this with actual risk calculation)
          const riskScore = this.calculatePackageRiskScore(transName);

          // Apply risk filter
          if (this.matchesRiskFilter(riskScore, riskFilter)) {
            children.push({
              id: transName,
              label: transName,
              riskScore,
            });
          }
        }

        // Calculate risk score for direct dependency
        const directRiskScore = this.calculatePackageRiskScore(depName);

        // Apply risk filter to direct dependency
        if (this.matchesRiskFilter(directRiskScore, riskFilter)) {
          // Sort children by risk score and limit
          const sortedChildren = children
            .sort((a, b) => b.riskScore - a.riskScore)
            .slice(0, 6);

          directDependencies.push({
            id: depName,
            label: depName,
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
      console.error(`Error getting filtered dependency graph for package ${packageId}:`, error);
      return { directDependencies: [] };
    }
  }

  /**
   * Calculate risk score for a package (placeholder - enhance with actual risk calculation)
   */
  private calculatePackageRiskScore(packageName: string): number {
    // Placeholder: You can enhance this with actual risk calculation based on:
    // - Vulnerability count
    // - License compliance
    // - Maintenance status
    // - Activity score
    // For now, return a random score between 40-90 for demonstration
    const hash = packageName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return 40 + (hash % 50);
  }

  /**
   * Check if risk score matches the risk filter
   */
  private matchesRiskFilter(riskScore: number, filter: 'all' | 'low' | 'medium' | 'high'): boolean {
    if (filter === 'all') return true;
    if (filter === 'high') return riskScore >= 75;
    if (filter === 'medium') return riskScore >= 60 && riskScore < 75;
    if (filter === 'low') return riskScore < 60;
    return true;
  }

  /**
   * Get dependency graph for a package by package_id
   * Returns nodes and edges for visualization
   */
  async getPackageDependencyGraph(packageId: string) {
    try {
      // First, get the package name from PostgreSQL
      const packageInfo = await this.sbomRepo.getPackageById(packageId);
      if (!packageInfo) {
        return { error: 'Package not found' };
      }

      const packageName = packageInfo.package_name;

      // Query Memgraph for the dependency graph
      const result = await this.session.run(
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

      const result = await this.session.run(query, params);

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
    }
  }

  // --- Import CycloneDX SBOM (components + dependencies) into Memgraph ---
  async importCycloneDxSbom(sbomJson: any, sbomId: string) {
    console.log(`Importing SBOM components and dependencies`);
    
    // Batch create all components at once
    const components = sbomJson.components || [];
    if (components.length > 0) {
      // Process all components in parallel for better performance
      const componentPromises = components.map(async (c) => {
        const purl = c.purl || c['bom-ref'] || `${c.name}@${c.version || ''}`;
        const packageName = c.name;
        
        // Extract package data using helper functions
        const purlName = this.extractNameFromPurl(purl);
        const finalPackageName = purlName || packageName;
        const license = c.licenses?.[0]?.license?.id || c.licenses?.[0]?.license?.name || null;
        
        // Upsert package to PostgreSQL via repository
        const dbPackageId = await this.sbomRepo.upsertPackageFromSbomComponent(
          finalPackageName,
          null, // repoUrl - will be populated from SBOM metadata if available
          license
        );
        
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

      try {
        await this.session.run(
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
      try {
        await this.session.run(
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
      }
    }
    
    console.log(`Importing SBOM components and dependencies completed`);
  }
  // --- Get SBOM data from Memgraph and convert to CycloneDX format ---
  async getCompDeps(watchlistIds) {
    try {
      // Normalize to array
      const ids = Array.isArray(watchlistIds) ? watchlistIds : [watchlistIds];
  
      // Query all SBOMs at once
      const result = await this.session.run(
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