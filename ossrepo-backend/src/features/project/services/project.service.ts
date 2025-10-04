import { Injectable } from '@nestjs/common';
import { ProjectRepository } from '../repositories/project.repository';
import { CreateProjectDto } from '../dto/create-project.dto';

@Injectable()
export class ProjectService {
  constructor(private readonly projectRepository: ProjectRepository) {}

  async createProject(createProjectDto: CreateProjectDto) {
    // First create the project
    const project = await this.projectRepository.createProject(createProjectDto);
    
    // Then associate the user with the project
    await this.projectRepository.createProjectUser(project.id, createProjectDto.userId, 'admin');

    return project;
  }

  async getProjectsByUserId(userId: string) {
    return this.projectRepository.getProjectsByUserId(userId);
  }

  async getProjectById(projectId: string) {
    return this.projectRepository.getProjectById(projectId);
  }
}
