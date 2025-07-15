import { Injectable } from '@nestjs/common';
import { GitHubRepository } from 'generated/prisma';
import { PrismaService } from 'src/common/prisma/prisma.service';

@Injectable()
export class GitHubRepositoriesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByUrl(repoUrl: string): Promise<GitHubRepository | null> {
    return this.prisma.gitHubRepository.findUnique({
      where: { repo_url: repoUrl }
    });
  }

  async createOrUpdate(repoData: Partial<GitHubRepository>): Promise<GitHubRepository> {
    return this.prisma.gitHubRepository.upsert({
      where: { repo_url: repoData.repo_url! },
      update: {
        repo_name: repoData.repo_name,
        owner: repoData.owner,
        stars: repoData.stars,
        forks: repoData.forks,
        contributors: repoData.contributors,
        topics: repoData.topics || [],
        pushed_at: repoData.pushed_at,
        created_at: repoData.created_at,
        updated_at: repoData.updated_at,
        default_branch: repoData.default_branch,
        language: repoData.language,
        fetched_at: new Date()
      },
      create: {
        repo_url: repoData.repo_url!,
        repo_name: repoData.repo_name,
        owner: repoData.owner,
        stars: repoData.stars,
        forks: repoData.forks,
        contributors: repoData.contributors,
        topics: repoData.topics || [],
        pushed_at: repoData.pushed_at,
        created_at: repoData.created_at,
        updated_at: repoData.updated_at,
        default_branch: repoData.default_branch,
        language: repoData.language,
        fetched_at: new Date()
      }
    });
  }

  async isDataFresh(fetchedAt: Date | null): Promise<boolean> {
    if (!fetchedAt) return false;
    const hoursAgo = (Date.now() - fetchedAt.getTime()) / (1000 * 60 * 60);
    return hoursAgo < 6; // GitHub data is fresher for 6 hours (more dynamic)
  }

  async getStaleRepositories(limit: number = 10): Promise<GitHubRepository[]> {
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
    
    return this.prisma.gitHubRepository.findMany({
      where: {
        fetched_at: { lt: sixHoursAgo }
      },
      orderBy: { fetched_at: 'asc' },
      take: limit
    });
  }
} 