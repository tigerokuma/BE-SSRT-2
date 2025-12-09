import { Injectable, Logger } from '@nestjs/common';
import { SbomRepository } from '../repositories/sbom.repository';
import { CreateSbomDto } from '../dto/sbom.dto';
import { ConnectionService } from '../../../common/azure/azure.service';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execAsync = promisify(exec);

/**
 * Service for generating SBOMs from package names
 * Handles SBOM generation using cdxgen (local or remote)
 */
@Injectable()
export class SbomGenerationService {
  private readonly logger = new Logger(SbomGenerationService.name);

  constructor(
    private readonly sbomRepo: SbomRepository,
    private readonly azureService: ConnectionService,
  ) {}

  /**
   * Generate SBOM for a package
   */
  async generateSbom(packageName: string, version?: string): Promise<string> {
    let sbom: any;
    
    // Check CDXGEN_LOCATION environment variable
    const cdxgenLocation = process.env.CDXGEN_LOCATION?.toLowerCase() || 'remote';
    const useLocal = cdxgenLocation === 'local';
    
    try {
      const packageVersion = version ? `${packageName}@${version}` : packageName;
      let result: { stdout: string; stderr: string };
      
      if (useLocal) {
        // Execute local command to generate SBOM
        const scriptPath = path.join(process.cwd(), 'scripts', 'gen_sbom.sh');
        const command = `bash "${scriptPath}" ${packageVersion}`;
        
        this.logger.log(`Executing local SBOM generation command: ${command}`);
        
        result = await execAsync(command, {
          cwd: process.cwd(),
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        });

        // Filter out npm notices and deprecated warnings from stderr
        if (result.stderr && result.stderr.trim().length > 0) {
          const filteredStderr = result.stderr
            .split('\n')
            .filter(line => {
              // Remove npm notice lines
              if (line.includes('npm notice')) return false;
              // Remove npm deprecated warnings
              if (line.includes('npm warn deprecated')) return false;
              // Keep everything else (actual errors)
              return true;
            })
            .join('\n');

          if (filteredStderr.trim().length > 0) {
            this.logger.warn(`SBOM generation stderr: ${filteredStderr}`);
          }
        }
      } else {
        // Execute remote command to generate SBOM
        const scriptPath = './scripts/gen_sbom.sh';
        const command = `bash ${scriptPath} ${packageVersion}`;
        
        this.logger.log(`Executing remote SBOM generation command: ${command}`);
        
        const remoteResult = await this.azureService.executeRemoteCommand(command);
        result = {
          stdout: remoteResult.stdout,
          stderr: remoteResult.stderr,
        };

        // Filter out npm notices and deprecated warnings from stderr
        if (result.stderr && result.stderr.trim().length > 0) {
          const filteredStderr = result.stderr
            .split('\n')
            .filter(line => {
              // Remove npm notice lines
              if (line.includes('npm notice')) return false;
              // Remove npm deprecated warnings
              if (line.includes('npm warn deprecated')) return false;
              // Keep everything else (actual errors)
              return true;
            })
            .join('\n');

          if (filteredStderr.trim().length > 0) {
            this.logger.warn(`SBOM generation stderr: ${filteredStderr}`);
          }
        }

        if (remoteResult.code !== 0) {
          this.logger.warn(`SBOM generation command exited with code ${remoteResult.code}`);
        }
      }
      
      // Parse the SBOM from stdout
      try {
        const output = `${result.stdout}\n${result.stderr}`;
        const match = output.match(
          /----- SBOM OUTPUT START -----(.*?)----- SBOM OUTPUT END -----/s
        );
        
        if (!match) {
          throw new Error("Failed to extract SBOM JSON from output");
        }
        
        const sbomJson = match[1].trim();
        sbom = JSON.parse(sbomJson);
        
        this.logger.log(`SBOM generation successful (${useLocal ? 'local' : 'remote'})`);
      } catch (parseError) {
        this.logger.error(
          `Failed to parse SBOM JSON from ${useLocal ? 'local' : 'remote'} output: ${parseError.message}`,
        );
        throw new Error(`Invalid SBOM JSON received from ${useLocal ? 'local' : 'remote'} command`);
      }
    } catch (err: any) {
      this.logger.error(
        `${useLocal ? 'Local' : 'Remote'} SBOM generation failed: ${err.message}. Writing empty SBOM.`,
      );

      // Fallback: write empty SBOM with basic metadata structure
      sbom = {
        bomFormat: 'CycloneDX',
        specVersion: '1.5',
        version: 1,
        metadata: {
          timestamp: new Date().toISOString(),
          tools: [
            {
              vendor: 'Deply',
              name: 'Deply SBOM Generator',
              version: '1.0.0',
            },
          ],
          component: {
            type: 'library',
            name: packageName,
            version: version || 'unknown',
          },
        },
        components: [],
        dependencies: [],
      };
    }

    // Post-process: ensure licenses are populated using purl (npm/GitHub)
    try {
      if (Array.isArray(sbom.components)) {
        const componentsNeedingLicense = sbom.components.filter(component => {
          const hasLicenseArray = Array.isArray(component.licenses) && component.licenses.length > 0;
          const currentLicense = hasLicenseArray ? (component.licenses[0]?.license?.id || component.licenses[0]?.license?.name) : undefined;
          return !currentLicense && component.purl;
        });

        if (componentsNeedingLicense.length > 0) {
          const batchSize = 10;
          for (let i = 0; i < componentsNeedingLicense.length; i += batchSize) {
            const batch = componentsNeedingLicense.slice(i, i + batchSize);
            const licensePromises = batch.map(async (component) => {
              try {
                const fetched = await this.getLicenseFromPurl(component.purl);
                if (fetched && typeof fetched === 'string') {
                  component.licenses = [{ license: { id: fetched } }];
                }
              } catch (e) {
                // ignore fetch errors per component
              }
            });
            
            await Promise.all(licensePromises);
          }
        }
      }
    } catch (e) {
      this.logger.warn(`License enrichment skipped: ${e?.message || e}`);
    }

    return JSON.stringify(sbom, null, 2);
  }

  /**
   * Generate and store SBOM for a package
   */
  async addSbom(packageId: string, version?: string) {
    const packageInfo = await this.sbomRepo.getPackageById(packageId);
    if (!packageInfo) {
      throw new Error(`Package with ID ${packageId} not found`);
    }

    const packageName = packageInfo.package_name;
    this.logger.log(`Generating SBOM for package: ${packageName}${version ? `@${version}` : ''}`);
    const data = await this.generateSbom(packageName, version);
    const jsonData = await JSON.parse(data);
    const createSbomDto: CreateSbomDto = {
      id: packageId,
      sbom: jsonData,
    };
    await this.sbomRepo.upsertPackageSbom(createSbomDto);

    return {
      sbom: jsonData,
      packageName,
      version,
    };
  }

  /**
   * Fetch license information from PURL
   */
  private async getLicenseFromPurl(purl: string): Promise<string> {
    try {
      const match = purl.match(/^pkg:(\w+)\/([^@]+)(?:@(.+))?/);
      if (!match) return "";

      const [, type, name] = match;
      if (type === 'npm') {
        const res = await fetch(`https://registry.npmjs.org/${name}`);
        if (res.ok) {
          const data = await res.json();
          if (typeof data.license === 'string') {
            return data.license;
          } else if (typeof data.license === 'object' && data.license !== null) {
            return data.license.type || data.license.name || "";
          }
        }
      }
      return "";
    } catch (error) {
      this.logger.error(`Error fetching license for ${purl}: ${error}`);
      return "";
    }
  }
}

