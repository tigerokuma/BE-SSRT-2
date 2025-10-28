import { Injectable } from "@nestjs/common";
import neo4j from "neo4j-driver";
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
  async getWatchSbom(watchlistId: string) {
    try {
      // Get all packages and dependencies for this watchlist
      const result = await this.session.run(
        `
        MATCH (s:SBOM {id: $watchlistId})
        MATCH (s)<-[:BELONGS_TO]-(p:Package)
        OPTIONAL MATCH (p)-[:DEPENDS_ON]->(dep:Package)
        RETURN p, dep
        `,
        { watchlistId }
      );

      const components = [];
      const dependencies = [];
      const componentMap = new Map();

      // Process all packages (components)
      for (const record of result.records) {
        const pkg = record.get('p');
        const dep = record.get('dep');
        
        if (pkg && !componentMap.has(pkg.properties.purl)) {
          const component = {
            name: pkg.properties.name,
            version: pkg.properties.version,
            purl: pkg.properties.purl,
            type: pkg.properties.type || 'library',
            scope: pkg.properties.scope || '',
            'bom-ref': pkg.properties.bom_ref || pkg.properties.purl,
            licenses: pkg.properties.license ? [{ license: { id: pkg.properties.license } }] : [],
            hashes: pkg.properties.hashes ? this.parseHashes(pkg.properties.hashes) : []
          };
          
          components.push(component);
          componentMap.set(pkg.properties.purl, component);
        }
      }

      // Build dependencies structure
      const dependencyMap = new Map();
      for (const record of result.records) {
        const pkg = record.get('p');
        const dep = record.get('dep');
        
        if (pkg && dep) {
          const fromPurl = pkg.properties.purl;
          const toPurl = dep.properties.purl;
          
          if (!dependencyMap.has(fromPurl)) {
            dependencyMap.set(fromPurl, []);
          }
          dependencyMap.get(fromPurl).push(toPurl);
        }
      }

      // Convert dependency map to CycloneDX format
      for (const [fromRef, toRefs] of dependencyMap) {
        dependencies.push({
          ref: fromRef,
          dependsOn: toRefs
        });
      }

      // Create CycloneDX format
      const sbomData = {
        bomFormat: 'CycloneDX',
        specVersion: '1.5',
        version: 1,
        metadata: {
          component: {
            type: 'application',
            name: `watchlist-${watchlistId}`,
            version: '1.0.0',
            'bom-ref': `pkg:watchlist/${watchlistId}@1.0.0`
          }
        },
        components,
        dependencies
      };

      return { sbom: sbomData };
    } catch (error) {
      console.error(`Error getting watchlist SBOM from Memgraph:`, error);
      return { sbom: null };
    }
  }

  // --- Helper method to parse hashes ---
  private parseHashes(hashes: any[]): any[] {
    if (!Array.isArray(hashes)) return [];
    return hashes.map(hash => ({
      alg: 'SHA-256', // Default algorithm
      content: hash
    }));
  }
}