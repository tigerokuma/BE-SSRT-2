import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { CreateProjectDto } from '../dto/create-project.dto';
import { UpdateProjectDto } from '../dto/update-project.dto';

@Injectable()
export class ProjectRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createProject(createProjectDto: CreateProjectDto) {
    console.log('Creating project with data:', {
      name: createProjectDto.name,
      type: createProjectDto.type,
      repositoryUrl: createProjectDto.repositoryUrl,
      hasPackageData: !!createProjectDto.packageData
    });

    let monitoredBranchId: string | null = null;

    // Only create MonitoredBranch for repo-type projects
    if (createProjectDto.type === 'repo' && createProjectDto.repositoryUrl) {
      const monitoredBranch = await this.prisma.monitoredBranch.upsert({
        where: {
          repository_url_branch_name: {
            repository_url: createProjectDto.repositoryUrl,
            branch_name: createProjectDto.branch || 'main',
          },
        },
        update: {},
        create: {
          repository_url: createProjectDto.repositoryUrl,
          branch_name: createProjectDto.branch || 'main',
          is_active: true
        },
      });
      monitoredBranchId = monitoredBranch.id;
    }

    // Create the project with the new fields
    const projectData: any = {
      name: createProjectDto.name,
      description: createProjectDto.description,
      type: createProjectDto.type,
      language: createProjectDto.language,
      license: createProjectDto.license,
      vulnerability_notifications: createProjectDto.vulnerability_notifications ?? { alerts: true, slack: false, discord: false },
      license_notifications: createProjectDto.license_notifications ?? { alerts: true, slack: false, discord: false },
      health_notifications: createProjectDto.health_notifications ?? { alerts: true, slack: false, discord: false },
    };

    // Add monitored branch ID only for repo projects
    if (monitoredBranchId) {
      projectData.monitored_branch_id = monitoredBranchId;
    }

    // Handle dependencies based on project type
    if (createProjectDto.type === 'file' && createProjectDto.packageData) {
      // For file uploads, store the parsed package.json data
      projectData.dependencies = createProjectDto.packageData;
    } else if (createProjectDto.type === 'cli' && createProjectDto.dependencies) {
      // For CLI projects, store the dependencies list
      projectData.dependencies = createProjectDto.dependencies;
    }

    console.log('Final project data being created:', projectData);
    
    const project = await this.prisma.project.create({
      data: projectData,
    });

