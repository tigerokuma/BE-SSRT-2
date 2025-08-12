import { Injectable, OnModuleDestroy } from '@nestjs/common';
import neo4j, { Driver } from 'neo4j-driver';

@Injectable()
export class MemgraphService implements OnModuleDestroy {
  private driver: Driver;

  constructor() {
    this.driver = neo4j.driver('bolt://localhost:7687'); // no auth by default
  }

  async onModuleDestroy() {
    await this.driver?.close();
  }

  async verifyConnectivity(): Promise<void> {
    await this.driver.verifyAuthentication();
  }

  /**
   * Preflight compile with EXPLAIN to catch parser errors quickly.
   * Then run the actual cypher with small retry for transient errors.
   */
  async run<T extends Record<string, unknown> = Record<string, unknown>>(
    cypher: string,
    params: Record<string, unknown> = {},
  ): Promise<T[]> {
    const session = this.driver.session();
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
          await new Promise((r) => setTimeout(r, 150 * attempt + Math.random() * 200));
        }
      }

      return [] as T[];
    } finally {
      await session.close();
    }
  }
}
