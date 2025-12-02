import { Injectable, Logger } from '@nestjs/common';
import { SbomRepository } from '../repositories/sbom.repository';
import { simpleGit } from 'simple-git';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as Docker from 'dockerode';
import * as os from 'os';
import { ConnectionService } from '../../../common/azure/azure.service';
import { SbomGenerationService } from './sbom-generation.service';

@Injectable()
export class SbomBuilderService {
  constructor(
    private readonly sbomRepo: SbomRepository,
    private readonly azureService: ConnectionService,
    private readonly sbomGenerationService: SbomGenerationService,
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

  /**
   * @deprecated Use SbomGenerationService.generateSbom instead
   * This method delegates to SbomGenerationService for backward compatibility
   */
  private async genSbom(packageName: string, version?: string): Promise<string> {
    return this.sbomGenerationService.generateSbom(packageName, version);
  }

  private async cleanupTempFolder(repoPath: string) {
    try {
      await fs.promises.rm(repoPath, { recursive: true, force: true });
      this.logger.log(`✅ Cleaned up temporary folder: ${path}`);
    } catch (err) {
      this.logger.error(`⚠️ Failed to clean up temp folder: ${err.message}`);
    }
  }



  /**
   * @deprecated Use SbomGenerationService.addSbom instead
   * This method delegates to SbomGenerationService for backward compatibility
   */
  async addSbom(packageId: string, version?: string) {
    return this.sbomGenerationService.addSbom(packageId, version);
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
