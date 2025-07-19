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
  private readonly modelName = 'gemma2:2b'; // Fast, efficient 2B parameter model
  private readonly maxSummaryLength = 200; // Characters

  constructor() {
    this.initializeModel();
  }

  private async initializeModel() {
    try {
      // Check if Ollama is installed and the model is available
      await this.checkOllamaAvailability();
      await this.ensureModelDownloaded();
      this.logger.log('✅ AI Summary service initialized with Mistral model');
    } catch (error) {
      this.logger.warn('⚠️ AI Summary service initialization failed, will use fallback summaries', error);
    }
  }

  private async checkOllamaAvailability(): Promise<boolean> {
    try {
      await execAsync('ollama --version');
      return true;
    } catch (error) {
      this.logger.warn('Ollama not found. Please install Ollama to enable AI summaries.');
      return false;
    }
  }

  private async ensureModelDownloaded(): Promise<void> {
    try {
      // Check if model is already downloaded
      const { stdout } = await execAsync('ollama list');
      if (!stdout.includes(this.modelName)) {
        this.logger.log(`📥 Downloading ${this.modelName} model...`);
        await execAsync(`ollama pull ${this.modelName}`);
        this.logger.log(`✅ ${this.modelName} model downloaded successfully`);
      } else {
        this.logger.log(`✅ ${this.modelName} model already available`);
      }
    } catch (error) {
      this.logger.error('Failed to download model:', error);
      throw error;
    }
  }

  async generateRepositorySummary(repoData: RepositoryData): Promise<AISummaryResult> {
    try {
      const prompt = this.buildSummaryPrompt(repoData);
      const startTime = Date.now();
      const summary = await this.generateWithMistral(prompt);
      const generationTimeMs = Date.now() - startTime;
      
      return {
        summary: this.truncateSummary(summary),
        confidence: this.calculateConfidence(repoData),
        generatedAt: new Date(),
        modelUsed: this.modelName,
        promptLength: prompt.length,
        outputLength: summary.length,
        generationTimeMs,
      };
    } catch (error) {
      this.logger.error('Failed to generate AI summary, using fallback:', error);
      return this.generateFallbackSummary(repoData);
    }
  }

  private buildSummaryPrompt(repoData: RepositoryData): string {
    // Clean and simplify the data to avoid command line issues
    const cleanDescription = (repoData.description || 'No description').replace(/[^\w\s.,!?-]/g, ' ').substring(0, 200);
    const cleanRecentCommits = repoData.recentCommits?.slice(0, 3).map(commit => 
      `${commit.message.replace(/[^\w\s.,!?-]/g, ' ').substring(0, 100)} (${commit.author})`
    ).join('; ') || 'No recent commits';
    
    const context = `Repository: ${repoData.name}
Description: ${cleanDescription}
Stars: ${repoData.stars || 0}
Forks: ${repoData.forks || 0}
Contributors: ${repoData.contributors || 0}
Language: ${repoData.language || 'Unknown'}
Bus Factor: ${repoData.busFactor || 'Unknown'}
Recent Activity: ${cleanRecentCommits}

Generate a 2-3 sentence summary of this repository highlighting what it does, its activity level, and notable characteristics. Keep under 200 characters.`;

    return context;
  }

  private async generateWithMistral(prompt: string): Promise<string> {
    try {
      // Use full path on Windows to avoid PATH issues
      const ollamaPath = process.platform === 'win32' 
        ? 'C:\\Users\\hruck\\AppData\\Local\\Programs\\Ollama\\ollama.exe'
        : 'ollama';
      
      this.logger.log(`🔍 Executing Ollama: ${ollamaPath} run ${this.modelName}`);
      this.logger.log(`🔍 Prompt length: ${prompt.length} characters`);
      
      // Use a simpler approach - write prompt to a temporary file
      const fs = require('fs');
      const os = require('os');
      const path = require('path');
      
      const tempFile = path.join(os.tmpdir(), `ollama-prompt-${Date.now()}.txt`);
      fs.writeFileSync(tempFile, prompt, 'utf8');
      
      const command = `"${ollamaPath}" run ${this.modelName} < "${tempFile}"`;
      
      const { stdout, stderr } = await execAsync(command, {
        timeout: 30000, // 30 second timeout
        maxBuffer: 1024 * 1024 // 1MB buffer
      });
      
      if (stderr) {
        this.logger.warn(`⚠️ Ollama stderr: ${stderr}`);
      }
      
      const cleanOutput = this.cleanMistralOutput(stdout);
      this.logger.log(`✅ Ollama execution successful, output length: ${cleanOutput.length}`);
      
      // Clean up temp file
      try {
        fs.unlinkSync(tempFile);
      } catch (error) {
        this.logger.warn(`⚠️ Failed to clean up temp file: ${error.message}`);
      }
      
      return cleanOutput;
    } catch (error) {
      this.logger.error(`❌ Ollama execution failed: ${error.message}`);
      throw error;
    }
  }

  private cleanMistralOutput(output: string): string {
    // Remove common prefixes and clean up the output
    let cleaned = output
      .replace(/^[^a-zA-Z]*/, '') // Remove leading non-letters
      .replace(/\n+/g, ' ') // Replace multiple newlines with single space
      .replace(/\s+/g, ' ') // Replace multiple spaces with single space
      .trim();

    // If the output is too long, truncate it
    if (cleaned.length > this.maxSummaryLength) {
      cleaned = cleaned.substring(0, this.maxSummaryLength - 3) + '...';
    }

    return cleaned;
  }

  private calculateConfidence(repoData: RepositoryData): number {
    // Calculate confidence based on data completeness
    let score = 0;
    let total = 0;

    if (repoData.description) { score += 1; total += 1; }
    if (repoData.stars !== undefined) { score += 1; total += 1; }
    if (repoData.forks !== undefined) { score += 1; total += 1; }
    if (repoData.contributors !== undefined) { score += 1; total += 1; }
    if (repoData.language) { score += 1; total += 1; }
    if (repoData.topics && repoData.topics.length > 0) { score += 1; total += 1; }
    if (repoData.readmeContent) { score += 1; total += 1; }
    if (repoData.recentCommits && repoData.recentCommits.length > 0) { score += 1; total += 1; }

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
      summary: this.truncateSummary(summary),
      confidence: 0.3, // Low confidence for fallback
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
} 