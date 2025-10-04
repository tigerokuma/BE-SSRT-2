import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { CreateProjectDto } from '../dto/create-project.dto';

@Injectable()
export class ProjectRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createProject(createProjectDto: CreateProjectDto) {
    return this.prisma.project.create({
      data: {
        name: createProjectDto.name,
        // Note: We'll add description and repositoryUrl fields to the schema later
        // For now, we'll just create the basic project
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

  async createProjectUser(projectId: string, userId: string, role: string = 'admin') {
    return this.prisma.projectUser.create({
      data: {
        project_id: projectId,
        user_id: userId,
        role,
      },
    });
  }
}
