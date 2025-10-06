import { Injectable } from '@nestjs/common';
import { ProjectRepository } from '../repositories/project.repository';
import { CreateProjectDto } from '../dto/create-project.dto';
import { GitHubService } from 'src/common/github/github.service';

@Injectable()
export class ProjectService {
  constructor(
    private readonly projectRepository: ProjectRepository,
    private readonly githubService: GitHubService,
  ) {}

  async createProject(createProjectDto: CreateProjectDto) {
    // First create the project
    const project = await this.projectRepository.createProject(createProjectDto);
    
    // Then associate the user with the project
    await this.projectRepository.createProjectUser(project.id, createProjectDto.userId, 'admin');

    // If repository URL is provided, analyze dependencies
    if (createProjectDto.repositoryUrl) {
      try {
        const dependencies = await this.githubService.extractDependencies(createProjectDto.repositoryUrl);
        await this.projectRepository.createProjectDependencies(project.id, dependencies);
      } catch (error) {
        console.error('Error analyzing dependencies:', error);
        // Don't fail project creation if dependency analysis fails
      }
    }

    return project;
  }

  async getProjectsByUserId(userId: string) {
    return this.projectRepository.getProjectsByUserId(userId);
  }

  async getProjectById(projectId: string) {
    return this.projectRepository.getProjectById(projectId);
  }

  async getProjectUsers(projectId: string) {
    return this.projectRepository.getProjectUsers(projectId);
  }

  async getProjectDependencies(projectId: string) {
    return this.projectRepository.getProjectDependencies(projectId);
  }

  async getWatchlistDependencies(projectId: string) {
    return this.projectRepository.getWatchlistDependencies(projectId);
  }

  async refreshProjectDependencies(projectId: string) {
    // Get the project to access its repository URL
    const project = await this.projectRepository.getProjectById(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    if (!project.repository_url) {
      throw new Error('Project has no repository URL');
    }

    try {
      // Extract dependencies from the repository
      const dependencies = await this.githubService.extractDependencies(project.repository_url);
      
      // Clear existing dependencies and add new ones
      await this.projectRepository.clearProjectDependencies(projectId);
      await this.projectRepository.createProjectDependencies(projectId, dependencies);
      
      return {
        message: 'Dependencies refreshed successfully',
        dependencies: dependencies,
      };
    } catch (error) {
      console.error('Error refreshing dependencies:', error);
      throw new Error(`Failed to refresh dependencies: ${error.message}`);
    }
  }

  async getUserRoleInProject(projectId: string, userId: string) {
    return this.projectRepository.getUserRoleInProject(projectId, userId);
  }

  async joinProject(projectId: string, userId: string = 'user-abc') {
    // Check if project exists
    const project = await this.projectRepository.getProjectById(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    // Add user to project as a member (non-admin)
    return this.projectRepository.addUserToProject(projectId, userId, 'member');
  }

  async addToProjectWatchlist(projectId: string, userId: string, repoUrl: string, name: string) {
    return this.projectRepository.addToProjectWatchlist(projectId, userId, repoUrl, name);
  }

  async getProjectWatchlist(projectId: string) {
    return this.projectRepository.getProjectWatchlist(projectId);
  }

  async getProjectWatchlistReview(projectWatchlistId: string) {
    return this.projectRepository.getProjectWatchlistReview(projectWatchlistId);
  }

  async addApproval(projectWatchlistId: string, userId: string) {
    return this.projectRepository.addApproval(projectWatchlistId, userId);
  }

  async addDisapproval(projectWatchlistId: string, userId: string) {
    return this.projectRepository.addDisapproval(projectWatchlistId, userId);
  }

  async addComment(projectWatchlistId: string, userId: string, comment: string) {
    return this.projectRepository.addComment(projectWatchlistId, userId, comment);
  }
}
