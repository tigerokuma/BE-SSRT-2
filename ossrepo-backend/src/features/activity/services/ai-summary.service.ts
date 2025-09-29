import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

export interface RepositoryData {
  name: string;
  description?: string;
  stars?: number;
  forks?: number;
  contributors?: number;
  language?: string;
  topics?: string[];
  lastCommitDate?: Date;
  commitCount?: number;
  busFactor?: number;
  riskScore?: number;
  readmeContent?: string;
  recentCommits?: Array<{
    message: string;
    author: string;
    date: Date;
    filesChanged: number;
  }>;
}

export interface CommitData {
  sha: string;
  message: string;
  author: string;
  email: string;
  timestamp: Date;
  filesChanged: number;
  linesAdded: number;
  linesDeleted: number;
}

export interface AISummaryResult {
  summary: string;
  confidence: number;
  generatedAt: Date;
  modelUsed: string;
  promptLength?: number;
  outputLength?: number;
  generationTimeMs?: number;
}

@Injectable()
export class AISummaryService {
  private readonly logger = new Logger(AISummaryService.name);
  private readonly modelName = 'gemma2:2b';
  private readonly maxSummaryLength = 300;

  constructor() {
    this.initializeModel();
  }

  private async initializeModel() {
    try {
      await this.checkOllamaAvailability();
      await this.ensureModelDownloaded();
      this.logger.log('✅ AI Summary service initialized with Mistral model');
    } catch (error) {
      this.logger.warn(
        '⚠️ AI Summary service initialization failed, will use fallback summaries',
        error,
      );
    }
  }

  private async checkOllamaAvailability(): Promise<boolean> {
    try {
      const envPath = process.env.OLLAMA_PATH;
      const ollamaPath =
        envPath || (process.platform === 'win32' ? 'ollama.exe' : 'ollama');
      await execAsync(`"${ollamaPath}" --version`);
      return true;
    } catch (error) {
      this.logger.warn(
        'Ollama not found. Please install Ollama to enable AI summaries.',
      );
      return false;
    }
  }

  private async ensureModelDownloaded(): Promise<void> {
    try {
      const envPath = process.env.OLLAMA_PATH;
      const ollamaPath =
        envPath || (process.platform === 'win32' ? 'ollama.exe' : 'ollama');
      const { stdout } = await execAsync(`"${ollamaPath}" list`);
      if (!stdout.includes(this.modelName)) {
        this.logger.log(`📥 Downloading ${this.modelName} model...`);
        await execAsync(`"${ollamaPath}" pull ${this.modelName}`);
        this.logger.log(`✅ ${this.modelName} model downloaded successfully`);
      } else {
        this.logger.log(`✅ ${this.modelName} model already available`);
      }
    } catch (error) {
      this.logger.error('Failed to download model:', error);
      throw error;
    }
  }

  async generateRepositorySummary(
    repoData: RepositoryData,
  ): Promise<AISummaryResult> {
    try {
      const prompt = this.buildSummaryPrompt(repoData);
      const startTime = Date.now();
      const summary = await this.generateWithMistral(prompt);
      const generationTimeMs = Date.now() - startTime;

      return {
        summary: summary,
        confidence: this.calculateConfidence(repoData),
        generatedAt: new Date(),
        modelUsed: this.modelName,
        promptLength: prompt.length,
        outputLength: summary.length,
        generationTimeMs,
      };
    } catch (error) {
      this.logger.error(
        'Failed to generate AI summary, using fallback:',
        error,
      );
      return this.generateFallbackSummary(repoData);
    }
  }

  private buildSummaryPrompt(repoData: RepositoryData): string {
    const cleanDescription = (repoData.description || 'No description')
      .replace(/[^\w\s.,!?-]/g, ' ')
      .substring(0, 200);
    const cleanRecentCommits =
      repoData.recentCommits
        ?.slice(0, 3)
        .map(
          (commit) =>
            `${commit.message.replace(/[^\w\s.,!?-]/g, ' ').substring(0, 100)} (${commit.author})`,
        )
        .join('; ') || 'No recent commits';

    const context = `Repository: ${repoData.name}
Description: ${cleanDescription}
Stars: ${repoData.stars || 0}
Forks: ${repoData.forks || 0}
Contributors: ${repoData.contributors || 0}
Language: ${repoData.language || 'Unknown'}
Bus Factor: ${repoData.busFactor || 'Unknown'}
Recent Activity: ${cleanRecentCommits}

Generate a comprehensive 3-4 sentence summary of this repository highlighting what it does, its activity level, community health, and notable characteristics. Focus on practical insights for developers considering using this package.`;

    return context;
  }

