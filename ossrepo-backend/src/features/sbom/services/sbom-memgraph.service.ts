import { Injectable, Logger, Inject, forwardRef, Optional } from '@nestjs/common';
import neo4j from 'neo4j-driver';
import { SbomRepository } from '../repositories/sbom.repository';
import { ConnectionService } from '../../../common/azure/azure.service';
import { DependencyQueueService } from '../../dependencies/services/dependency-queue.service';

/**
 * Service for Memgraph CRUD operations
 * Handles creating SBOM nodes, packages, and relationships in Memgraph
 */
@Injectable()
export class SbomMemgraphService {
  private readonly logger = new Logger(SbomMemgraphService.name);
  
  private get driver() {
    return this.connectionService.getMemgraph();
  }

  constructor(
    private readonly sbomRepo: SbomRepository,
    private readonly connectionService: ConnectionService,
    @Optional() @Inject(forwardRef(() => DependencyQueueService))
    private readonly dependencyQueueService?: DependencyQueueService,
  ) {}

  /**
   * Create SBOM node in Memgraph
   */
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
      let purl: string | null = null;
      if (metadata?.component) {
        purl = metadata.component.purl || metadata.component['bom-ref'] || null;
      }
      
      // Ensure metadata is null if undefined (Memgraph doesn't accept undefined)
      const metadataValue = metadata ?? null;
      
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
        { id, source, tool, metadata: metadataValue, purl, packageName: packageName || null, version: version || null }
      );
    } finally {
      await session.close();
    }
  }

  /**
   * Add Package node to Memgraph
   */
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

  /**
   * Link Package to SBOM
   */
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

  /**
   * Add dependency relationship between packages
   */
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

  /**
   * Extract package name from PURL
   */
  private extractNameFromPurl(purl: string): string {
    const match = purl.match(/^pkg:\w+\/[^@\/]+\/([^@\/]+)/) || purl.match(/^pkg:\w+\/([^@\/]+)/);
    return match ? match[1] : purl;
  }

  /**
   * Get repository URL from NPM registry
   */
  async getRepoUrlFromNpm(packageName: string): Promise<string | null> {
    try {
      // Skip packages that are clearly not NPM packages (e.g., internal packages with __)
      if (packageName.includes('__') || packageName.startsWith('resolver-binding-') || packageName.startsWith('wasm-')) {
        return null;
      }

      // Handle scoped packages (e.g., @babel/traverse -> @babel%2Ftraverse)
      const encodedPackageName = packageName.replace('/', '%2F');
      
      const res = await fetch(`https://registry.npmjs.org/${encodedPackageName}`);

      if (!res.ok) {
        // 404 is expected for packages that don't exist in NPM - don't log warnings
        // Only log for unexpected errors (5xx, network errors, etc.)
        if (res.status !== 404) {
          this.logger.debug(`Failed to fetch metadata for ${packageName}: ${res.status}`);
        }
        return null;
      }

      const data = await res.json();
      const repoUrl = data?.repository?.url;

      if (!repoUrl) return null;

      return this.normalizeRepoUrl(repoUrl);
    } catch (err) {
      // Silently handle errors - these are expected for packages not in NPM
      return null;
    }
  }

  /**
   * Normalize repository URL
   */
  private normalizeRepoUrl(repo: string): string | null {
    if (!repo) return null;

    let url = repo.trim();
    url = url.replace(/^git\+/, '');
    url = url.replace(/^git:\/\//, 'https://');
    url = url.replace(/^git@([^:]+):/, 'https://$1/');
    url = url.replace(/\.git$/, '');
    url = url.replace(/\/+$/, '');
    url = url.replace(/([^:]\/)\/+/g, '$1');

    return url;
  }

  /**
   * Import CycloneDX SBOM into Memgraph
   */
  async importCycloneDxSbom(sbomJson: any, sbomId: string) {
    this.logger.log(`Importing SBOM components and dependencies`);
    
    // Try to get projectId from SBOM metadata, or try to find it from package
    let projectId = sbomJson.metadata?.properties?.find(
      (prop: any) => prop.name === 'deply:project:id'
    )?.value;
    
    // If not in metadata, try to find project from package dependencies
    // Note: For package-level SBOMs, we may not have a projectId
    // In that case, we'll use sbomId as fallback but tasks may not be created
    if (!projectId) {
      this.logger.log(`No projectId found in SBOM metadata, using sbomId as fallback: ${sbomId}`);
      projectId = sbomId;
    }
    
    // Create root package node
    const rootComponent = sbomJson.metadata?.component;
    if (rootComponent) {
      const rootPurl = rootComponent.purl || rootComponent['bom-ref'] || `${rootComponent.name}@${rootComponent.version || ''}`;
      const rootPackageName = rootComponent.name;
      const rootVersion = rootComponent.version || '';
      const rootLicense = rootComponent.licenses?.[0]?.license?.id || rootComponent.licenses?.[0]?.license?.name || null;
      
      let existingPackage = null;
      try {
        existingPackage = await this.sbomRepo.getPackageById(sbomId);
        if (!existingPackage) {
          existingPackage = await this.sbomRepo.findPackageByName(rootPackageName);
        }
      } catch (error) {
        this.logger.error(`Error checking for existing package ${rootPackageName}:`, error);
      }
      
      const rootDbPackageId = sbomId;
      
      const session = this.driver.session();
      try {
        await session.run(
          `
          MERGE (p:Package {purl: $purl})
          SET p.name = $name,
              p.version = $version,
              p.license = $license,
              p.type = $type,
              p.bom_ref = $bom_ref,
              p.db_package_id = $db_package_id
          WITH p
          MATCH (s:SBOM {id: $sbomId})
          MERGE (p)-[:BELONGS_TO]->(s)
          `,
          {
            purl: rootPurl,
            name: rootPackageName,
            version: rootVersion,
            license: rootLicense,
            type: rootComponent.type || 'application',
            bom_ref: rootComponent['bom-ref'] || rootPurl,
            db_package_id: rootDbPackageId,
            sbomId
          }
        );
        this.logger.log(`✅ Created root package node: ${rootPackageName}@${rootVersion} with db_package_id: ${rootDbPackageId}`);
      } catch (error) {
        this.logger.error(`❌ Error creating root package node:`, error);
      } finally {
        await session.close();
      }
    } else {
      this.logger.warn(`⚠️ No root component found in SBOM metadata for ${sbomId}, creating fallback root package`);
      
      let packageName = sbomId;
      let packageVersion = '';
      
      // Try to get package name and version from the SBOM node in Memgraph first
      // (these were stored when createSbom was called)
      const session = this.driver.session();
      try {
        const sbomResult = await session.run(
          `MATCH (s:SBOM {id: $sbomId}) RETURN s.package_name AS package_name, s.version AS version`,
          { sbomId }
        );
        
        if (sbomResult.records.length > 0) {
          const record = sbomResult.records[0];
          const sbomPackageName = record.get('package_name');
          const sbomVersion = record.get('version');
          
          if (sbomPackageName) {
            packageName = sbomPackageName;
          }
          if (sbomVersion) {
            packageVersion = sbomVersion;
          }
        }
      } catch (error) {
        this.logger.warn(`Could not get package info from SBOM node: ${error}`);
      }
      
      // Fallback to database if not found in SBOM node
      if (packageName === sbomId || !packageVersion) {
        try {
          const existingPackage = await this.sbomRepo.getPackageById(sbomId);
          if (existingPackage) {
            if (packageName === sbomId) {
              packageName = existingPackage.package_name || sbomId;
            }
            if (!packageVersion) {
              packageVersion = (existingPackage as any).version || '';
            }
          }
        } catch (error) {
          this.logger.error(`Error checking for existing package ${sbomId}:`, error);
        }
      }
      
      // Use npm PURL format for npm packages, generic for others
      const isNpmPackage = packageName.includes('@') || packageName.includes('/');
      const fallbackPurl = isNpmPackage 
        ? (packageVersion ? `pkg:npm/${packageName}@${packageVersion}` : `pkg:npm/${packageName}`)
        : (packageVersion ? `pkg:generic/${packageName}@${packageVersion}` : `pkg:generic/${packageName}`);
      const rootDbPackageId = sbomId;
      
      try {
        await session.run(
          `
          MERGE (p:Package {purl: $purl})
          SET p.name = $name,
              p.version = $version,
              p.db_package_id = $db_package_id,
              p.type = 'application'
          WITH p
          MATCH (s:SBOM {id: $sbomId})
          MERGE (p)-[:BELONGS_TO]->(s)
          `,
          {
            purl: fallbackPurl,
            name: packageName,
            version: packageVersion,
            db_package_id: rootDbPackageId,
            sbomId
          }
        );
        const versionStr = packageVersion ? `@${packageVersion}` : '';
        this.logger.log(`✅ Created fallback root package node: ${packageName}${versionStr} with db_package_id: ${rootDbPackageId}`);
      } catch (error) {
        this.logger.error(`❌ Error creating fallback root package node:`, error);
      } finally {
        await session.close();
      }
    }
    
    // Batch create all components
    const components = sbomJson.components || [];
    if (components.length > 0) {
      const componentPromises = components.map(async (c) => {
        const purl = c.purl || c['bom-ref'] || `${c.name}@${c.version || ''}`;
        const packageName = c.name;
        
        const purlName = this.extractNameFromPurl(purl);
        const finalPackageName = purlName || packageName;
        const license = c.licenses?.[0]?.license?.id || c.licenses?.[0]?.license?.name || null;
        const repoUrl = await this.getRepoUrlFromNpm(finalPackageName);
        
        let existingPackage = null;
        try {
          existingPackage = await this.sbomRepo.findPackageByName(finalPackageName);
        } catch (error) {
          this.logger.error(`Error checking for existing package ${finalPackageName}:`, error);
        }
        this.sbomRepo.upsertPackage(finalPackageName, repoUrl, license);
        
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

      const componentData = await Promise.all(componentPromises);

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
        this.logger.log(`Batch created ${components.length} package nodes with PostgreSQL links`);
      } catch (error) {
        this.logger.error(`Error batch creating package nodes:`, error);
      } finally {
        await session.close();
      }
    }

    // Batch create all dependencies and collect dependency packages for task creation
    const dependencies = [];
    const dependencyPackages = new Map<string, { name: string; version?: string; repoUrl?: string }>();
    
    for (const dep of (sbomJson.dependencies || [])) {
      const fromRef = dep.ref;
      for (const toRef of (dep.dependsOn || [])) {
        dependencies.push({ from: fromRef, to: toRef });
        
        // Find the component for the dependency to get its details
        const depComponent = sbomJson.components?.find((c: any) => {
          const compRef = c.purl || c['bom-ref'] || `${c.name}@${c.version || ''}`;
          return compRef === toRef;
        });
        
        if (depComponent) {
          const depName = depComponent.name;
          const depVersion = depComponent.version;
          const depPurl = depComponent.purl || depComponent['bom-ref'] || `${depName}@${depVersion || ''}`;
          const purlName = this.extractNameFromPurl(depPurl);
          const finalDepName = purlName || depName;
          
          // Only add if not already in map (avoid duplicates)
          if (!dependencyPackages.has(finalDepName)) {
            const repoUrl = await this.getRepoUrlFromNpm(finalDepName);
            dependencyPackages.set(finalDepName, {
              name: finalDepName,
              version: depVersion,
              repoUrl: repoUrl || undefined,
            });
          }
        }
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
        this.logger.log(`Batch created ${dependencies.length} dependency relationships`);
      } catch (error) {
        this.logger.error(`Error batch creating dependencies:`, error);
      } finally {
        await session.close();
      }
    }
    
    // Create dependency tasks for each dependency found in SBOM
    if (this.dependencyQueueService && dependencyPackages.size > 0) {
      this.logger.log(`Creating dependency tasks for ${dependencyPackages.size} dependencies found in SBOM`);
      
      for (const [depName, depInfo] of dependencyPackages.entries()) {
        try {
          // Check if package exists in database
          const existingPackage = await this.sbomRepo.findPackageByName(depName);
          
          if (existingPackage) {
            // Package exists, queue full setup task
            await this.dependencyQueueService.queueFullSetup({
              packageId: existingPackage.id,
              packageName: depName,
              repoUrl: depInfo.repoUrl,
              projectId: projectId,
            });
            this.logger.log(`Queued full setup task for existing dependency: ${depName}`);
          } else {
            // Package doesn't exist, we need to create it first or queue fast setup
            // For now, we'll just log it - the package will be created when needed
            this.logger.log(`Dependency ${depName} not found in database, skipping task creation`);
          }
        } catch (error) {
          this.logger.error(`Error creating dependency task for ${depName}:`, error);
        }
      }
    }
    
    this.logger.log(`Importing SBOM components and dependencies completed`);
  }
}

