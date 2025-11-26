import { Injectable, Logger } from '@nestjs/common';
import { SbomRepository } from '../repositories/sbom.repository';
import { CreateSbomDto } from '../dto/sbom.dto';
import { simpleGit } from 'simple-git';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as Docker from 'dockerode';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ConnectionService } from '../../../common/azure/azure.service';

const execAsync = promisify(exec);

@Injectable()
export class SbomBuilderService {
  constructor(
    private readonly sbomRepo: SbomRepository,
    private readonly azureService: ConnectionService,
  ) {}

  private readonly logger = new Logger(SbomBuilderService.name);
  private readonly docker = new Docker.default();

  // Clone Git repo into a temp directory
  private async cloneRepo(gitUrl: string, version?: string): Promise<string> {
    const targetDir = path.join(os.tmpdir(), 'sbom-repos');
    const uniqueDir = path.join(targetDir, randomUUID());

    const clonePath = path.resolve(uniqueDir);
    const git = simpleGit();

    try {
      console.log(`Cloning ${gitUrl} into ${clonePath}...`);
      await git.clone(gitUrl, clonePath);
      console.log('Clone complete.');
      
      // Check out specific version if provided
      if (version) {
        console.log(`Checking out version: ${version}`);
        const repoGit = simpleGit(clonePath);
        try {
          // Fetch all tags and branches first
          await repoGit.fetch(['--all', '--tags']);
          
          // Try to checkout as a tag first (most common for versions)
          try {
            await repoGit.checkout(`tags/${version}`);
            console.log(`Successfully checked out tag: ${version}`);
          } catch (tagError) {
            // If tag fails, try as a branch
            try {
              await repoGit.checkout(version);
              console.log(`Successfully checked out branch: ${version}`);
            } catch (branchError) {
              // If branch fails, try as a commit hash
              try {
                await repoGit.checkout(version);
                console.log(`Successfully checked out commit: ${version}`);
              } catch (commitError) {
                console.warn(`Could not checkout version ${version}, using default branch. Error: ${commitError.message}`);
                // Continue with default branch - don't throw error
              }
            }
          }
        } catch (fetchError) {
          // If fetch fails, still try to checkout (might be a local branch or commit)
          try {
            await repoGit.checkout(version);
            console.log(`Successfully checked out: ${version}`);
          } catch (checkoutError) {
            console.warn(`Could not checkout version ${version}, using default branch. Error: ${checkoutError.message}`);
            // Continue with default branch - don't throw error
          }
        }
      }
    } catch (err) {
      console.error('Error cloning repo:', err);
      throw err;
    }
    return uniqueDir;
  }

  // Remove test directories to reduce SBOM noise
  private async cleanupRepo(repoPath: string) {
    const testDirs = ['test', 'tests'];

    for (const dir of testDirs) {
      const fullPath = path.join(repoPath, dir);
      if (fs.existsSync(fullPath)) {
        console.log(`🧹 Removing ${dir}`);
        fs.rmSync(fullPath, { recursive: true, force: true });
      }
    }
  }

  // Run the docker containers as well as the command issued
  private async runCommand({
    image,
    cmd,
    workingDir,
    volumeHostPath,
    volumeContainerPath = '/app',
    autoRemove = true,
  }: {
    image: string;
    cmd: string[];
    workingDir: string;
    volumeHostPath: string;
    volumeContainerPath?: string;
    autoRemove?: boolean;
  }): Promise<void> {
    const container = await this.docker.createContainer({
      Image: image,
      Cmd: cmd,
      WorkingDir: workingDir,
      HostConfig: {
        Binds: [`${volumeHostPath}:${volumeContainerPath}`],
        AutoRemove: autoRemove,
      },
    });

    this.logger.log(`Running container with command: ${cmd.join(' ')}`);
    await container.start();

    const stream = await container.logs({
      stdout: true,
      stderr: true,
      follow: true,
    });
    stream.on('data', (chunk) => this.logger.debug(chunk.toString()));

    const result = await container.wait();
    if (result.StatusCode !== 0) {
      throw new Error(`Container exited with code ${result.StatusCode}`);
    }
  }