  private async generateWithMistral(prompt: string): Promise<string> {
    try {
      // Check for environment variable first
      const envPath = process.env.OLLAMA_PATH;
      const ollamaPath =
        envPath || (process.platform === 'win32' ? 'ollama.exe' : 'ollama');

      this.logger.log(
        `🔍 Executing Ollama: ${ollamaPath} run ${this.modelName}`,
      );
      this.logger.log(`🔍 Prompt length: ${prompt.length} characters`);

      const fs = require('fs');
      const os = require('os');
      const path = require('path');

      const tempFile = path.join(
        os.tmpdir(),
        `ollama-prompt-${Date.now()}.txt`,
      );
      fs.writeFileSync(tempFile, prompt, 'utf8');

      const command = `"${ollamaPath}" run ${this.modelName} < "${tempFile}"`;

      const { stdout, stderr } = await execAsync(command, {
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      });

      if (stderr) {
        this.logger.warn(`⚠️ Ollama stderr: ${stderr}`);
      }

      if (!stdout || typeof stdout !== 'string') {
        this.logger.error('❌ Ollama returned empty or invalid stdout');
        throw new Error('AI model returned empty response');
      }

      this.logger.log(`📝 Raw AI output length: ${stdout.length} characters`);
      this.logger.log(
        `📝 Raw AI output preview: ${stdout.substring(0, 100)}...`,
      );

      const cleanOutput = this.cleanMistralOutput(stdout);
      this.logger.log(
        `✅ Ollama execution successful, cleaned output length: ${cleanOutput.length}`,
      );

      try {
        fs.unlinkSync(tempFile);
      } catch (error) {
        this.logger.warn(`⚠️ Failed to clean up temp file: ${error.message}`);
      }

      return cleanOutput;
    } catch (error) {
      this.logger.error(`❌ Ollama execution failed: ${error.message}`);

      if (error.message.includes('timeout')) {
        this.logger.error(
          '❌ AI model timed out - consider increasing timeout or using a faster model',
        );
      } else if (error.message.includes('ENOENT')) {
        this.logger.error(
          '❌ Ollama not found - check if Ollama is installed and in PATH',
        );
      } else if (error.message.includes('empty response')) {
        this.logger.error(
          '❌ AI model returned empty response - check model availability',
        );
      }

      throw error;
    }
  }

  private cleanMistralOutput(output: string): string {
    if (!output || typeof output !== 'string') {
      this.logger.warn('Received empty or invalid output from AI model');
      return 'No summary available.';
    }

    const cleaned = output
      .replace(/^[^a-zA-Z]*/, '')
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleaned || cleaned.length === 0) {
      this.logger.warn('Output was empty after cleaning');
      return 'No summary available.';
    }

