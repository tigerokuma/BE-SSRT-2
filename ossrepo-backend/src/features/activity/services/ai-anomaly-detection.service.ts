import { Injectable, Logger } from '@nestjs/common';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface CommitAnalysisData {
  sha: string;
  author: string;
  email: string;
  message: string;
  date: Date;
  linesAdded?: number;
  linesDeleted?: number;
  filesChanged?: string[];
  contributorStats?: {
    avgLinesAdded: number;
    avgLinesDeleted: number;
    avgFilesChanged: number;
    stddevLinesAdded: number;
    stddevLinesDeleted: number;
    stddevFilesChanged: number;
    totalCommits: number;
    commitTimeHistogram?: Record<string, number>;
  };
  repoStats?: {
    avgLinesAdded: number;
    avgLinesDeleted: number;
    avgFilesChanged: number;
    totalCommits: number;
    totalContributors: number;
  };
}

interface AnomalyDetectionResult {
  isAnomalous: boolean;
  confidence: number;
  reasoning: string;
  riskLevel: 'low' | 'moderate' | 'high' | 'critical';
  suspiciousFactors: string[];
}

@Injectable()
export class AIAnomalyDetectionService {
  private readonly logger = new Logger(AIAnomalyDetectionService.name);
  private readonly modelName = 'gemma2:2b';
  private readonly maxPromptLength = 2000; // Characters

  constructor() {
    this.initializeModel();
  }

  private async initializeModel() {
    try {
      await this.checkOllamaAvailability();
      await this.ensureModelDownloaded();
      this.logger.log('✅ AI Anomaly Detection service initialized with Gemma2:2b model');
    } catch (error) {
      this.logger.warn(
        '⚠️ AI Anomaly Detection service initialization failed, will use fallback detection',
        error,
      );
    }
  }

  private async checkOllamaAvailability(): Promise<void> {
    try {
      const ollamaPath = this.getOllamaPath();
      await execAsync(`"${ollamaPath}" --version`);
    } catch (error) {
      throw new Error(`Ollama not available: ${error.message}`);
    }
  }

  private getOllamaPath(): string {
    return process.platform === 'win32'
      ? 'C:\\Users\\hruck\\AppData\\Local\\Programs\\Ollama\\ollama.exe'
      : 'ollama';
  }

