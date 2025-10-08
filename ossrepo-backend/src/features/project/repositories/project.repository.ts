import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { CreateProjectDto } from '../dto/create-project.dto';

@Injectable()
export class ProjectRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createProject(createProjectDto: CreateProjectDto) {
    // First, find or create a MonitoredBranch
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

    // Then create the project with reference to the MonitoredBranch
    return this.prisma.project.create({
      data: {
        name: createProjectDto.name,
        description: createProjectDto.description,
        monitored_branch_id: monitoredBranch.id,
      },
    });
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
    return this.prisma.project.findUnique({
      where: {
        id: projectId,
      },
      include: {
        monitoredBranch: true,
      },
    });
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

  async getBranchDependencies(monitoredBranchId: string) {
    return this.prisma.branchDependency.findMany({
      where: {
        monitored_branch_id: monitoredBranchId,
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
    // Check if repository is already in project watchlist
    const existing = await this.prisma.projectWatchlist.findUnique({
      where: {
        project_id_repo_url: {
          project_id: projectId,
          repo_url: repoUrl,
        },
      },
    });

    if (existing) {
      return existing;
    }

    // Add repository to project watchlist
    return this.prisma.projectWatchlist.create({
      data: {
        project_id: projectId,
        user_id: userId,
        repo_url: repoUrl,
        name,
        status: 'pending',
      },
    });
  }

  async getProjectWatchlist(projectId: string) {
    return this.prisma.projectWatchlist.findMany({
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
      orderBy: {
        added_at: 'desc',
      },
    });
  }

  async getProjectWatchlistReview(projectWatchlistId: string) {
    return this.prisma.projectWatchlist.findUnique({
      where: {
        id: projectWatchlistId,
      },
      include: {
        user: {
          select: {
            user_id: true,
            name: true,
            email: true,
          },
        },
        approvals: {
          include: {
            user: {
              select: {
                user_id: true,
                name: true,
                email: true,
              },
            },
          },
        },
        disapprovals: {
          include: {
            user: {
              select: {
                user_id: true,
                name: true,
                email: true,
              },
            },
          },
        },
        comments: {
          include: {
            user: {
              select: {
                user_id: true,
                name: true,
                email: true,
              },
            },
          },
          orderBy: {
            created_at: 'desc',
          },
        },
      },
    });
  }

  async addApproval(projectWatchlistId: string, userId: string) {
    return this.prisma.projectWatchlistApproval.upsert({
      where: {
        project_watchlist_id_user_id: {
          project_watchlist_id: projectWatchlistId,
          user_id: userId,
        },
      },
      update: {
        approved_at: new Date(),
      },
      create: {
        project_watchlist_id: projectWatchlistId,
        user_id: userId,
      },
    });
  }

  async addDisapproval(projectWatchlistId: string, userId: string) {
    return this.prisma.projectWatchlistDisapproval.upsert({
      where: {
        project_watchlist_id_user_id: {
          project_watchlist_id: projectWatchlistId,
          user_id: userId,
        },
      },
      update: {
        disapproved_at: new Date(),
      },
      create: {
        project_watchlist_id: projectWatchlistId,
        user_id: userId,
      },
    });
  }

  async addComment(projectWatchlistId: string, userId: string, comment: string) {
    return this.prisma.projectWatchlistComment.create({
      data: {
        project_watchlist_id: projectWatchlistId,
        user_id: userId,
        comment,
      },
    });
  }
}
