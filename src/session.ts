import {
  SessionSnapshot,
  SessionSnapshotInput,
  SessionStore,
  SessionStoreOptions,
  GetSnapshotOptions,
  SnapshotMutator,
} from "@genkit-ai/ai/session";
import { Driver, auth, driver as neo4jDriver } from "neo4j-driver";
import { randomUUID } from "crypto";

export interface Neo4jSessionStoreConfig {
  url: string;
  username: string;
  password?: string;
  database?: string;
  sessionLabel?: string;
}

export class Neo4jSessionStore<S = any> implements SessionStore<S> {
  private driver: Driver;
  private config: Neo4jSessionStoreConfig;
  private readonly sessionLabel: string;
  constructor(config: Neo4jSessionStoreConfig) {
    this.config = config;
    this.sessionLabel = config.sessionLabel || "GenkitSession";
    this.driver = neo4jDriver(
      this.config.url,
      auth.basic(this.config.username, this.config.password || ""),
    );
  }

  async getSnapshot(
    opts: GetSnapshotOptions,
  ): Promise<SessionSnapshot<S> | undefined> {
    const session = this.driver.session({ database: this.config.database });
    try {
      let query: string;
      let params: Record<string, any>;

      if (opts.snapshotId) {
        query = `
          MATCH (s:\`${this.sessionLabel}\` {snapshotId: $snapshotId})
          RETURN s
        `;
        params = { snapshotId: opts.snapshotId };
      } else if (opts.sessionId) {
        // Return the latest snapshot for a given sessionId
        query = `
          MATCH (s:\`${this.sessionLabel}\` {sessionId: $sessionId})
          RETURN s
          ORDER BY s.createdAt DESC
          LIMIT 1
        `;
        params = { sessionId: opts.sessionId };
      } else {
        return undefined;
      }

      const result = await session.run(query, params);
      if (result.records.length === 0) return undefined;
      const node = result.records[0].get("s");
      const props = node.properties;
      return {
        snapshotId: props.snapshotId,
        sessionId: props.sessionId,
        parentId: props.parentId,
        createdAt: props.createdAt,
        updatedAt: props.updatedAt,
        status: props.status,
        finishReason: props.finishReason,
        state: props.state ? JSON.parse(props.state) : undefined,
      } as SessionSnapshot<S>;
    } finally {
      await session.close();
    }
  }

  async saveSnapshot(
    snapshotId: string | undefined,
    mutator: SnapshotMutator<S>,
    options?: SessionStoreOptions,
  ): Promise<string | null> {
    const session = this.driver.session({ database: this.config.database });
    try {
      // Read existing snapshot if snapshotId provided
      let current: SessionSnapshot<S> | undefined;
      if (snapshotId) {
        current = await this.getSnapshot({ snapshotId });
      }

      // Run the mutator
      const updated: SessionSnapshotInput<S> | null = mutator(current);
      if (updated === null) return null;

      const newSnapshotId = updated.snapshotId ?? snapshotId ?? randomUUID();
      const now = new Date().toISOString();
      await session.run(
        `
        MERGE (s:\`${this.sessionLabel}\` {snapshotId: $snapshotId})
        SET s.sessionId     = $sessionId,
            s.parentId      = $parentId,
            s.createdAt     = COALESCE(s.createdAt, $now),
            s.updatedAt     = $now,
            s.status        = $status,
            s.finishReason  = $finishReason,
            s.state         = $state
        `,
        {
          snapshotId: newSnapshotId,
          sessionId: updated.sessionId ?? null,
          parentId: updated.parentId ?? null,
          now,
          status: (updated as any).status ?? null,
          finishReason: (updated as any).finishReason ?? null,
          state: updated.state ? JSON.stringify(updated.state) : null,
        },
      );

      return newSnapshotId;
    } finally {
      await session.close();
    }
  }

  async close(): Promise<void> {
    await this.driver.close();
  }
}
