import { Injectable, Logger, Body } from '@nestjs/common';
import { SbomRepository } from '../repositories/sbom.repository';
import { NotFoundException } from '@nestjs/common';
import { CreateSbomDto } from '../dto/sbom.dto';
import { simpleGit } from 'simple-git';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import * as os from 'os';
import * as Docker from 'dockerode';



@Injectable()
export class SbomService {

  private readonly logger = new Logger(SbomService.name);
  private readonly docker = new Docker.default();


  constructor(private readonly sbomRepo: SbomRepository) {}

  async cloneRepo(gitUrl: string, targetDir = '/tmp/sbom-repos'): Promise<string> {
    const uniqueDir = path.join(targetDir, randomUUID());

    const clonePath = path.resolve(uniqueDir);
    const git = simpleGit();

    try {
      console.log(`Cloning ${gitUrl} into ${clonePath}...`);
      await git.clone(gitUrl, clonePath);
      console.log('Clone complete.');
    } catch (err) {
      console.error('Error cloning repo:', err);
      throw err;
    }
    return uniqueDir;
  }

  private async cleanupRepo(repoPath: string) {
    const testDirs = ['test', 'tests'];

    // Clean up test dirs
    for (const dir of testDirs) {
      const fullPath = path.join(repoPath, dir);
      if (fs.existsSync(fullPath)) {
        console.log(`🧹 Removing ${dir}`);
        fs.rmSync(fullPath, { recursive: true, force: true });
      }
    }

  }

  private async runCommand({image, cmd, workingDir, volumeHostPath, volumeContainerPath = '/app', autoRemove = true,}: 
    { image: string; cmd: string[]; workingDir: string; volumeHostPath: string; volumeContainerPath?: string; autoRemove?: boolean;} ): Promise<void> {
    const container = await this.docker.createContainer({
      Image: image, Cmd: cmd, WorkingDir: workingDir,
      HostConfig: {
        Binds: [`${volumeHostPath}:${volumeContainerPath}`],
        AutoRemove: autoRemove,
      },
    });

    this.logger.log(`Running container with command: ${cmd.join(' ')}`);
    await container.start();

    const stream = await container.logs({ stdout: true, stderr: true, follow: true });
    stream.on('data', (chunk) => this.logger.debug(chunk.toString()));

    const result = await container.wait();
    if (result.StatusCode !== 0) {
      throw new Error(`Container exited with code ${result.StatusCode}`);
    }
  }



  async genSbom(repoPath: string): Promise<string> {
    const absPath = path.resolve(repoPath);
    const outputFileName = 'sbom-output1.json';
    const containerPath = '/app';
    const outputPath = path.join(absPath, outputFileName);

    if (!fs.existsSync(absPath)) {
      throw new Error(`Repo path not found: ${absPath}`);
    }
    try {
      // Regular command
      await this.runCommand({
        image: 'ghcr.io/cyclonedx/cdxgen:latest',
        cmd: ['-o', outputFileName],
        workingDir: containerPath,
        volumeHostPath: absPath,
      });
    } catch (err1) {
      this.logger.warn(`cdxgen failed: ${err1.message}, retrying with --no-recurse`);

      try {
        // Retry with --no-recurse
        await this.runCommand({
          image: 'ghcr.io/cyclonedx/cdxgen:latest',
          cmd: ['--no-recurse', '-o', outputFileName],
          workingDir: containerPath,
          volumeHostPath: absPath,
        });
      } catch (err2) {
        this.logger.error(`cdxgen with --no-recurse failed: ${err2.message}. Writing empty SBOM.`);

        // Fallback: write empty SBOM
        fs.writeFileSync(outputPath, JSON.stringify({
          bomFormat: "CycloneDX",
          specVersion: "1.5",
          version: 1,
          components: [],
        }, null, 2));
      }
    }
    
    if (!fs.existsSync(outputPath)) {
      this.logger.log('SBOM generation was unsuccessful');
    }

    this.logger.log('SBOM generation successful');
    return fs.readFileSync(outputPath, 'utf-8');
  }


  private async cleanupTempFolder(repoPath: string) {
    try {
      await fs.promises.rm(repoPath, { recursive: true, force: true });
      this.logger.log(`✅ Cleaned up temporary folder: ${path}`);
    } catch (err) {
      this.logger.error(`⚠️ Failed to clean up temp folder: ${err.message}`);
    }

  }
  private parseSbom(data: string) {
    console.log('Parsing data.');
    return JSON.parse(data);
  }

  async addSbom(gitUrl: string) {
    const repoPath = await this.cloneRepo(gitUrl);
    this.cleanupRepo(repoPath);
    const data = await this.genSbom(repoPath);
    const jsonData = await this.parseSbom(data);
    this.cleanupTempFolder(repoPath);
    
    return jsonData;
  }


  async findOne(id: string) {
    const sbom = await this.sbomRepo.findById(id);
    if (!sbom) throw new NotFoundException('SBOM not found');
    return sbom;
  }


}
