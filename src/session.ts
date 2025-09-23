import {
    SessionData,
    SessionStore,
} from '@genkit-ai/ai/session';
import {
    Driver,
    Session,
    auth,
    driver as neo4jDriver,
} from 'neo4j-driver';

export interface Neo4jSessionStoreConfig {
    url: string;
    username: string;
    password?: string;
    database?: string;
    sessionLabel?: string;
    messageLabel?: string;
    nextMessageRelType?: string;
    lastMessageRelType?: string;
}

export class Neo4jSessionStore<S = any> implements SessionStore<S> {
    private driver: Driver;
    private config: Neo4jSessionStoreConfig;

    private readonly sessionLabel: string;
    private readonly messageLabel: string;
    private readonly nextMessageRelType: string;
    private readonly lastMessageRelType: string;

    constructor(config: Neo4jSessionStoreConfig) {
        this.config = config;
        this.sessionLabel = config.sessionLabel || 'GenkitSession';
        this.messageLabel = config.messageLabel || 'Message';
        this.nextMessageRelType = config.nextMessageRelType || 'NEXT';
        this.lastMessageRelType = config.lastMessageRelType || 'LAST_MESSAGE';

        this.driver = neo4jDriver(
            this.config.url,
            auth.basic(this.config.username, this.config.password || ''),
            {},
        );
    }

    // Corrected Cypher query for the get() method

// Corrected get() method in src/session.ts
// Corrected get() method in src/session.ts
async get(sessionId: string): Promise<SessionData<S> | undefined> {
  const session = this.driver.session({ database: this.config.database });
  try {
    // 1. Get the session node and its state
    const sessionResult = await session.run(
      `MATCH (s:\`${this.sessionLabel}\` {sessionId: $sessionId})
       RETURN s.state as state`,
      { sessionId }
    );

    if (sessionResult.records.length === 0) {
      return undefined; // Session not found
    }

    const state = JSON.parse(sessionResult.records[0].get('state') || '{}');

    // 2. Get all messages for the session by traversing the relationships
    // Corrected messagesResult query in get() method
const messagesResult = await session.run(
  `MATCH (s:\`${this.sessionLabel}\` {sessionId: $sessionId})-[:${this.lastMessageRelType}]->(lastMsg)
   MATCH p=(startMsg)-[:${this.nextMessageRelType}*0..]->(lastMsg)
   WHERE NOT (startMsg)<-[:${this.nextMessageRelType}]-() // Find the first message node
   UNWIND nodes(p) AS msgNode
   RETURN msgNode`,
  { sessionId }
);
    
    // Process the results...
    const messages = messagesResult.records.map(record => {
      const node = record.get('node');
      return {
        content: JSON.parse(node.properties.content),
        role: node.properties.role,
        metadata: JSON.parse(node.properties.metadata),
        threadId: node.properties.threadId,
      };
    });

    const threads: Record<string, any[]> = {};
    for (const msg of messages) {
      const threadId = msg.threadId;
      if (!threads[threadId]) {
        threads[threadId] = [];
      }
      threads[threadId].push({
        content: msg.content,
        role: msg.role,
        metadata: msg.metadata,
      });
    }

    return {
      id: sessionId,
      state,
      threads,
    } as SessionData<S>;

  } finally {
    await session.close();
  }
}
    async save(sessionId: string, sessionData: SessionData<S>): Promise<void> {
        const session = this.driver.session({ database: this.config.database });
        try {
            const tx = session.beginTransaction();

            // MERGE or create the Session node and update its state
            const sessionResult = await tx.run(
                `MERGE (s:\`${this.sessionLabel}\` {sessionId: $sessionId})
         SET s.state = $state
         RETURN s`,
                { sessionId, state: JSON.stringify(sessionData.state) },
            );
            const sessionNodeId = sessionResult.records[0].get('s').identity;

            let lastNodeId = null;

            // Find the existing last message node
            const findLastNodeResult = await tx.run(
                `MATCH (s:\`${this.sessionLabel}\` {sessionId: $sessionId})
         OPTIONAL MATCH (s)-[r:\`${this.lastMessageRelType}\`]->(lastNode)
         RETURN lastNode`,
                { sessionId }
            );
            if (findLastNodeResult.records[0].get('lastNode')) {
                lastNodeId = findLastNodeResult.records[0].get('lastNode').identity;
            }

            // Process messages for each thread
            for (const threadId in sessionData.threads) {
                const messages = sessionData.threads[threadId];

                for (const msg of messages) {
                    const content = JSON.stringify(msg.content);
                    const metadata = JSON.stringify(msg.metadata || {});

                    const createMessageResult = await tx.run(
                        `CREATE (m:\`${this.messageLabel}\` {
                            content: $content,
                            role: $role,
                            metadata: $metadata,
                            threadId: $threadId,
                            timestamp: timestamp()
                        })
                        RETURN m`,
                        { content, role: msg.role, metadata, threadId }
                    );

                    const newMessageNodeId = createMessageResult.records[0].get('m').identity;

                    // If there is a previous node, create a NEXT relationship
                    if (lastNodeId !== null) {
                        await tx.run(
                            `MATCH (n1), (n2)
               WHERE id(n1) = $lastNodeId AND id(n2) = $newMessageNodeId
               CREATE (n1)-[:${this.nextMessageRelType}]->(n2)`,
                            { lastNodeId, newMessageNodeId }
                        );
                    }
                    lastNodeId = newMessageNodeId;
                }
            }

            // Update the LAST_MESSAGE relationship
            if (lastNodeId !== null) {
                await tx.run(
                    `MATCH (s:\`${this.sessionLabel}\` {sessionId: $sessionId})
           OPTIONAL MATCH (s)-[r:\`${this.lastMessageRelType}\`]->()
           DELETE r
           WITH s
           MATCH (lastNode) WHERE id(lastNode) = $lastNodeId
           CREATE (s)-[:${this.lastMessageRelType}]->(lastNode)`,
                    { sessionId, lastNodeId }
                );
            }

            await tx.commit();

        } finally {
            await session.close();
        }
    }

    async close(): Promise<void> {
        await this.driver.close();
    }
}