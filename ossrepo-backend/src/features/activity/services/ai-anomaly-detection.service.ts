import { Injectable, Logger } from '@nestjs/common';
import { exec } from 'child_process';
import { promisify } from 'util';
import { PrismaService } from '../../../common/prisma/prisma.service';

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
  private readonly maxPromptLength = 2000;

  private readonly botPatterns = [
    /dependabot/i,
    /dependabot\[bot\]/i,
    /github-actions/i,
    /github-actions\[bot\]/i,
    /renovate/i,
    /greenkeeper/i,
    /snyk/i,
    /whitesource/i,
    /mergify/i,
    /tidelift/i,
    /remix run bot/i,
    /bot@/i,
    /noreply@github\.com/i,
    /actions@github\.com/i,
    /\[bot\]/i,
  ];

  constructor(private readonly prisma: PrismaService) {
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
    // Check for environment variable first
    const envPath = process.env.OLLAMA_PATH;
    if (envPath) {
      return envPath;
    }
    
    // Fallback to platform-specific defaults
    return process.platform === 'win32'
      ? 'ollama.exe'
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

  private isBotCommit(data: CommitAnalysisData): boolean {
    const author = data.author || '';
    const email = data.email || '';
    const message = data.message || '';

    for (const pattern of this.botPatterns) {
      if (pattern.test(author) || pattern.test(email)) {
        return true;
      }
    }

    const botMessagePatterns = [
      /^chore\(deps\):/i,
      /^chore\(dependencies\):/i,
      /^chore\(security\):/i,
      /^ci:/i,
      /^build:/i,
      /^chore: update/i,
      /^chore: bump/i,
      /^chore: upgrade/i,
      /^chore: renovate/i,
      /^chore: dependabot/i,
      /^build\(deps\):/i,
      /^build\(dependencies\):/i,
      /^fix\(deps\):/i,
      /^fix\(dependencies\):/i,
      /^deps:/i,
      /^dependencies:/i,
    ];

    for (const pattern of botMessagePatterns) {
      if (pattern.test(message)) {
        return true;
      }
    }

    return false;
  }

  private isMergeCommit(data: CommitAnalysisData): boolean {
    const message = data.message || '';
    
    const mergePatterns = [
      /^merge/i,
      /^merge branch/i,
      /^merge pull request/i,
      /^merge.*into/i,
      /^merge.*from/i,
    ];

    for (const pattern of mergePatterns) {
      if (pattern.test(message)) {
        return true;
      }
    }

    return false;
  }

  async analyzeCommitForAnomalies(data: CommitAnalysisData): Promise<AnomalyDetectionResult> {
    try {
      if (this.isBotCommit(data)) {
        this.logger.log(`🤖 Skipping bot commit: ${data.author}`);
        return {
          isAnomalous: false,
          confidence: 1.0,
          reasoning: 'Bot commit - automatically excluded',
          riskLevel: 'low',
          suspiciousFactors: [],
        };
      }

      if (this.isMergeCommit(data)) {
        this.logger.log(`🔄 Skipping merge commit: ${data.sha.substring(0, 8)}`);
        return {
          isAnomalous: false,
          confidence: 0.9,
          reasoning: 'Merge commit - automatically excluded',
          riskLevel: 'low',
          suspiciousFactors: [],
        };
      }

      const totalLines = (data.linesAdded || 0) + (data.linesDeleted || 0);
      
      if (totalLines < 5) {
        this.logger.log(`📝 Skipping small commit (${totalLines} lines): ${data.sha.substring(0, 8)}`);
        return {
          isAnomalous: false,
          confidence: 0.9,
          reasoning: 'Small commit - normal development activity',
          riskLevel: 'low',
          suspiciousFactors: [],
        };
      }

      if (data.contributorStats) {
        const avgLines = data.contributorStats.avgLinesAdded + data.contributorStats.avgLinesDeleted;
        const stddevLines = data.contributorStats.stddevLinesAdded + data.contributorStats.stddevLinesDeleted;
        
        if (totalLines <= avgLines + (2 * stddevLines)) {
          this.logger.log(`📝 Skipping normal-range commit (${totalLines} lines vs avg ${avgLines.toFixed(0)}): ${data.sha.substring(0, 8)}`);
          return {
            isAnomalous: false,
            confidence: 0.8,
            reasoning: 'Within normal range for this contributor',
            riskLevel: 'low',
            suspiciousFactors: [],
          };
        }
      }

      if (data.repoStats) {
        const repoAvgLines = data.repoStats.avgLinesAdded + data.repoStats.avgLinesDeleted;
        
        if (totalLines <= repoAvgLines) {
          this.logger.log(`📝 Skipping normal-range commit (${totalLines} lines vs repo avg ${repoAvgLines.toFixed(0)}): ${data.sha.substring(0, 8)}`);
          return {
            isAnomalous: false,
            confidence: 0.8,
            reasoning: 'Within normal range for this repository',
            riskLevel: 'low',
            suspiciousFactors: [],
          };
        }
      }

      this.logger.log(`🔍 Analyzing commit for anomalies: ${data.sha.substring(0, 8)} (${totalLines} lines)`);

      const prompt = this.buildAnomalyDetectionPrompt(data);
      const aiResponse = await this.generateWithGemma(prompt);
      const result = this.parseAnomalyResponse(aiResponse);

      this.logger.log(
        `📊 AI Analysis Result: ${result.isAnomalous ? 'SUSPICIOUS' : 'Normal'} (confidence: ${result.confidence})`
      );

      return result;
    } catch (error) {
      this.logger.error('Error in AI anomaly detection:', error);
      return {
        isAnomalous: false,
        confidence: 0.5,
        reasoning: 'AI analysis failed',
        riskLevel: 'low',
        suspiciousFactors: [],
      };
    }
  }

  async analyzeAndStoreAnomaly(
    watchlistId: string,
    data: CommitAnalysisData,
  ): Promise<AnomalyDetectionResult> {
    try {
      const existingAnalysis = await this.prisma.aIAnomaliesDetected.findUnique({
        where: {
          watchlist_id_commit_sha: {
            watchlist_id: watchlistId,
            commit_sha: data.sha,
          },
        },
      });

      if (existingAnalysis) {
        this.logger.log(`📋 Found existing anomaly analysis for commit ${data.sha}`);
        return existingAnalysis.anomaly_details as unknown as AnomalyDetectionResult;
      }

      const result = await this.analyzeCommitForAnomalies(data);

      if (result.isAnomalous) {
        await this.prisma.aIAnomaliesDetected.create({
          data: {
            id: crypto.randomUUID(),
            watchlist_id: watchlistId,
            commit_sha: data.sha,
            anomaly_details: result as any,
          },
        });

        this.logger.log(`💾 Stored suspicious anomaly analysis for commit ${data.sha} in database`);
      } else {
        this.logger.log(`📝 Commit ${data.sha} is normal - not storing analysis`);
      }

      return result;
    } catch (error) {
      this.logger.error('Failed to analyze and store anomaly:', error);
      return {
        isAnomalous: false,
        confidence: 0.5,
        reasoning: 'Analysis failed',
        riskLevel: 'low',
        suspiciousFactors: [],
      };
    }
  }

  async getAnomaliesForWatchlist(watchlistId: string): Promise<any[]> {
    try {
      const anomalies = await this.prisma.aIAnomaliesDetected.findMany({
        where: {
          watchlist_id: watchlistId,
        },
        orderBy: {
          detected_at: 'desc',
        },
      });

      return anomalies.map(anomaly => ({
        id: anomaly.id,
        commitSha: anomaly.commit_sha,
        anomalyDetails: anomaly.anomaly_details,
        detectedAt: anomaly.detected_at,
      }));
    } catch (error) {
      this.logger.error('Failed to get anomalies for watchlist:', error);
      return [];
    }
  }

  private buildAnomalyDetectionPrompt(data: CommitAnalysisData): string {
    const cleanMessage = (data.message || 'No message')
      .replace(/[^\w\s.,!?-]/g, ' ')
      .substring(0, 100);

    const totalLines = (data.linesAdded || 0) + (data.linesDeleted || 0);
    const filesChanged = data.filesChanged?.length || 0;
    
    const suspiciousFilePatterns: string[] = [];
    if (data.filesChanged && data.filesChanged.length > 0) {
      const files = data.filesChanged as string[];
      const configFiles = files.filter(f => 
        f.includes('config') || f.includes('.env') || f.includes('secret') || 
        f.includes('key') || f.includes('.pem') || f.includes('password')
      );
      const lockFiles = files.filter(f => 
        f.includes('package-lock.json') || f.includes('yarn.lock') || f.includes('pnpm-lock.yaml')
      );
      const unusualExtensions = files.filter(f => 
        f.includes('.exe') || f.includes('.dll') || f.includes('.so') || f.includes('.dylib')
      );
      
      if (configFiles.length > 0) suspiciousFilePatterns.push(`Config files: ${configFiles.join(', ')}`);
      if (lockFiles.length > 0) suspiciousFilePatterns.push(`Lock files: ${lockFiles.join(', ')}`);
      if (unusualExtensions.length > 0) suspiciousFilePatterns.push(`Unusual extensions: ${unusualExtensions.join(', ')}`);
    }
    
    const commitTime = new Date(data.date);
    const timeString = commitTime.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
    
    let prompt = `Analyze this commit for suspicious activity:

Author: ${data.author}
Message: "${cleanMessage}"
Lines: +${data.linesAdded || 0} -${data.linesDeleted || 0} (total: ${totalLines})
Files: ${filesChanged}${suspiciousFilePatterns.length > 0 ? '\nSuspicious file patterns: ' + suspiciousFilePatterns.join('; ') : ''}
Time: ${timeString}`;

    if (data.contributorStats) {
      const avgLines = data.contributorStats.avgLinesAdded + data.contributorStats.avgLinesDeleted;
      const stddevLines = data.contributorStats.stddevLinesAdded + data.contributorStats.stddevLinesDeleted;
      const totalCommits = data.contributorStats.totalCommits;
      
      prompt += `

Author History:
- Total commits: ${totalCommits}
- Average lines per commit: ${avgLines.toFixed(0)}
- Standard deviation: ${stddevLines.toFixed(0)}`;
      
      if (data.contributorStats.commitTimeHistogram) {
        const timeHistogram = data.contributorStats.commitTimeHistogram;
        const typicalHours = this.getTypicalCommitHours(timeHistogram);
        const isUnusual = this.isUnusualCommitTime(commitTime, timeHistogram);
        
        prompt += `
- Typical commit hours: ${typicalHours}`;
        
        if (isUnusual) {
          prompt += `
- ⚠️ UNUSUAL TIMING: Commit at ${timeString} is outside typical hours`;
        }
      }
    }

    if (data.repoStats) {
      const repoAvgLines = data.repoStats.avgLinesAdded + data.repoStats.avgLinesDeleted;
      prompt += `

Repository Average: ${repoAvgLines.toFixed(0)} lines per commit`;
    }

    prompt += `

ANALYZE THIS COMMIT FOR SUSPICIOUS ACTIVITY:

SUSPICIOUS PATTERNS TO DETECT:
- Lines changed > 10x author average OR > 20x repo average
- Suspicious file patterns (config files, sensitive files, unusual extensions)
- Suspicious messages (security-related, "deleting", "removing", "fix", "update" with large changes)
- Unusual timing (commits outside author's typical hours - check if marked as UNUSUAL TIMING)
- Generic messages with large changes ("update dependencies", "fix", "cleanup")

BE DECISIVE: Either flag as suspicious with specific reasons OR mark as normal.
Keep reasoning concise and factual. Do not speculate about intent or mention "further investigation".
Focus on specific patterns, not percentages of codebase.
IMPORTANT: The reasoning field should contain ONLY plain text, no JSON formatting.
For timing analysis, be specific: instead of "unusual timing", say "committed at 3:00 AM while normally contributes at 6:00-9:00 PM".

JSON response:
{
  "isAnomalous": [true if suspicious, false if normal],
  "confidence": [0.0-1.0],
  "reasoning": "Brief specific reason in plain text only (absolutely no json formatting) (ideally less than 200 characters)",
  "riskLevel": "low|moderate|high|critical",
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

      if (!stdout || typeof stdout !== 'string') {
        this.logger.error('❌ Ollama returned empty or invalid stdout for anomaly detection');
        throw new Error('AI model returned empty response for anomaly detection');
      }

      this.logger.log(`📝 Raw AI anomaly response length: ${stdout.length} characters`);
      this.logger.log(`📝 Raw AI anomaly response preview: ${stdout.substring(0, 100)}...`);

      const cleanOutput = this.cleanGemmaOutput(stdout);
      this.logger.log(`✅ Ollama anomaly detection successful, cleaned output length: ${cleanOutput.length}`);

      try {
        fs.unlinkSync(tempFile);
      } catch (error) {
        this.logger.warn(`⚠️ Failed to clean up temp file: ${error.message}`);
      }

      return cleanOutput;
    } catch (error) {
      this.logger.error(`❌ Ollama anomaly detection failed: ${error.message}`);
      
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
        return {
          isAnomalous: false,
          confidence: 0.5,
          reasoning: 'Empty AI response',
          riskLevel: 'low',
          suspiciousFactors: [],
        };
      }

      this.logger.log(`📝 Raw AI response length: ${response.length} characters`);
      this.logger.log(`📝 Raw AI response preview: ${response.substring(0, 100)}...`);

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          
          let cleanReasoning = parsed.reasoning || 'No reasoning provided';
          cleanReasoning = cleanReasoning
            .replace(/^\{[\s\S]*\}/, '')
            .replace(/\{[\s\S]*\}$/, '')
            .replace(/^"|"$/g, '')
            .replace(/\\n/g, ' ')
            .replace(/\\"/g, '"')
            .replace(/\{[^}]*\}/g, '')
            .replace(/"[^"]*":\s*"[^"]*"/g, '')
            .replace(/"[^"]*":\s*[^,}]+/g, '')
            .trim();
          
          const result = {
            isAnomalous: parsed.isAnomalous || false,
            confidence: Math.max(0, Math.min(1, parsed.confidence || 0.5)),
            reasoning: cleanReasoning,
            riskLevel: this.validateRiskLevel(parsed.riskLevel),
            suspiciousFactors: Array.isArray(parsed.suspiciousFactors) ? parsed.suspiciousFactors : [],
          };
          
          this.logger.log(`✅ Successfully parsed JSON response: ${result.isAnomalous ? 'SUSPICIOUS' : 'Normal'}`);
          return result;
        } catch (jsonError) {
          this.logger.warn(`Failed to parse JSON from response: ${jsonError.message}`);
        }
      }

      const isAnomalous = response.toLowerCase().includes('anomalous') && 
                         response.toLowerCase().includes('suspicious') &&
                         (response.toLowerCase().includes('unusual') ||
                          response.toLowerCase().includes('concerning'));
     
     let cleanReasoning = response.substring(0, 200)
       .replace(/the json response you provided/i, '')
       .replace(/the json you provided/i, '')
       .replace(/json response/i, '')
       .replace(/here's why:/i, '')
       .replace(/here's a breakdown:/i, '')
       .replace(/the json/i, '')
       .replace(/json/i, '')
       .replace(/\{[\s\S]*\}/g, '')
       .replace(/^"|"$/g, '')
       .replace(/\\n/g, ' ')
       .trim();
     
      if (!cleanReasoning) {
        cleanReasoning = isAnomalous ? 'Unusual patterns detected' : 'Normal commit';
      }
     
     const result: AnomalyDetectionResult = {
       isAnomalous,
       confidence: 0.5,
       reasoning: cleanReasoning,
       riskLevel: isAnomalous ? 'moderate' : 'low',
       suspiciousFactors: isAnomalous ? ['AI detected suspicious patterns'] : [],
     };
       
       this.logger.log(`📝 Using fallback parsing: ${result.isAnomalous ? 'SUSPICIOUS' : 'Normal'}`);
       return result;
     } catch (error) {
       this.logger.error('Failed to parse AI response:', error);
       return {
         isAnomalous: false,
         confidence: 0.5,
         reasoning: 'Failed to parse AI response',
         riskLevel: 'low',
         suspiciousFactors: [],
       };
     }
  }

  private validateRiskLevel(level: string): 'low' | 'moderate' | 'high' | 'critical' {
    const validLevels = ['low', 'moderate', 'high', 'critical'];
    return validLevels.includes(level?.toLowerCase()) ? level.toLowerCase() as any : 'low';
  }

  private getTypicalCommitHours(commitTimeHistogram: Record<string, number>): string {
    if (!commitTimeHistogram || Object.keys(commitTimeHistogram).length === 0) {
      return 'No timing data available';
    }

    const sortedHours = Object.entries(commitTimeHistogram)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 3)
      .map(([hour, count]) => {
        const hourNum = parseInt(hour);
        const timeStr = hourNum < 12 ? `${hourNum}:00 AM` : 
                       hourNum === 12 ? '12:00 PM' : 
                       `${hourNum - 12}:00 PM`;
        return `${timeStr} (${count} commits)`;
      })
      .join(', ');

    return sortedHours;
  }

  private isUnusualCommitTime(commitTime: Date, commitTimeHistogram?: Record<string, number>): boolean {
    if (!commitTimeHistogram) return false;

    const commitHour = commitTime.getHours().toString();
    const topHours = Object.entries(commitTimeHistogram)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 3)
      .map(([hour]) => hour);

    return !topHours.includes(commitHour);
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