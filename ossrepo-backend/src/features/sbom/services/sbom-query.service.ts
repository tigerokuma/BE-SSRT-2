import { Injectable, Logger } from '@nestjs/common';
import { SbomRepository } from '../repositories/sbom.repository';
import { SbomMemgraph } from './sbom-graph-builder.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

@Injectable()
export class SbomQueryService {
  private readonly logger = new Logger(SbomQueryService.name);

  constructor(
    private readonly sbomRepo: SbomRepository,
    private readonly sbomMemgraph: SbomMemgraph,
    private readonly prisma: PrismaService
  ) {}

  // Fetch SBOM tied to a package
  async getPackageSbom(packageId: string) {
    const sbomData = await this.sbomRepo.getPackageSbom(packageId);
    return sbomData;
  }

  // Fetch SBOM for a project (merged SBOM of all branch dependencies)
  async getProjectSbom(projectId: string) {
    const sbomData = await this.sbomRepo.getProjectSbom(projectId);
    return sbomData;
  }

  // Generate summary stats for the selected sbom
  async getWatchMetadataSbom(sbom: string) {
    const sbomJson = JSON.parse(sbom);
    const components = sbomJson.components || [];

    // Summaries
    const totalComponents = components.length;
    const licenseSummary: Record<string, number> = {};

    const sbomPackage = sbomJson.metadata.component['bom-ref'];
    const rootDep = (sbomJson.dependencies || []).find(
      (dep: any) => dep.ref === sbomPackage,
    );

    const directDependencies = rootDep?.dependsOn?.length || 0;
    const transitiveDependencies = totalComponents - directDependencies;

    // Loop over components
    for (const comp of components) {
      // Count licenses
      const licenseId = comp?.licenses?.[0]?.license?.id || 'Unknown';
      licenseSummary[licenseId] = (licenseSummary[licenseId] || 0) + 1;
    }

    // Prepare license IDs to query SPDX info
    const licenseIds = Object.keys(licenseSummary);

    // Fetch enriched license info from SPDX API
    const enrichedLicenses = await this.getLicenseInfo(licenseIds);

    // Merge counts into enriched licenses
    const licenseDetails = enrichedLicenses.map((lic) => ({
      id: lic.id,
      count: licenseSummary[lic.id] || 0,
      link: lic.link,
      category: lic.category,
    }));

    return {
      sbomPackage,
      directDependencies,
      transitiveDependencies,
      licenseSummary: licenseDetails,
    };
  }

  async getLicenseInfo(licenses: string[]) {
    const spdxUrl =
      'https://raw.githubusercontent.com/spdx/license-list-data/main/json/licenses.json';
    const res = await fetch(spdxUrl);
    const data = await res.json();

    const results = licenses.map((id) => {
      const match = data.licenses.find(
        (l) => l.licenseId.toLowerCase() === id.toLowerCase(),
      );
      if (!match) return { id, link: null, category: null };

      return {
        id: match.licenseId,
        link: match.seeAlso[0] || null,
        category:
          match.licenseCategory ||
          (match.isOsiApproved ? 'Permissive' : 'Other'),
      };
    });

    return results;
  }

  // Get the dependencies that are directly linked to the node
  getNodeDeps(sbomText: string, node_id: string, vulnerablePackages: string[]) {
    const sbomJson = JSON.parse(sbomText);

    const depMap = new Map<string, string[]>(
      sbomJson.dependencies.map((d: any) => [d.ref, d.dependsOn || []]),
    );

    // Get the main node
    const node = sbomJson.dependencies.find((c: any) => c.ref === node_id);
    if (!node) return { nodes: [], links: [] };

    const directDeps = node.dependsOn || [];

    // Recursive check for vulnerability
    const isNodeVulnerable = (
      pkgId: string,
      seen = new Set<string>(),
    ): boolean => {
      if (seen.has(pkgId)) return false;
      seen.add(pkgId);

      // Directly vulnerable
      if (vulnerablePackages.includes(pkgId)) return true;

      // Recurse into dependencies
      const deps = depMap.get(pkgId) || [];
      return deps.some((dep) => isNodeVulnerable(dep, seen));
    };

    // Build nodes: main node + direct dependencies only
    const nodes = [{ id: node.ref, color: 'grey', license: node.license }];
    const links: { source: string; target: string }[] = [];

    for (const dep of directDeps) {
      const isVuln = isNodeVulnerable(dep);
      const copLic = sbomJson.components.find(
        (d: any) => d['bom-ref'] === dep,
      ).licenses;
      let license;
      try {
        license = copLic[0].license.id;
      } catch (e) {
        license = undefined; // fallback if copLic or license is missing
      }

      nodes.push({
        id: dep,
        color: isVuln ? 'red' : 'lightblue',
        license: license,
      });
      links.push({ source: node.ref, target: dep });
    }

    return { nodes, links };
  }

