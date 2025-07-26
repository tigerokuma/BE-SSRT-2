import { Injectable, Body } from '@nestjs/common';
import { SbomRepository } from '../repositories/sbom.repository';
import { NotFoundException } from '@nestjs/common';
import { CreateSbomDto } from '../dto/sbom.dto';
import { simpleGit } from 'simple-git';
import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn } from 'child_process';
import * as os from 'os';


@Injectable()
export class SbomService {
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
    return targetDir;
  }

  runCommand(cmd: string, args: string[]): Promise<void> {
    console.log('Generating SBOM.');
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args, { stdio: 'inherit' });

      proc.on('error', reject);

      proc.on('close', (code) => {
        if (code !== 0) {
          return reject(new Error(`${cmd} exited with code ${code}`));
        }
        resolve();
      });
    });
  }


  async genSbom(repoPath: string): Promise<string> {
    const outputPath = path.resolve(repoPath, 'sbom.json');

    await this.runCommand('npx', ['cdxgen', repoPath, '-o', outputPath]);
    console.log('Generated SBOM.');
    try {
      console.log('Reading output');
      const bomJson = await fs.readFile(outputPath, 'utf-8');
      console.log('Finished reading output.');
      return bomJson;
    } catch (err) {
      console.log('New Error');
      throw new Error(`Failed to read generated SBOM at ${outputPath}`);
    }

  }

  async parseSbom(data: string) {
    console.log('Parsing data.');
    return JSON.parse(data);
  }

  async addSbom(gitUrl: string) {
    const repoPath = await this.cloneRepo(gitUrl);
    const data = await this.genSbom(repoPath);
    return await this.parseSbom(data);
  }


  async findOne(id: string) {
    const sbom = await this.sbomRepo.findById(id);
    if (!sbom) throw new NotFoundException('SBOM not found');
    return sbom;
  }


}