  // Generate SBOM using remote command execution
  private async genSbom(packageName: string, version?: string): Promise<string> {
    let sbom: any;
    
    try {
      // Execute remote command to generate SBOM with package@version format
      const packageVersion = version ? `${packageName}@${version}` : packageName;
      const result = await this.azureService.executeRemoteCommand(
        `./scripts/gen_sbom.sh ${packageVersion}`,
      );

      if (result.code !== 0) {
        this.logger.error(
          `Remote SBOM generation failed with code ${result.code}: ${result.stderr}`,
        );
        throw new Error(`SBOM generation failed: ${result.stderr}`);
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
        
        this.logger.log('SBOM generation successful');
      } catch (parseError) {
        this.logger.error(
          `Failed to parse SBOM JSON from remote output: ${parseError.message}`,
        );
        throw new Error('Invalid SBOM JSON received from remote command');
      }
    } catch (err) {
      this.logger.error(
        `Remote SBOM generation failed: ${err.message}. Writing empty SBOM.`,
      );

      // Fallback: write empty SBOM
      sbom = {
        bomFormat: 'CycloneDX',
        specVersion: '1.5',
        version: 1,
        components: [],
      };
    }

    // Post-process: ensure licenses are populated using purl (npm/GitHub)
    try {

      if (Array.isArray(sbom.components)) {
        // Find components that need license enrichment
        const componentsNeedingLicense = sbom.components.filter(component => {
          const hasLicenseArray = Array.isArray(component.licenses) && component.licenses.length > 0;
          const currentLicense = hasLicenseArray ? (component.licenses[0]?.license?.id || component.licenses[0]?.license?.name) : undefined;
          return !currentLicense && component.purl;
        });

        if (componentsNeedingLicense.length > 0) {
          // Fetch licenses in parallel (batch of 10 to avoid rate limits)
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

  private async cleanupTempFolder(repoPath: string) {
    try {
      await fs.promises.rm(repoPath, { recursive: true, force: true });
      this.logger.log(`✅ Cleaned up temporary folder: ${path}`);
    } catch (err) {
      this.logger.error(`⚠️ Failed to clean up temp folder: ${err.message}`);
    }
  }

  private async getLicenseFromPurl(purl: string): Promise<string> {
    try {
      // Example purl: "pkg:npm/lodash@4.17.21"
      const match = purl.match(/^pkg:(\w+)\/([^@]+)(?:@(.+))?/);
      if (!match) return "";

      const [, type, name, version] = match;
      if (type === 'npm') {
        const res = await fetch(`https://registry.npmjs.org/${name}`);
        if (res.ok) {
          const data = await res.json();
          // Handle different license formats from npm registry
          if (typeof data.license === 'string') {
            return data.license;
          } else if (typeof data.license === 'object' && data.license !== null) {
            return data.license.type || data.license.name || "";
          }
        }
      }
      // Add similar logic for PyPI, Maven, etc.
      return "";
    } catch (error) {
      console.error(`Error fetching license for ${purl}: ${error}`);
      return "";
    }
  }


  async addSbom(packageId: string, version?: string) {
    const packageInfo = await this.sbomRepo.getPackageById(packageId);
    if (!packageInfo) {
      throw new Error(`Package with ID ${packageId} not found`);
    }

    const packageName = packageInfo.package_name;
    console.log(`Package Name: ${packageName}`);
    const data = await this.genSbom(packageName, version);
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

  private async writeSbomsToTempFiles(sboms: Array<{ sbom: any }>) {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sbom-'));
    const filePaths: string[] = [];

    for (let i = 0; i < sboms.length; i++) {
      const filePath = path.join(tempDir, `sbom_${i}.json`);
      await fs.promises.writeFile(
        filePath,
        JSON.stringify(sboms[i].sbom, null, 2),
        'utf8',
      );
      filePaths.push(filePath);
    }

    return { tempDir, filePaths };
  }

  async mergeSbom(projectId: string) {
    const sboms = await this.sbomRepo.getProjectDependencySboms(projectId);
    const { tempDir, filePaths } = await this.writeSbomsToTempFiles(sboms);

    const absPath = tempDir;
    const containerPath = '/app';
    const filenames = filePaths.map((f) => path.basename(f));

    await this.runCommand({
      image: 'cyclonedx-cli',
      cmd: [
        'merge',
        '--input-files',
        ...filenames.map((name) => `${containerPath}/${name}`),
        '--output-file',
        `merged.json`,
      ],
      workingDir: containerPath,
      volumeHostPath: absPath,
    });

    const mergedPath = path.join(absPath, 'merged.json');
    const mergedString = await fs.promises.readFile(mergedPath, 'utf-8');
    const mergedData = JSON.parse(mergedString);

    const originalTopComponents = sboms
      .map((sbom) => {
        try {
          const parsed = JSON.parse(JSON.stringify(sbom.sbom));
          return parsed.metadata?.component?.['bom-ref'];
        } catch (e) {
          return null;
        }
      })
      .filter(Boolean);

    const newTop = {
      type: 'application',
      'bom-ref': `pkg:project/${projectId}@latest`,
      name: `project-sbom-${projectId}`,
      version: '1.0.0',
    };

    mergedData.metadata = {
      ...(mergedData.metadata || {}),
      component: newTop,
    };

    mergedData.dependencies = [
      {
        ref: newTop['bom-ref'],
        dependsOn: originalTopComponents,
      },
      ...(mergedData.dependencies || []),
    ];
    // Clean up
    await this.cleanupTempFolder(tempDir);

    // Insert to database
    const createSbomDto = {
      id: projectId,
      sbom: mergedData,
    };
    this.sbomRepo.upsertProjectSbom(createSbomDto);
    return await mergedData;
  }
}