    this.logger.log(`Cleaned AI output: ${cleaned.length} characters`);
    return cleaned;
  }

  private calculateConfidence(repoData: RepositoryData): number {
    let score = 0;
    let total = 0;

    if (repoData.description) {
      score += 1;
      total += 1;
    }
    if (repoData.stars !== undefined) {
      score += 1;
      total += 1;
    }
    if (repoData.forks !== undefined) {
      score += 1;
      total += 1;
    }
    if (repoData.contributors !== undefined) {
      score += 1;
      total += 1;
    }
    if (repoData.language) {
      score += 1;
      total += 1;
    }
    if (repoData.topics && repoData.topics.length > 0) {
      score += 1;
      total += 1;
    }
    if (repoData.readmeContent) {
      score += 1;
      total += 1;
    }
    if (repoData.recentCommits && repoData.recentCommits.length > 0) {
      score += 1;
      total += 1;
    }

    return total > 0 ? score / total : 0;
  }

  private truncateSummary(summary: string): string {
    if (summary.length <= this.maxSummaryLength) {
      return summary;
    }
    return summary.substring(0, this.maxSummaryLength - 3) + '...';
  }

  private generateFallbackSummary(repoData: RepositoryData): AISummaryResult {
    let summary = `${repoData.name} is a software repository`;

    if (repoData.description) {
      summary += ` that ${repoData.description.toLowerCase()}`;
    } else if (repoData.language) {
      summary += ` written in ${repoData.language}`;
    }

    if (repoData.stars && repoData.stars > 100) {
      summary += `. It has gained popularity with ${repoData.stars.toLocaleString()} stars`;
    }

    if (repoData.contributors && repoData.contributors > 5) {
      summary += ` and is maintained by ${repoData.contributors} contributors`;
    }

    summary += '.';

    return {
      summary: summary,
      confidence: 0.3,
      generatedAt: new Date(),
      modelUsed: 'fallback',
    };
  }

  async testModelConnection(): Promise<boolean> {
    try {
      const testPrompt = 'Generate a one-sentence summary of this test.';
      await this.generateWithMistral(testPrompt);
      return true;
    } catch (error) {
      this.logger.error('Model connection test failed:', error);
      return false;
    }
  }

  async generateCommitSummary(
    commits: CommitData[],
    repoName: string,
  ): Promise<AISummaryResult> {
    try {
      if (commits.length === 0) {
        return {
          summary: 'No recent commits found to summarize.',
          confidence: 1.0,
          generatedAt: new Date(),
          modelUsed: 'fallback',
        };
      }

      const prompt = this.buildCommitSummaryPrompt(commits, repoName);
      const startTime = Date.now();
      const summary = await this.generateWithMistral(prompt);
      const generationTimeMs = Date.now() - startTime;

      return {
        summary: this.cleanMistralOutput(summary),
        confidence: this.calculateCommitSummaryConfidence(commits),
        generatedAt: new Date(),
        modelUsed: this.modelName,
        promptLength: prompt.length,
        outputLength: summary.length,
        generationTimeMs,
      };
    } catch (error) {
      this.logger.error('Failed to generate commit summary:', error);
      return this.generateFallbackCommitSummary(commits, repoName);
    }
  }

  private buildCommitSummaryPrompt(
    commits: CommitData[],
    repoName: string,
  ): string {
    const commitDetails = commits
      .map((commit, index) => {
        const date = commit.timestamp.toISOString().split('T')[0];
        return `${index + 1}. ${commit.message} (${commit.author}, ${date})
   - Files changed: ${commit.filesChanged}
   - Lines added: ${commit.linesAdded}, deleted: ${commit.linesDeleted}`;
      })
      .join('\n\n');

    const totalStats = commits.reduce(
      (acc, commit) => ({
        linesAdded: acc.linesAdded + commit.linesAdded,
        linesDeleted: acc.linesDeleted + commit.linesDeleted,
        filesChanged: acc.filesChanged + commit.filesChanged,
      }),
      { linesAdded: 0, linesDeleted: 0, filesChanged: 0 },
    );

    const uniqueAuthors = [...new Set(commits.map((c) => c.author))];
    const dateRange = `${commits[commits.length - 1].timestamp.toISOString().split('T')[0]} to ${commits[0].timestamp.toISOString().split('T')[0]}`;

    return `Analyze the following recent commits from the ${repoName} repository and provide a very concise summary (max 300 characters) that focuses on:

1. Main development focus (e.g., "documentation updates", "bug fixes")
2. Key patterns (e.g., "80% docs, 20% features")
3. Overall activity level

Repository: ${repoName}
Period: ${dateRange}
Total commits: ${commits.length}
Authors: ${uniqueAuthors.join(', ')}
Total changes: +${totalStats.linesAdded} -${totalStats.linesDeleted} lines, ${totalStats.filesChanged} files

Recent commits:
${commitDetails}

Summary:`;
  }

  private calculateCommitSummaryConfidence(commits: CommitData[]): number {
    if (commits.length === 0) return 0;

    let score = 0;
    const total = commits.length;

    for (const commit of commits) {
      if (commit.message && commit.message.length > 5) score += 1;
      if (commit.author && commit.author.length > 0) score += 1;
      if (commit.timestamp) score += 1;
      if (commit.filesChanged >= 0) score += 1;
      if (commit.linesAdded >= 0) score += 1;
      if (commit.linesDeleted >= 0) score += 1;
    }

    return score / (total * 6);
  }

  private generateFallbackCommitSummary(
    commits: CommitData[],
    repoName: string,
  ): AISummaryResult {
    if (commits.length === 0) {
      return {
        summary: 'No recent commits found to summarize.',
        confidence: 1.0,
        generatedAt: new Date(),
        modelUsed: 'fallback',
      };
    }

    const totalStats = commits.reduce(
      (acc, commit) => ({
        linesAdded: acc.linesAdded + commit.linesAdded,
        linesDeleted: acc.linesDeleted + commit.linesDeleted,
        filesChanged: acc.filesChanged + commit.filesChanged,
      }),
      { linesAdded: 0, linesDeleted: 0, filesChanged: 0 },
    );

    const uniqueAuthors = [...new Set(commits.map((c) => c.author))];
    const summary = `Recent activity in ${repoName}: ${commits.length} commits by ${uniqueAuthors.length} authors, with ${totalStats.linesAdded} lines added and ${totalStats.linesDeleted} lines deleted across ${totalStats.filesChanged} files.`;

    return {
      summary: this.truncateSummary(summary),
      confidence: 0.3,
      generatedAt: new Date(),
      modelUsed: 'fallback',
    };
  }
}
