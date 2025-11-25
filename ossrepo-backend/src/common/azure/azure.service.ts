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
      this.logger.error('❌ Failed to initialize connections', error);
      throw error;
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
    const privateKey = fs.readFileSync(process.env.AZURE_PATH!, 'utf8');
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

  getMemgraph(): Driver {
    if (!this.memgraphDriver) throw new Error('Memgraph not connected yet');
    return this.memgraphDriver;
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
    if (!this.connected) {
      throw new Error('SSH not connected. Call connect() first.');
    }

    this.logger.log(`🔧 Executing remote command: ${command}`);
    
    try {
      const result = await this.ssh.execCommand(command, {
        execOptions: {
          env: {
            ...process.env,
            ...(options?.env || {}),
          },
          cwd: options?.cwd,
        },
      });

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
      this.logger.error(`❌ Failed to execute remote command: ${error.message}`);
      throw error;
    }
  }
}