  // Search the node deps
  searchNodeDeps(sbomText: string, search: string) {
    const sbomJson = JSON.parse(sbomText);
    const searchLower = search.toLowerCase();

    // Filter dependencies whose ref or name contains the search string
    const matchedNodes = sbomJson.dependencies.filter((node: any) => {
      const ref = node.ref?.toLowerCase() || '';
      const name = node.name?.toLowerCase() || '';
      return ref.includes(searchLower) || name.includes(searchLower);
    });

    // Sort by ref
    matchedNodes.sort((a: any, b: any) =>
      (a.ref || '').localeCompare(b.ref || '', undefined, {
        sensitivity: 'base',
      }),
    );

    return matchedNodes.map((node: any) => {
      // Find the component in sbomJson.components
      const component = sbomJson.components.find(
        (c: any) => c['bom-ref'] === node.ref,
      );
      const license = component?.licenses?.[0]?.license?.id; // grab the first license ID if exists

      return {
        node: {
          id: node.ref,
          name: node.name,
          license: license, // <-- include the license
          dependsOn: node.dependsOn || [],
        },
      };
    });
  }

  async getDepList(projectId: string) {
    return await this.sbomRepo.getProjectDependencies(projectId);
  }

  // --- Create custom SBOM with options ---
  async createCustomSbom(options: {
    project_id: string;
    format?: 'cyclonedx' | 'spdx';
    version?: '1.4' | '1.5';
    include_dependencies?: boolean;
    include_watchlist_dependencies?: boolean;
    exclude_packages?: string[];
    include_extra_packages?: string[];
  }) {
    // Fetch project information
    const project = await this.prisma.project.findUnique({
      where: { id: options.project_id },
      select: {
        id: true,
        name: true,
        description: true,
        license: true,
      },
    });
    
    // Get all project dependencies
    const dependencies = await this.sbomRepo.getProjectDependencies(options.project_id);
    
    // Fetch full dependency tree from Memgraph recursively
    const allComponents = new Map();
    const allDependencies = new Map();
    
    // Process each top-level dependency to get full tree from Memgraph
    for (const dep of dependencies) {
      const memgraphData = await this.sbomMemgraph.getFullDependencyTree(dep.package_id);
      
      if (memgraphData) {
        // Merge components
        if (memgraphData.components) {
          for (const comp of memgraphData.components) {
            const key = comp.purl || comp['bom-ref'];
            if (!allComponents.has(key)) {
              allComponents.set(key, comp);
            }
          }
        }
        
        // Merge dependencies
        if (memgraphData.dependencies) {
          for (const depRel of memgraphData.dependencies) {
            if (depRel.ref) {
              if (!allDependencies.has(depRel.ref)) {
                allDependencies.set(depRel.ref, depRel);
              } else {
                // Merge dependsOn arrays
                const existing = allDependencies.get(depRel.ref);
                const mergedDependsOn = new Set([
                  ...(existing.dependsOn || []),
                  ...(depRel.dependsOn || []),
                ]);
                allDependencies.set(depRel.ref, {
                  ...existing,
                  dependsOn: Array.from(mergedDependsOn),
                });
              }
            }
          }
        }
      }
    }
    
    // Build the merged SBOM from Memgraph data
    let mergedSbom = this.buildMergedSbomFromComponents(
      Array.from(allComponents.values()),
      Array.from(allDependencies.values()),
      project
    );
    
    // Apply filters
    if (options.exclude_packages && options.exclude_packages.length > 0) {
      mergedSbom = this.excludePackages(mergedSbom, options.exclude_packages);
    }
    
    // Add watchlist dependencies if requested
    if (options.include_watchlist_dependencies) {
      mergedSbom = await this.addWatchlistDependencies(mergedSbom, options.project_id);
    }
    
    // Dependencies are included by default unless explicitly disabled
    // Dependencies will be merged from all SBOMs in mergeSbomData
    
    // Convert to SPDX if requested
    if (options.format === 'spdx') {
      mergedSbom = this.convertToSpdx(mergedSbom, options.version || '1.5');
    }
    
    return mergedSbom;
  }

