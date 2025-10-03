import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{
        text: string;
      }>;
    };
  }>;
}

export interface GeminiRequest {
  contents: Array<{
    parts: Array<{
      text: string;
    }>;
  }>;
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
    topP?: number;
    topK?: number;
  };
}

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private readonly apiKey: string;
  private readonly model: string;
  private readonly apiUrl: string;

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('GEMINI_API_KEY') || '';
    this.model = this.configService.get<string>('GEMINI_MODEL', 'gemini-2.0-flash-exp');
    this.apiUrl = this.configService.get<string>('GEMINI_API_URL', 'https://generativelanguage.googleapis.com/v1beta/models');
    
    if (!this.apiKey) {
      this.logger.error('❌ GEMINI_API_KEY not found in environment variables');
      throw new Error('Gemini API key is required');
    }
  }

  /**
   * Generate text using Gemini API
   */
  async generateText(
    prompt: string,
    options?: {
      temperature?: number;
      maxTokens?: number;
      topP?: number;
      topK?: number;
    }
  ): Promise<string> {
    try {
      this.logger.log(`🤖 Generating text with Gemini (${this.model})`);
      this.logger.log(`📝 Prompt length: ${prompt.length} characters`);

      const requestBody: GeminiRequest = {
        contents: [
          {
            parts: [
              {
                text: prompt
              }
            ]
          }
        ],
        generationConfig: {
          temperature: options?.temperature ?? 0.7,
          maxOutputTokens: options?.maxTokens ?? 2048,
          topP: options?.topP ?? 0.8,
          topK: options?.topK ?? 40
        }
      };

      const response = await fetch(`${this.apiUrl}/${this.model}:generateContent?key=${this.apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`❌ Gemini API error: ${response.status} - ${errorText}`);
        throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
      }

      const data: GeminiResponse = await response.json();
      
      if (!data.candidates || data.candidates.length === 0) {
        this.logger.error('❌ No candidates returned from Gemini API');
        throw new Error('No response generated from Gemini API');
      }

      const generatedText = data.candidates[0].content.parts[0].text;
      this.logger.log(`✅ Gemini response generated: ${generatedText.length} characters`);
      
      return generatedText.trim();
    } catch (error) {
      this.logger.error(`❌ Gemini API call failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generate repository summary with optimized settings
   */
  async generateRepositorySummary(prompt: string): Promise<string> {
    return this.generateText(prompt, {
      temperature: 0.3, // Lower temperature for more consistent summaries
      maxTokens: 500,
      topP: 0.8,
      topK: 40
    });
  }

  /**
   * Generate anomaly detection analysis with optimized settings
   */
  async generateAnomalyAnalysis(prompt: string): Promise<string> {
    return this.generateText(prompt, {
      temperature: 0.5, // Balanced temperature for analysis
      maxTokens: 1000,
      topP: 0.9,
      topK: 50
    });
  }

  /**
   * Generate Cypher queries with optimized settings
   */
  async generateCypherQuery(prompt: string): Promise<string> {
    return this.generateText(prompt, {
      temperature: 0.2, // Very low temperature for precise code generation
      maxTokens: 800,
      topP: 0.7,
      topK: 30
    });
  }

  /**
   * Test API connection
   */
  async testConnection(): Promise<boolean> {
    try {
      const testPrompt = 'Generate a one-sentence test response.';
      await this.generateText(testPrompt);
      this.logger.log('✅ Gemini API connection test successful');
      return true;
    } catch (error) {
      this.logger.error('❌ Gemini API connection test failed:', error);
      return false;
    }
  }

  /**
   * Get API usage information
   */
  getApiInfo(): { model: string; apiUrl: string; hasApiKey: boolean } {
    return {
      model: this.model,
      apiUrl: this.apiUrl,
      hasApiKey: !!this.apiKey
    };
  }
}
