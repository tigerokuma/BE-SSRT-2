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

    await this.runCommand({
      image: 'ghcr.io/cyclonedx/cdxgen:latest',
      cmd: ['-o', outputFileName],
      workingDir: containerPath,
      volumeHostPath: absPath,
    });

    if (!fs.existsSync(outputPath)) {
      throw new Error(`SBOM not generated at ${outputPath}`);
    }

    this.logger.log('SBOM generation successful');
    return fs.readFileSync(outputPath, 'utf-8');
  }

  async parseSbom(data: string) {
    console.log('Parsing data.');
    return JSON.parse(data);
  }

  async addSbom(gitUrl: string) {
    const repoPath = "/tmp/sbom-repos/bbb3ba0a-1772-4f94-baf9-ff67459fa2ba";//wait this.cloneRepo(gitUrl);
    const data = await this.genSbom(repoPath);
    return await this.parseSbom(data);
  }


  async findOne(id: string) {
    const sbom = await this.sbomRepo.findById(id);
    if (!sbom) throw new NotFoundException('SBOM not found');
    return sbom;
  }


}
