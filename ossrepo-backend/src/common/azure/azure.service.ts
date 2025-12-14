import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { NodeSSH } from 'node-ssh';
import neo4j, { Driver } from 'neo4j-driver';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config();

@Injectable()
export class ConnectionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConnectionService.name);
  private ssh = new NodeSSH();
  private memgraphDriver: Driver | null = null;
  private connected = false;

  // Called when app starts
  async onModuleInit() {
    try {
      await this.connect();
      this.logger.log('✅ Connections established successfully');
    } catch (error) {
      this.logger.error('❌ Failed to initialize connections - running without Azure/Memgraph', error);
      this.logger.warn('⚠️ App will continue running, but graph features will be unavailable');
      // Don't throw - allow app to run without Memgraph connection
    }
  }

  // Called when app shuts down
  async onModuleDestroy() {
    await this.disconnect();
  }

  private async connect() {
    if (this.connected) return;

    const host = process.env.AZURE_HOST!;
    const username = process.env.AZURE_USER!;
    const privateKey = process.env.AZURE_PRIVATE_KEY!;
    const memgraphUrl = process.env.AZURE_BOLT!;

    this.logger.log('🔌 Connecting to Azure via SSH...');
    await this.ssh.connect({
        host,
        username,
        privateKey,
      });
      
    this.logger.log('✅ SSH connected');

    this.logger.log('🔗 Connecting to Memgraph...');
    // Use basic auth if credentials provided, otherwise no auth
    const memgraphUser = process.env.MEMGRAPH_USER;
    const memgraphPassword = process.env.MEMGRAPH_PASSWORD;
    
    if (memgraphUser && memgraphPassword) {
      this.memgraphDriver = neo4j.driver(
        memgraphUrl,
        neo4j.auth.basic(memgraphUser, memgraphPassword)
      );
    } else {
      this.memgraphDriver = neo4j.driver(memgraphUrl);
    }
    await this.memgraphDriver.getServerInfo();
    this.logger.log('✅ Memgraph connected');

    this.connected = true;
  }

  getSSH(): NodeSSH {
    if (!this.connected) throw new Error('SSH not connected yet');
    return this.ssh;
  }

  getMemgraph(): Driver | null {
    if (!this.memgraphDriver) {
      this.logger.warn('⚠️ Memgraph not connected - graph features unavailable');
      return null;
    }
    return this.memgraphDriver;
  }

  isMemgraphConnected(): boolean {
    return this.memgraphDriver !== null;
  }

  async disconnect() {
    if (this.memgraphDriver) {
      await this.memgraphDriver.close();
      this.logger.log('🔗 Memgraph disconnected');
    }
    if (this.ssh.isConnected()) {
      this.ssh.dispose();
      this.logger.log('🔌 SSH disconnected');
    }
    this.connected = false;
  }

  /**
   * Ensure SSH connection is alive, reconnect if needed
   */
  private async ensureSSHConnected(): Promise<void> {
    // Check if SSH is actually connected (not just the flag)
    if (!this.ssh.isConnected()) {
      this.logger.warn('⚠️ SSH connection dropped, reconnecting...');
      this.connected = false;
      
      // Create a new SSH instance
      this.ssh = new NodeSSH();
      
      const host = process.env.AZURE_HOST!;
      const username = process.env.AZURE_USER!;
      const privateKey = process.env.AZURE_PRIVATE_KEY!;
      
      await this.ssh.connect({
        host,
        username,
        privateKey,
      });
      
      this.connected = true;
      this.logger.log('✅ SSH reconnected successfully');
    }
  }

  /**
   * Execute a command remotely via SSH
   * @param command The command to execute
   * @param options Optional execution options (timeout, env vars, etc.)
   * @returns Promise with stdout, stderr, and exit code
   */
  async executeRemoteCommand(
    command: string,
    options?: {
      timeout?: number;
      env?: Record<string, string>;
      cwd?: string;
    }
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    // Auto-reconnect if connection dropped
    await this.ensureSSHConnected();

    this.logger.log(`🔧 Executing remote command: ${command}`);
    
    // Default timeout of 5 minutes to prevent hanging
    const timeout = options?.timeout || 300000; // 5 minutes
    
    try {
      // Wrap in a timeout to prevent hanging forever
      const execPromise = this.ssh.execCommand(command, {
        execOptions: {
          env: {
            ...process.env,
            ...(options?.env || {}),
          },
          cwd: options?.cwd,
        },
      });
      
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`SSH command timed out after ${timeout/1000}s`)), timeout);
      });
      
      const result = await Promise.race([execPromise, timeoutPromise]);

      if (result.code !== 0 && result.code !== null) {
        this.logger.warn(`⚠️ Command exited with code ${result.code}`);
        if (result.stderr) {
          this.logger.warn(`⚠️ stderr: ${result.stderr}`);
        }
      }

      return {
        stdout: result.stdout,
        stderr: result.stderr,
        code: result.code || 0,
      };
    } catch (error) {
      // If it's a timeout, log and return failure instead of throwing
      if (error.message?.includes('timed out')) {
        this.logger.error(`❌ SSH command timed out: ${command}`);
        return {
          stdout: '',
          stderr: `Command timed out after ${timeout/1000}s`,
          code: 124, // Standard timeout exit code
        };
      }
      
      // If command failed due to connection issue, try to reconnect once
      if (error.message?.includes('Not connected') || error.message?.includes('connection')) {
        this.logger.warn('⚠️ SSH connection error, attempting reconnect...');
        this.connected = false;
        await this.ensureSSHConnected();
        
        // Retry the command once with timeout
        const retryExecPromise = this.ssh.execCommand(command, {
          execOptions: {
            env: {
              ...process.env,
              ...(options?.env || {}),
            },
            cwd: options?.cwd,
          },
        });
        
        const retryTimeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`SSH command timed out after ${timeout/1000}s`)), timeout);
        });
        
        try {
          const result = await Promise.race([retryExecPromise, retryTimeoutPromise]);
          return {
            stdout: result.stdout,
            stderr: result.stderr,
            code: result.code || 0,
          };
        } catch (retryError) {
          if (retryError.message?.includes('timed out')) {
            return {
              stdout: '',
              stderr: `Command timed out after ${timeout/1000}s`,
              code: 124,
            };
          }
          throw retryError;
        }
      }
      
      this.logger.error(`❌ Failed to execute remote command: ${error.message}`);
      throw error;
    }
  }
}