    console.log('Project created successfully:', project.id);
    return project;
  }

  async getProjectsByUserId(userId: string) {
    return this.prisma.project.findMany({
      where: {
        projectUsers: {
          some: {
            user_id: userId,
          },
        },
      },
    });
  }

  async getProjectById(projectId: string) {
    return this.prisma.project.findUnique({
      where: {
        id: projectId,
      },
    });
  }

  async getProjectWithBranch(projectId: string) {
    const result = await this.prisma.project.findUnique({
      where: {
        id: projectId,
      },
      include: {
        monitoredBranch: true,
      },
    });
    console.log('getProjectWithBranch result:', JSON.stringify(result, null, 2));
    return result;
  }

  async createProjectUser(projectId: string, userId: string, role: string = 'admin') {
    return this.prisma.projectUser.create({
      data: {
        project_id: projectId,
        user_id: userId,
        role,
      },
    });
  }

  async getProjectUsers(projectId: string) {
    return this.prisma.projectUser.findMany({
      where: {
        project_id: projectId,
      },
      include: {
        user: {
          select: {
            user_id: true,
            name: true,
            email: true,
          },
        },
      },
    });
  }

  async createBranchDependencies(monitoredBranchId: string, dependencies: { name: string; version: string }[]) {
    const dependencyData = dependencies.map(dep => ({
      monitored_branch_id: monitoredBranchId,
      name: dep.name,
      version: dep.version,
    }));

    return this.prisma.branchDependency.createMany({
      data: dependencyData,
      skipDuplicates: true,
    });
  }

  async createBranchDependenciesWithReturn(monitoredBranchId: string, dependencies: { name: string; version: string }[]) {
    const dependencyData = dependencies.map(dep => ({
      monitored_branch_id: monitoredBranchId,
      name: dep.name,
      version: dep.version,
    }));

    // Create dependencies one by one to get the IDs back, using upsert to handle existing ones
    const createdDependencies = [];
    for (const dep of dependencyData) {
      const created = await this.prisma.branchDependency.upsert({
        where: {
          monitored_branch_id_name: {
            monitored_branch_id: monitoredBranchId,
            name: dep.name,
          },
        },
        update: {
          version: dep.version, // Update version if dependency already exists
        },
        create: dep,
      });
      createdDependencies.push(created);
    }

    return createdDependencies;
  }

  async getBranchDependencies(monitoredBranchId: string) {
    return this.prisma.branchDependency.findMany({
      where: {
        monitored_branch_id: monitoredBranchId,
      },
      include: {
        package: true
      },
      orderBy: {
        name: 'asc',
      },
    });
  }


  async clearBranchDependencies(monitoredBranchId: string) {
    return this.prisma.branchDependency.deleteMany({
      where: {
        monitored_branch_id: monitoredBranchId,
      },
    });
  }

  async getUserRoleInProject(projectId: string, userId: string) {
    const projectUser = await this.prisma.projectUser.findUnique({
      where: {
        project_id_user_id: {
          project_id: projectId,
          user_id: userId,
        },
      },
      select: {
        role: true,
      },
    });
    return projectUser?.role;
  }

  async addUserToProject(projectId: string, userId: string, role: string = 'member') {
    // Check if user is already in the project
    const existingUser = await this.prisma.projectUser.findUnique({
      where: {
        project_id_user_id: {
          project_id: projectId,
          user_id: userId,
        },
      },
    });

    if (existingUser) {
      return existingUser;
    }

    // First, ensure the user exists in the users table
    await this.prisma.user.upsert({
      where: { user_id: userId },
      update: {},
      create: {
        user_id: userId,
        email: `${userId}@example.com`,
        name: userId,
      },
    });

    // Add user to project
    return this.prisma.projectUser.create({
      data: {
        project_id: projectId,
        user_id: userId,
        role,
      },
    });
  }

  async addToProjectWatchlist(projectId: string, userId: string, repoUrl: string, name: string) {
    // First, find or create the package
    let packageRecord = await this.prisma.packages.findUnique({
      where: { name },
    });

    if (!packageRecord) {
      packageRecord = await this.prisma.packages.create({
        data: {
          name,
          repo_url: repoUrl,
          status: 'queued',
        },
      });
    }

    // Check if package is already in project watchlist
    const existing = await this.prisma.projectWatchlistPackage.findUnique({
      where: {
        project_id_package_id: {
          project_id: projectId,
          package_id: packageRecord.id,
        },
      },
    });

    if (existing) {
      return existing;
    }

    // Add package to project watchlist
    return this.prisma.projectWatchlistPackage.create({
      data: {
        project_id: projectId,
        package_id: packageRecord.id,
        added_by: userId, // Default user for now
        status: 'pending'
      },
    });
  }

  async getProjectWatchlist(projectId: string) {
    return this.prisma.projectWatchlistPackage.findMany({
      where: {
        project_id: projectId,
      },
      include: {
        package: true,
        addedByUser: {
          select: {
            name: true,
            email: true
          }
        },
        approvedByUser: {
          select: {
            name: true,
            email: true
          }
        },
        rejectedByUser: {
          select: {
            name: true,
            email: true
          }
        },
        comments: {
          orderBy: {
            created_at: 'asc',
          },
          include: {
            user: {
              select: {
                name: true,
                email: true
              }
            }
          }
        },
      },
      orderBy: {
        added_at: 'desc',
      },
    });
  }

  async getProjectWatchlistReview(projectWatchlistId: string) {
    return this.prisma.projectWatchlistPackage.findUnique({
      where: {
        id: projectWatchlistId,
      },
      include: {
        package: true,
        project: true,
        comments: {
          orderBy: {
            created_at: 'asc',
          },
          include: {
            user: {
              select: {
                name: true,
                email: true
              }
            }
          }
        },
      },
    });
  }

  async updateWatchlistPackageStatus(projectWatchlistId: string, status: string, userId?: string) {
    const updateData: any = {
      status: status,
    };

    if (status === 'approved' && userId) {
      updateData.approved_by = userId;
      updateData.approved_at = new Date();
    } else if (status === 'rejected' && userId) {
      updateData.rejected_by = userId;
      updateData.rejected_at = new Date();
    }

    return this.prisma.projectWatchlistPackage.update({
      where: {
        id: projectWatchlistId,
      },
      data: updateData,
    });
  }

  async addWatchlistComment(projectWatchlistId: string, userId: string, comment: string) {
    return this.prisma.watchlistComment.create({
      data: {
        project_watchlist_package_id: projectWatchlistId,
        user_id: userId,
        comment: comment,
      },
    });
  }

  // REMOVED: Old watchlist approval/comment methods - replaced with new Packages system

  async updateProject(projectId: string, updateProjectDto: UpdateProjectDto) {
    return this.prisma.project.update({
      where: { id: projectId },
      data: {
        name: updateProjectDto.name,
        description: updateProjectDto.description,
        license: updateProjectDto.license,
        vulnerability_notifications: updateProjectDto.vulnerability_notifications,
        license_notifications: updateProjectDto.license_notifications,
        health_notifications: updateProjectDto.health_notifications,
        anomalies_notifications: updateProjectDto.anomalies_notifications,
      },
    });
  }

  async updateProjectStatus(projectId: string, status: string, errorMessage?: string) {
    return this.prisma.project.update({
      where: { id: projectId },
      data: {
        status,
        error_message: errorMessage,
      },
    });
  }

  // CLI-specific methods
  async getProjectsForCli() {
    return this.prisma.project.findMany({
      where: {
        // For now, return all projects accessible via CLI
        // You might want to add filtering based on visibility or other criteria
      },
      select: {
        id: true,
        name: true,
        description: true,
        created_at: true,
        updated_at: true,
      },
    });
  }

  async deleteProject(projectId: string) {
    // First, get the project with its monitored branch
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        monitoredBranch: true,
      },
    });

    if (!project) {
      throw new Error('Project not found');
    }

    // Check if this is the only project using this monitored branch
    const projectsUsingBranch = await this.prisma.project.count({
      where: {
        monitored_branch_id: project.monitoredBranch.id,
      },
    });

    // Delete the project (this will cascade delete project users and project watchlist)
    await this.prisma.project.delete({
      where: { id: projectId },
    });

    // If this was the only project using the monitored branch, delete the branch and its dependencies
    if (projectsUsingBranch === 1) {
      await this.prisma.monitoredBranch.delete({
        where: { id: project.monitoredBranch.id },
      });
    }

    return { success: true, deletedBranch: projectsUsingBranch === 1 };
  }
}
