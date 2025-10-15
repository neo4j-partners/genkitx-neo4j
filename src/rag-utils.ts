import * as neo4j_driver from "neo4j-driver";
import { v4 as uuidv4 } from "uuid";

export interface ParentChildIngestorOptions {
  embedder: any;
  embedderOptions?: any;
  neo4jInstance: neo4j_driver.Driver;
}

/**
 * Ingest documents with parent → chunk → subchunk structure in Neo4j
 * @param options embedder, optional embedder options, and Neo4j instance
 * @param documents Array of documents to ingest
 * @returns status and count of ingested documents
 */
export async function parentChildIngestor(
  options: ParentChildIngestorOptions,
  { documents }: { documents: { id?: string; text: string; metadata?: any }[] }
): Promise<{ status: "ok"; count: number }> {
  // Lazy import chunk with a clear error if missing
  let chunk: any;
  try {
    ({ chunk } = await import("llm-chunk"));
  } catch (err) {
    throw new Error(
      "The 'llm-chunk' package is not installed. " +
        "To use the Parent-Child ingestor, install it with:\n\n" +
        "npm install llm-chunk\n" +
        "or\n" +
        "yarn add llm-chunk"
    );
  }

  const session = options.neo4jInstance.session();

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

      const embeddings = await Promise.all(
        subChunks.map((s) => options.embedder.embed({ content: s, options: options.embedderOptions }))
      );

      await session.run(
        `
        MERGE (d:Document {id: $docId})
        ON CREATE SET d.createdAt = timestamp(), d.metadata = $metadata
        MERGE (c:Chunk {id: $chunkId})
        SET c.text = $chunkText
        MERGE (d)-[:HAS_CHUNK]->(c)
      `,
        { docId, metadata: doc.metadata ?? {}, chunkId, chunkText }
      );

      for (let i = 0; i < subChunks.length; i++) {
        const subId = uuidv4();
        const embedding = embeddings[i][0].embedding;
        await session.run(
          `
          MERGE (s:SubChunk {id: $subId})
          SET s.text = $text, s.embedding = $embedding
          MERGE (c:Chunk {id: $chunkId})
          MERGE (c)-[:HAS_SUBCHUNK]->(s)
        `,
          { subId, text: subChunks[i], embedding, chunkId }
        );
      }
    }
  }

  await session.close();
  return { status: "ok", count: documents.length };
}