  private mergeSbomData(sboms: any[], project?: any): any {
    const timestamp = new Date().toISOString();
    
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
        bomRef: `pkg:application/${project?.name || 'unknown'}@${project?.version || '1.0.0'}`,
        ...(project?.license && { 
          licenses: [{ 
            license: { 
              id: project.license 
            } 
          }] 
        }),
      },
      properties: [
        {
          name: 'ossrepo:sbom:type',
          value: 'merged',
        },
        {
          name: 'ossrepo:sbom:components',
          value: sboms.length.toString(),
        },
        ...(project?.id ? [{
          name: 'ossrepo:project:id',
          value: project.id,
        }] : []),
        ...(project?.license ? [{
          name: 'ossrepo:project:license',
          value: project.license,
        }] : []),
      ],
    };

    if (sboms.length === 0) {
      return {
        $schema: 'http://cyclonedx.org/schema/bom-1.5.schema.json',
        bomFormat: 'CycloneDX',
        specVersion: '1.5',
        serialNumber: `urn:uuid:${project?.id || 'unknown'}-${Date.now()}`,
        version: 1,
        metadata,
        components: [],
        dependencies: [],
      };
    }
    
    // Merge components
    const componentMap = new Map();
    const dependencyMap = new Map();
    
    for (const sbom of sboms) {
      // Merge components
      if (sbom.components) {
        for (const comp of sbom.components) {
          const key = comp.purl || comp['bom-ref'];
          if (!componentMap.has(key)) {
            // Enrich component with additional fields if not present
            const enrichedComp = this.enrichComponent(comp);
            componentMap.set(key, enrichedComp);
          }
        }
      }
      
      // Merge dependencies
      if (sbom.dependencies && Array.isArray(sbom.dependencies)) {
        for (const dep of sbom.dependencies) {
          if (dep.ref) {
            if (!dependencyMap.has(dep.ref)) {
              dependencyMap.set(dep.ref, dep);
            } else {
              // Merge dependsOn arrays
              const existing = dependencyMap.get(dep.ref);
              const mergedDependsOn = new Set([
                ...(existing.dependsOn || []),
                ...(dep.dependsOn || []),
              ]);
              dependencyMap.set(dep.ref, {
                ...existing,
                dependsOn: Array.from(mergedDependsOn),
              });
            }
          }
        }
      }
    }
    
    return {
      $schema: 'http://cyclonedx.org/schema/bom-1.5.schema.json',
      bomFormat: 'CycloneDX',
      specVersion: '1.5',
      serialNumber: `urn:uuid:${project?.id || 'unknown'}-${Date.now()}`,
      version: 1,
      metadata,
      components: Array.from(componentMap.values()),
      dependencies: Array.from(dependencyMap.values()),
    };
  }

  private buildMergedSbomFromComponents(components: any[], dependencies: any[], project?: any): any {
    const timestamp = new Date().toISOString();
    
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
        bomRef: `pkg:application/${project?.name || 'unknown'}@${project?.version || '1.0.0'}`,
        ...(project?.license && { 
          licenses: [{ 
            license: { 
              id: project.license 
            } 
          }] 
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
      serialNumber: `urn:uuid:${project?.id || 'unknown'}-${Date.now()}`,
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

  private async addWatchlistDependencies(sbom: any, projectId: string): Promise<any> {
    // Get watchlist packages for the project
    const watchlistDeps = await this.sbomRepo.getProjectWatchlist(projectId);
    
    // Add watchlist packages as components if not already present
    const componentMap = new Map(sbom.components.map((c: any) => [
      c.purl || c['bom-ref'], c
    ]));
    
    for (const dep of watchlistDeps) {
      const key = `pkg:npm/${dep.package_name}`;
      if (!componentMap.has(key)) {
        componentMap.set(key, {
          type: 'library',
          name: dep.package_name,
          purl: key,
          'bom-ref': key,
        });
      }
    }
    
    return {
      ...sbom,
      components: Array.from(componentMap.values()),
    };
  }

  private convertToSpdx(sbom: any, version: string): any {
    return {
      spdxVersion: 'SPDX-2.3',
      dataLicense: 'CC0-1.0',
      SPDXID: 'SPDXRef-DOCUMENT',
      name: `SBOM-${Date.now()}`,
      documentNamespace: `https://spdx.org/spdxdocs/${Date.now()}`,
      packages: sbom.components.map((comp: any, index: number) => ({
        name: comp.name,
        SPDXID: `SPDXRef-${index}`,
        versionInfo: comp.version,
        downloadLocation: 'NOASSERTION',
        licenseDeclared: comp.license || 'NOASSLFERTION',
        packageVerificationCode: {
          packageVerificationCodeValue: 'NOASSERTION',
        },
      })),
      relationships: sbom.dependencies.map((dep: any) => ({
        spdxElementId: dep.ref,
        relationshipType: 'DEPENDS_ON',
        relatedSpdxElement: dep.dependsOn?.join(',') || 'NONE',
      })),
    };
  }

}