  private async ensureModelDownloaded(): Promise<void> {
    try {
      const ollamaPath = this.getOllamaPath();
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

  /**
   * Analyze a commit for suspicious activity using AI
   */
  async analyzeCommitForAnomalies(data: CommitAnalysisData): Promise<AnomalyDetectionResult> {
    try {
      const prompt = this.buildAnomalyDetectionPrompt(data);
      const startTime = Date.now();
      const response = await this.generateWithGemma(prompt);
      const generationTimeMs = Date.now() - startTime;

      const result = this.parseAnomalyResponse(response);
      
      this.logger.log(
        `🔍 AI Anomaly Analysis for commit ${data.sha}: ${result.isAnomalous ? '🚨 ANOMALOUS' : '✅ Normal'} (confidence: ${result.confidence})`,
      );

      return result;
    } catch (error) {
      this.logger.error(
        'Failed to analyze commit with AI, using fallback detection:',
        error,
      );
      return this.fallbackAnomalyDetection(data);
    }
  }

  private buildAnomalyDetectionPrompt(data: CommitAnalysisData): string {
    const cleanMessage = (data.message || 'No message')
      .replace(/[^\w\s.,!?-]/g, ' ')
      .substring(0, 200);

    const filesChanged = data.filesChanged?.length || 0;
    const totalLines = (data.linesAdded || 0) + (data.linesDeleted || 0);
    
    let prompt = `Analyze this git commit for suspicious or anomalous activity. Consider:

COMMIT DATA:
- SHA: ${data.sha}
- Author: ${data.author} (${data.email})
- Message: "${cleanMessage}"
- Date: ${data.date.toISOString()}
- Files changed: ${filesChanged}
- Lines added: ${data.linesAdded || 0}
- Lines deleted: ${data.linesDeleted || 0}
- Total lines changed: ${totalLines}`;

    if (data.contributorStats) {
      const stats = data.contributorStats;
      prompt += `

CONTRIBUTOR HISTORY:
- Average lines per commit: ${(stats.avgLinesAdded + stats.avgLinesDeleted).toFixed(1)}
- Average files per commit: ${stats.avgFilesChanged.toFixed(1)}
- Total commits by this author: ${stats.totalCommits}
- Standard deviation (lines): ${(stats.stddevLinesAdded + stats.stddevLinesDeleted).toFixed(1)}
- Standard deviation (files): ${stats.stddevFilesChanged.toFixed(1)}`;
    }

    if (data.repoStats) {
      const stats = data.repoStats;
      prompt += `

REPOSITORY CONTEXT:
- Repository average lines per commit: ${(stats.avgLinesAdded + stats.avgLinesDeleted).toFixed(1)}
- Repository average files per commit: ${stats.avgFilesChanged.toFixed(1)}
- Total repository commits: ${stats.totalCommits}
- Total contributors: ${stats.totalContributors}`;
    }

    prompt += `

SUSPICIOUS INDICATORS TO CHECK:
1. Unusually large changes (many files/lines)
2. Changes outside normal hours for this contributor
3. Unusual file types or patterns
4. Suspicious commit messages
5. Changes that deviate significantly from contributor's history
6. Changes that are much larger than repository average

Respond with JSON format:
{
  "isAnomalous": true/false,
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation",
  "riskLevel": "low/moderate/high/critical",
  "suspiciousFactors": ["factor1", "factor2"]
}`;

    return prompt;
  }

  private async generateWithGemma(prompt: string): Promise<string> {
    try {
      const ollamaPath = this.getOllamaPath();
      const fs = require('fs');
      const os = require('os');
      const path = require('path');

      this.logger.log(`🔍 Executing Ollama for anomaly detection: ${ollamaPath} run ${this.modelName}`);
      this.logger.log(`🔍 Prompt length: ${prompt.length} characters`);

      const tempFile = path.join(
        os.tmpdir(),
        `ollama-anomaly-${Date.now()}.txt`,
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

      // Validate stdout before processing
      if (!stdout || typeof stdout !== 'string') {
        this.logger.error('❌ Ollama returned empty or invalid stdout for anomaly detection');
        throw new Error('AI model returned empty response for anomaly detection');
      }

      this.logger.log(`📝 Raw AI anomaly response length: ${stdout.length} characters`);
      this.logger.log(`📝 Raw AI anomaly response preview: ${stdout.substring(0, 100)}...`);

      const cleanOutput = this.cleanGemmaOutput(stdout);
      this.logger.log(`✅ Ollama anomaly detection successful, cleaned output length: ${cleanOutput.length}`);

      // Clean up temp file
      try {
        fs.unlinkSync(tempFile);
      } catch (error) {
        this.logger.warn(`⚠️ Failed to clean up temp file: ${error.message}`);
      }

      return cleanOutput;
    } catch (error) {
      this.logger.error(`❌ Ollama anomaly detection failed: ${error.message}`);
      
      // Provide more context for debugging
      if (error.message.includes('timeout')) {
        this.logger.error('❌ AI model timed out for anomaly detection - consider increasing timeout');
      } else if (error.message.includes('ENOENT')) {
        this.logger.error('❌ Ollama not found for anomaly detection - check if Ollama is installed');
      } else if (error.message.includes('empty response')) {
        this.logger.error('❌ AI model returned empty response for anomaly detection');
      }
      
      throw error;
    }
  }

  private cleanGemmaOutput(output: string): string {
    // Remove common prefixes and clean up the output
    return output
      .replace(/^```json\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .replace(/^Here's the analysis:\s*/i, '')
      .replace(/^Analysis:\s*/i, '')
      .trim();
  }

  private parseAnomalyResponse(response: string): AnomalyDetectionResult {
    try {
      if (!response || typeof response !== 'string') {
        this.logger.warn('Received empty or invalid response from AI model');
        return this.fallbackAnomalyDetection({} as CommitAnalysisData);
      }

      this.logger.log(`📝 Raw AI response length: ${response.length} characters`);
      this.logger.log(`📝 Raw AI response preview: ${response.substring(0, 100)}...`);

      // Try to extract JSON from the response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          const result = {
            isAnomalous: parsed.isAnomalous || false,
            confidence: Math.max(0, Math.min(1, parsed.confidence || 0.5)),
            reasoning: parsed.reasoning || 'No reasoning provided',
            riskLevel: this.validateRiskLevel(parsed.riskLevel),
            suspiciousFactors: Array.isArray(parsed.suspiciousFactors) ? parsed.suspiciousFactors : [],
          };
          
          this.logger.log(`✅ Successfully parsed JSON response: ${result.isAnomalous ? 'ANOMALOUS' : 'Normal'}`);
          return result;
        } catch (jsonError) {
          this.logger.warn(`Failed to parse JSON from response: ${jsonError.message}`);
        }
      }

      // Fallback parsing for non-JSON responses
      const isAnomalous = response.toLowerCase().includes('anomalous') || 
                         response.toLowerCase().includes('suspicious') ||
                         response.toLowerCase().includes('unusual') ||
                         response.toLowerCase().includes('concerning');
      
      const result: AnomalyDetectionResult = {
        isAnomalous,
        confidence: 0.6,
        reasoning: response.substring(0, 200),
        riskLevel: isAnomalous ? 'moderate' : 'low',
        suspiciousFactors: isAnomalous ? ['AI detected suspicious patterns'] : [],
      };
      
      this.logger.log(`📝 Using fallback parsing: ${result.isAnomalous ? 'ANOMALOUS' : 'Normal'}`);
      return result;
    } catch (error) {
      this.logger.error('Failed to parse AI response:', error);
      return this.fallbackAnomalyDetection({} as CommitAnalysisData);
    }
  }

  private validateRiskLevel(level: string): 'low' | 'moderate' | 'high' | 'critical' {
    const validLevels = ['low', 'moderate', 'high', 'critical'];
    return validLevels.includes(level?.toLowerCase()) ? level.toLowerCase() as any : 'low';
  }

  private fallbackAnomalyDetection(data: CommitAnalysisData): AnomalyDetectionResult {
    // Simple heuristic-based fallback detection
    const totalLines = (data.linesAdded || 0) + (data.linesDeleted || 0);
    const filesChanged = data.filesChanged?.length || 0;
    
    let isAnomalous = false;
    let suspiciousFactors: string[] = [];
    let riskLevel: 'low' | 'moderate' | 'high' | 'critical' = 'low';

    // Check for unusually large commits
    if (totalLines > 1000) {
      isAnomalous = true;
      suspiciousFactors.push('Very large commit (>1000 lines)');
      riskLevel = 'high';
    } else if (totalLines > 500) {
      isAnomalous = true;
      suspiciousFactors.push('Large commit (>500 lines)');
      riskLevel = 'moderate';
    }

    // Check for many files changed
    if (filesChanged > 50) {
      isAnomalous = true;
      suspiciousFactors.push('Many files changed (>50)');
      riskLevel = riskLevel === 'high' ? 'critical' : 'high';
    } else if (filesChanged > 20) {
      isAnomalous = true;
      suspiciousFactors.push('Many files changed (>20)');
      riskLevel = riskLevel === 'high' ? 'critical' : 'moderate';
    }

    // Check contributor history if available
    if (data.contributorStats) {
      const avgLines = data.contributorStats.avgLinesAdded + data.contributorStats.avgLinesDeleted;
      const stddev = data.contributorStats.stddevLinesAdded + data.contributorStats.stddevLinesDeleted;
      const threshold = avgLines + (2 * stddev);
      
      if (totalLines > threshold) {
        isAnomalous = true;
        suspiciousFactors.push('Unusual for this contributor');
        riskLevel = riskLevel === 'high' ? 'critical' : 'moderate';
      }
    }

    return {
      isAnomalous,
      confidence: 0.7,
      reasoning: `Fallback detection: ${isAnomalous ? 'Suspicious patterns detected' : 'No obvious anomalies'}`,
      riskLevel,
      suspiciousFactors,
    };
  }

  async testModelConnection(): Promise<boolean> {
    try {
      const testData: CommitAnalysisData = {
        sha: 'test123',
        author: 'Test User',
        email: 'test@example.com',
        message: 'Test commit',
        date: new Date(),
        linesAdded: 10,
        linesDeleted: 5,
        filesChanged: ['test.txt'],
      };
      
      await this.analyzeCommitForAnomalies(testData);
      return true;
    } catch (error) {
      this.logger.error('Model connection test failed:', error);
      return false;
    }
  }
} 