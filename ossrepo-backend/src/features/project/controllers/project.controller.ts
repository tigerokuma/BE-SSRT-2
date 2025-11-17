import {Controller, Post, Get, Put, Delete, Body, Param, BadRequestException} from '@nestjs/common';
import {ProjectService} from '../services/project.service';
import {CreateProjectDto} from '../dto/create-project.dto';
import {UpdateProjectDto} from '../dto/update-project.dto';
import {CreateProjectCliDto} from '../dto/create-project-cli.dto';
import {DependencyQueueService} from '../../dependencies/services/dependency-queue.service';
import {AnalyzeProjectDto} from '../dto/analyze-project.dto';
import {PrismaService} from 'src/common/prisma/prisma.service';
import { ProjectAlertService } from '../services/project-alert.service';

@Controller('projects')
export class ProjectController {
    constructor(
        private readonly projectService: ProjectService,
        private readonly dependencyQueueService: DependencyQueueService,
        private readonly prisma: PrismaService,
        private readonly projectAlertService: ProjectAlertService,
    ) {
    }

    @Post()
    async createProject(@Body() createProjectDto: CreateProjectDto) {
        return this.projectService.createProject(createProjectDto);
    }

    @Get('user/:userId')
    async getProjectsByUserId(@Param('userId') userId: string) {
        return this.projectService.getProjectsByUserId(userId);
    }

    @Get(':id')
    async getProjectById(@Param('id') id: string) {
        return this.projectService.getProjectById(id);
    }

    @Get(':id/status')
    async getProjectStatus(@Param('id') id: string) {
        const project = await this.projectService.getProjectById(id);
        const progress = await this.projectService.getProjectProgress(id);
        return {
            id: project.id,
            status: project.status,
            errorMessage: project.error_message,
            progress: progress.progress,
            totalDependencies: progress.totalDependencies,
            completedDependencies: progress.completedDependencies,
            health_score: project.health_score,
            created_at: project.created_at,
        };
    }

    @Get(':id/users')
    async getProjectUsers(@Param('id') id: string) {
        return this.projectService.getProjectUsers(id);
    }

    @Get(':id/dependencies')
    async getProjectDependencies(@Param('id') id: string) {
        return this.projectService.getProjectDependencies(id);
    }


    @Post(':id/refresh-dependencies')
    async refreshProjectDependencies(@Param('id') id: string) {
        return this.projectService.refreshProjectDependencies(id);
    }

    @Get(':id/user/:userId/role')
    async getUserRoleInProject(@Param('id') id: string, @Param('userId') userId: string) {
        const role = await this.projectService.getUserRoleInProject(id, userId);
        return {role};
    }

    @Post(':id/join')
    async joinProject(@Param('id') id: string, @Body() body: { userId: string; }) {
        return this.projectService.joinProject(id, body.userId);
    }

    @Post(':id/watchlist')
    async addToProjectWatchlist(
        @Param('id') id: string,
        @Body() body: { userId: string; repoUrl: string; name: string }
    ) {
        return this.projectService.addToProjectWatchlist(id, body.userId, body.repoUrl, body.name);
    }

    @Get(':id/project-watchlist')
    async getProjectWatchlist(@Param('id') id: string) {
        return this.projectService.getProjectWatchlist(id);
    }

    @Get(':id/watchlist/status')
    async getWatchlistPackagesStatus(@Param('id') id: string) {
        return this.projectService.getWatchlistPackagesStatus(id);
    }

    @Get(':id/watchlist/refresh')
    async refreshWatchlistPackages(@Param('id') id: string) {
        console.log('🔄 Refresh endpoint called for project:', id);
        try {
            const result = await this.projectService.refreshWatchlistPackages(id);
            console.log('✅ Refresh endpoint success, returning', result.length, 'packages');
            return result;
        } catch (error) {
            console.error('❌ Refresh endpoint error:', error);
            throw error;
        }
    }

    @Get('watchlist/:watchlistId/review')
    async getProjectWatchlistReview(@Param('watchlistId') watchlistId: string) {
        return this.projectService.getProjectWatchlistReview(watchlistId);
    }

    @Post('watchlist/:watchlistId/approve')
    async approveWatchlistPackage(
        @Param('watchlistId') watchlistId: string,
        @Body() body: { userId: string }
    ) {
        return this.projectService.updateWatchlistPackageStatus(watchlistId, 'approved', body.userId);
    }

    @Post('watchlist/:watchlistId/reject')
    async rejectWatchlistPackage(
        @Param('watchlistId') watchlistId: string,
        @Body() body: { userId: string }
    ) {
        return this.projectService.updateWatchlistPackageStatus(watchlistId, 'rejected', body.userId);
    }

    @Post('watchlist/:watchlistId/comment')
    async addWatchlistComment(
        @Param('watchlistId') watchlistId: string,
        @Body() body: { userId: string; comment: string }
    ) {
        return this.projectService.addWatchlistComment(watchlistId, body.userId, body.comment);
    }

    // REMOVED: Old watchlist approval/comment endpoints - replaced with new Packages system

