import { Injectable, Logger, Body } from '@nestjs/common';
import { SbomRepository } from '../repositories/sbom.repository';
import { CreateSbomDto } from '../dto/sbom.dto';
import { simpleGit } from 'simple-git';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as Docker from 'dockerode';
import * as os from 'os';

@Injectable()
export class SbomBuilderService {
    constructor(private readonly sbomRepo: SbomRepository) {}

    private readonly logger = new Logger(SbomBuilderService.name);
    private readonly docker = new Docker.default();

    // Clone Git repo into a temp directory
        async cloneRepo(gitUrl: string): Promise<string> {
        const targetDir = path.join(os.tmpdir(), 'sbom-repos');
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
        autoRemove?: boolean;} ): Promise<void> {
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

    // Generate SBOM using cdxgen inside a container
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

    async addSbom(watchlistId: string) {
        const gitUrl = ( await this.sbomRepo.getUrl(watchlistId) )?.repo_url;
        const repoPath = await this.cloneRepo(gitUrl!);
        this.cleanupRepo(repoPath);
        const data = await this.genSbom(repoPath);
        const jsonData = await JSON.parse(data);
        const createSbomDto: CreateSbomDto = {
            id: watchlistId, 
            sbom: jsonData
        }
        this.sbomRepo.upsertWatchSbom(createSbomDto);
        this.cleanupTempFolder(repoPath);
        
        return jsonData;
    }

    async writeSbomsToTempFiles(sboms: Array<{ sbom: any }>) {
        const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sbom-'));
        const filePaths: string[] = [];

        for (let i = 0; i < sboms.length; i++) {
            const filePath = path.join(tempDir, `sbom_${i}.json`);
            await fs.promises.writeFile(filePath, JSON.stringify(sboms[i].sbom, null, 2), 'utf8');
            filePaths.push(filePath);
        }

        return { tempDir, filePaths };
    }

    async mergeSbom(user_id: string) {
        const sboms = await this.sbomRepo.getFollowSboms(user_id);
        const {tempDir, filePaths} = await this.writeSbomsToTempFiles(sboms);
        
        const absPath = tempDir;
        const containerPath = '/app';
        const filenames = filePaths.map(f => path.basename(f));

        await this.runCommand({
        image: 'cyclonedx-cli',
        cmd: [
            'merge',
            '--input-files',
            ...filenames.map(name => `${containerPath}/${name}`),
            '--output-file', `merged.json`],
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
        }).filter(Boolean);

        const newTop = {
            type: "application",
            "bom-ref": `pkg:user/${user_id}@latest`,
            name: `user-watchlist-sbom-${user_id}`,
            version: "1.0.0"
        };

        mergedData.metadata = {
            ...(mergedData.metadata || {}),
            component: newTop
        };

        mergedData.dependencies = [
            {
                ref: newTop["bom-ref"],
                dependsOn: originalTopComponents
            },
            ...(mergedData.dependencies || [])
        ];
        // Clean up
        await this.cleanupTempFolder(tempDir);

        // Insert to database
        const createSbomDto = {
            id: user_id, 
            sbom: mergedData
        }
        this.sbomRepo.upsertUserSbom(createSbomDto);
        return await mergedData;
    }
}