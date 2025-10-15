import { genkit, Document } from "genkit";
import { v4 as uuidv4 } from "uuid";
import * as neo4j_driver from "neo4j-driver";
import { Neo4jGraphConfig } from "genkitx-neo4j";
import { neo4jIndexerRef } from "."; // adjust import path

/**
 * Base class for Neo4j RAG retrievers
 */
export abstract class BaseNeo4jGraphRagRetriever {
  constructor(
    protected ai: ReturnType<typeof genkit>,
    protected neo4jConfig: Neo4jGraphConfig,
    protected indexerRef: ReturnType<typeof neo4jIndexerRef>
  ) {}

  abstract ingestDocument(params: {
    documents: { id?: string; text: string; metadata?: any }[];
  }): Promise<any>;
  abstract getRetrievalQuery(): string;
  abstract getPrompt(): string;

  public getNeo4jInstance() {
    return neo4j_driver.driver(
      this.neo4jConfig.url,
      neo4j_driver.auth.basic(this.neo4jConfig.username, this.neo4jConfig.password)
    );
  }
}

/**
 * Parent-Child Retriever
 */
export class ParentChildRetriever extends BaseNeo4jGraphRagRetriever {
  async ingestDocument({
    documents,
  }: {
    documents: { id?: string; text: string; metadata?: any }[];
  }) {
    // Lazy import of llm-chunk
    let chunk: any;
    try {
      ({ chunk } = await import("llm-chunk"));
    } catch (err) {
      throw new Error(
        "The 'llm-chunk' package is not installed. To use ParentChildRetriever, run:\n\nnpm install llm-chunk\nor\nyarn add llm-chunk"
      );
    }

    const session = this.getNeo4jInstance().session();

    const chunkingConfig = {
      minLength: 1000,
      maxLength: 2000,
      splitter: "sentence",
      overlap: 100,
      delimiters: "",
    } as any;

    for (const doc of documents) {
      const docId = doc.id ?? uuidv4();
      const chunks = await chunk(doc.text, chunkingConfig);

      for (const chunkText of chunks) {
        const chunkId = uuidv4();
        const subChunks = await chunk(chunkText, {
          ...chunkingConfig,
          minLength: 300,
          maxLength: 500,
          overlap: 50,
        });

        // Index subchunks via Genkit + plugin embedder
        const documentsToIndex = subChunks.map(
          (sub) => new Document({ content: [{ text: sub }], metadata: doc.metadata ?? {} })
        );
        await this.ai.index({ indexer: this.indexerRef, documents: documentsToIndex });

        // Create parent-child structure in Neo4j
        await session.run(
          `MERGE (d:Document {id: $docId})
           ON CREATE SET d.createdAt = timestamp(), d.metadata = $metadata
           MERGE (c:Chunk {id: $chunkId})
           SET c.text = $chunkText
           MERGE (d)-[:HAS_CHUNK]->(c)`,
          { docId, metadata: doc.metadata ?? {}, chunkId, chunkText }
        );

        for (const sub of subChunks) {
          const subId = uuidv4();
          await session.run(
            `MERGE (s:SubChunk {id: $subId})
             SET s.text = $text
             MERGE (c:Chunk {id: $chunkId})
             MERGE (c)-[:HAS_SUBCHUNK]->(s)`,
            { subId, text: sub, chunkId }
          );
        }
      }
    }

    await session.close();
    return { status: "ok", count: documents.length };
  }

  getRetrievalQuery(): string {
    return `
      MATCH (d:Document)-[:HAS_CHUNK]->(c:Chunk)
      OPTIONAL MATCH (c)-[:HAS_SUBCHUNK]->(s:SubChunk)
      RETURN d, c, collect(s) as subChunks
    `;
  }

  getPrompt(): string {
    return "Use the retrieved parent-child document structure to answer the question:";
  }
}

/**
 * Hypothetical Question Retriever
 */
export class HypotheticalQuestionRetriever extends BaseNeo4jGraphRagRetriever {
  async ingestDocument({
    documents,
  }: {
    documents: { id?: string; text: string; metadata?: any }[];
  }) {
    const session = this.getNeo4jInstance().session();

    // Index documents via Genkit + plugin embedder
    const documentsToIndex = documents.map(
      (doc) => new Document({ content: [{ text: doc.text }], metadata: doc.metadata ?? {} })
    );
    await this.ai.index({ indexer: this.indexerRef, documents: documentsToIndex });

    // In Neo4j, just store documents as nodes (no subchunk logic)
    for (const doc of documents) {
      const docId = doc.id ?? uuidv4();
      await session.run(
        `MERGE (d:Document {id: $docId})
         SET d.text = $text, d.metadata = $metadata`,
        { docId, text: doc.text, metadata: doc.metadata ?? {} }
      );
    }

    await session.close();
    return { status: "ok", count: documents.length };
  }

  getRetrievalQuery(): string {
    return `
      MATCH (d:Document)
      RETURN d
    `;
  }

  getPrompt(): string {
    return "Answer the question hypothetically based on the retrieved documents:";
  }
}