    @Post(':projectId/watchlist/add-package')
    async addPackageToWatchlist(
        @Param('projectId') projectId: string,
        @Body() body: { packageName: string; repoUrl?: string; userId: string }
    ) {
        console.log('🎯 Adding package to watchlist:', {
            projectId,
            packageName: body.packageName,
            repoUrl: body.repoUrl,
            userId: body.userId,
            timestamp: new Date().toISOString()
        });

        try {
            // Create or find the package
            let packageRecord = await this.prisma.packages.findUnique({
                where: {name: body.packageName}
            });
            const dbUser =
                await this.prisma.user.findUnique({where: {clerk_id: body.userId}});

            if (!dbUser) {
                throw new Error('User does not exist in DB (externalId not found)');
            }
            if (!packageRecord) {
                // Fetch license from npm API
                let packageLicense = 'MIT'; // Default fallback
                try {
                    const npmUrl = `https://registry.npmjs.org/${body.packageName}`;
                    const response = await fetch(npmUrl);
                    if (response.ok) {
                        const data = await response.json();
                        packageLicense = data.license || 'MIT';
                    }
                } catch (error) {
                    console.log(`⚠️ Could not fetch license for ${body.packageName}, using MIT as default`);
                }

                packageRecord = await this.prisma.packages.create({
                    data: {
                        name: body.packageName,
                        repo_url: body.repoUrl,
                        license: packageLicense,
                        status: 'queued',
                    }
                });
            }

            // Create the project watchlist package link
            const projectWatchlistPackage = await this.prisma.projectWatchlistPackage.create({
                data: {
                    project_id: projectId,
                    package_id: packageRecord.id,
                    added_by: dbUser.user_id,
                    status: 'pending'
                }
            });

            // Queue the fast setup job
            await this.dependencyQueueService.queueFastSetup({
                packageId: packageRecord.id,
                packageName: body.packageName,
                repoUrl: body.repoUrl,
                projectId: projectId,
            });

            console.log('✅ Package added to watchlist and queued for fast setup:', {
                packageId: packageRecord.id,
                projectWatchlistPackageId: projectWatchlistPackage.id
            });

            return {
                success: true,
                message: 'Package added to watchlist and queued for analysis',
                data: {
                    projectId,
                    packageName: body.packageName,
                    repoUrl: body.repoUrl,
                    packageId: packageRecord.id,
                    status: 'queued'
                }
            };
        } catch (error) {
            console.error('❌ Error adding package to watchlist:', error);
            throw error;
        }
    }

    @Put(':id')
    async updateProject(
        @Param('id') id: string,
        @Body() updateProjectDto: UpdateProjectDto
    ) {
        return this.projectService.updateProject(id, updateProjectDto);
    }

    // CLI-specific endpoints
    @Post('cli')
    async createProjectFromCli(@Body() createProjectCliDto: CreateProjectCliDto) {
        return this.projectService.createProjectFromCli(createProjectCliDto);
    }

    @Get('cli')
    async getProjectsForCli() {
        return this.projectService.getProjectsForCli();
    }

    @Post(':id/analyze')
    async analyzeProjectHealth(
        @Param('id') id: string,
        @Body() analyzeProjectDto: AnalyzeProjectDto
    ) {
        return this.projectService.analyzeProjectHealth(id, analyzeProjectDto);
    }

    @Get(':id/health')
    async getProjectHealth(@Param('id') id: string) {
        return this.projectService.getProjectHealth(id);
    }

    @Delete(':id')
    async deleteProject(@Param('id') id: string) {
        return this.projectService.deleteProject(id);
    }

    @Post('sync-webhooks')
    async syncAllWebhooks() {
        return this.projectService.syncAllWebhookIds();
    }

    @Get('debug/all')
    async debugAllProjects() {
        return this.projectService.debugAllProjects();
    }

    @Get(':id/alerts')
    async getProjectAlerts(
        @Param('id') projectId: string,
        @Body() body?: { alertType?: string; status?: string; packageId?: string },
    ) {
        if (!projectId || projectId.trim().length === 0) {
            throw new BadRequestException('Project ID is required');
        }

        // Get both ProjectAlert and ProjectPackageAlert
        const [projectAlerts, packageAlerts] = await Promise.all([
            this.projectAlertService.getProjectAlerts(projectId.trim(), body),
            this.projectAlertService.getProjectPackageAlerts(projectId.trim(), body),
        ]);

        // Combine and return both types
        return {
            projectAlerts,
            packageAlerts,
        };
    }

    @Put(':id/alerts/:alertId')
    async updateAlertStatus(
        @Param('id') projectId: string,
        @Param('alertId') alertId: string,
        @Body() body: { status: 'unread' | 'read' | 'resolved' },
    ) {
        if (!projectId || projectId.trim().length === 0) {
            throw new BadRequestException('Project ID is required');
        }

        if (!alertId || alertId.trim().length === 0) {
            throw new BadRequestException('Alert ID is required');
        }

        if (!body.status || !['unread', 'read', 'resolved'].includes(body.status)) {
            throw new BadRequestException('Status must be one of: unread, read, resolved');
        }

        const result = await this.projectAlertService.updateAlertStatus(
            alertId.trim(),
            body.status,
        );

        return result;
    }
}
