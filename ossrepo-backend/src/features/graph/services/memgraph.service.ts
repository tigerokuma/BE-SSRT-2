import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Driver } from 'neo4j-driver';
import { ConnectionService } from '../../../common/azure/azure.service';

@Injectable()
export class MemgraphService implements OnModuleDestroy {
  constructor(private readonly azureService: ConnectionService) {}

  async onModuleDestroy() {
    // Connection is managed by AzureService, no need to close here
  }

  private getDriver(): Driver {
    return this.azureService.getMemgraph();
  }

  async verifyConnectivity(): Promise<void> {
    const driver = this.getDriver();
    await driver.verifyAuthentication();
  }

  /**
   * Preflight compile with EXPLAIN to catch parser errors quickly.
   * Then run the actual cypher with small retry for transient errors.
   */
  async run<T extends Record<string, unknown> = Record<string, unknown>>(
    cypher: string,
    params: Record<string, unknown> = {},
  ): Promise<T[]> {
    const driver = this.getDriver();
    const session = driver.session();
    try {
      // Preflight: EXPLAIN (catches parsing issues without executing)
      await session.run(`EXPLAIN ${cypher}`, params);

      // Execute with small retry for transient classes
      const maxAttempts = 2;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const res = await session.run(cypher, params);
          return res.records.map((r) => r.toObject()) as T[];
        } catch (err: any) {
          const msg = String(err?.message || err);
          const retriable =
            /TransientError|timeout|temporar|deadlock|lock/i.test(msg) ||
            /Memgraph\.TransientError/i.test(msg);

          if (!retriable || attempt === maxAttempts) throw err;

          // jittered backoff
          await new Promise((r) =>
            setTimeout(r, 150 * attempt + Math.random() * 200),
          );
        }
      }

      return [] as T[];
    } finally {
      await session.close();
    }
  }
}
