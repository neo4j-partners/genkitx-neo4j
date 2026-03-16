import { genkit, Document } from "genkit";
import { v4 as uuidv4 } from "uuid";
import * as neo4j_driver from "neo4j-driver";
import { Neo4jGraphConfig } from "genkitx-neo4j";

export interface GraphRagRetrieverConfig {
  systemPrompt: string;
  cypherQuery: string;
  idMetadataKey: string;
  cypherIdParamName: string;
  cypherReturnTextField: string;
  cypherReturnIdField?: string;
  model?: any; 
}

export abstract class BaseNeo4jGraphRagRetriever {
  constructor(
    protected ai: ReturnType<typeof genkit>,
    protected neo4jConfig: Neo4jGraphConfig,
    protected indexerRef: any,
    protected vectorRetrieverRef: any,
    protected ragConfig: GraphRagRetrieverConfig
  ) {}

  public getNeo4jInstance() {
    return neo4j_driver.driver(
      this.neo4jConfig.url,
      neo4j_driver.auth.basic(this.neo4jConfig.username, this.neo4jConfig.password)
    );
  }

  public getSystemPrompt(): string {
    return this.ragConfig.systemPrompt;
  }

  abstract ingestDocument(params: {
    documents: { id?: string; text: string; metadata?: any }[];
  }): Promise<any>;

  protected async getInitialVectorDocs(query: string, k: number): Promise<Document[]> {
    return await this.ai.retrieve({
      retriever: this.vectorRetrieverRef,
      query: query,
      options: { k }
    });
  }

  async retrieve(query: string, k: number = 3): Promise<Document[]> {
    const vectorResults = await this.getInitialVectorDocs(query, k * 2);

    const ids = [
      ...new Set(
        vectorResults
          .map(doc => doc.metadata?.[this.ragConfig.idMetadataKey])
          .filter(Boolean)
      )
    ];

    if (ids.length === 0) {
      return [];
    }

    const session = this.getNeo4jInstance().session();
    
    const cypherParams = {
      [this.ragConfig.cypherIdParamName]: ids
    };
    
    const result = await session.run(
      this.ragConfig.cypherQuery, 
      cypherParams
    );
    
    await session.close();

    return result.records.map(record => 
      new Document({
        content: [{ text: record.get(this.ragConfig.cypherReturnTextField) }],
        metadata: { 
          source: this.constructor.name, 
          graphId: this.ragConfig.cypherReturnIdField 
            ? record.get(this.ragConfig.cypherReturnIdField) 
            : undefined 
        }
      })
    );
  }
}

export class ParentChildRetriever extends BaseNeo4jGraphRagRetriever {
  constructor(
    ai: ReturnType<typeof genkit>,
    neo4jConfig: Neo4jGraphConfig,
    indexerRef: any,
    vectorRetrieverRef: any,
    model?: any
  ) {
    super(ai, neo4jConfig, indexerRef, vectorRetrieverRef, {
      systemPrompt: "You are an expert assistant. Use the provided parent-child context to answer the user's question. If the answer is not in the context, state it clearly.",
      idMetadataKey: "chunkId",
      cypherIdParamName: "chunkIds",
      cypherQuery: `
        MATCH (c:Chunk)
        WHERE c.id IN $chunkIds
        RETURN c.text AS parentText, c.id AS chunkId
      `,
      cypherReturnTextField: "parentText",
      cypherReturnIdField: "chunkId"
    });
  }

  async ingestDocument({
    documents,
  }: {
    documents: { id?: string; text: string; metadata?: any }[];
  }) {
    let chunk: any;
    try {
      ({ chunk } = await import("llm-chunk"));
    } catch (err) {
      throw new Error("You must install 'llm-chunk'.");
    }

    const session = this.getNeo4jInstance().session();

    const chunkingConfig = {
      minLength: 1000,
      maxLength: 2000,
      splitter: "sentence",
      overlap: 100
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
          overlap: 50
        });

        const documentsToIndex = subChunks.map(
          (sub) => new Document({ 
            content: [{ text: sub }], 
            metadata: { ...doc.metadata, docId, chunkId }
          })
        );
        
        await this.ai.index({
          indexer: this.indexerRef,
          documents: documentsToIndex
        });

        await session.run(
          `MERGE (d:Document {id: $docId})
           ON CREATE SET d.createdAt = timestamp(), d += $metadata
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
}

export class HypotheticalQuestionRetriever extends BaseNeo4jGraphRagRetriever {
  constructor(
    ai: ReturnType<typeof genkit>,
    neo4jConfig: Neo4jGraphConfig,
    indexerRef: any,
    vectorRetrieverRef: any,
    model?: any
  ) {
    super(ai, neo4jConfig, indexerRef, vectorRetrieverRef, {
      systemPrompt: "Answer the question using ONLY the retrieved documents. Be concise and direct.",
      idMetadataKey: "docId",
      cypherIdParamName: "docIds",
      cypherQuery: `
        MATCH (d:Document)
        WHERE d.id IN $docIds
        RETURN d.text AS text, d.id AS docId
      `,
      cypherReturnTextField: "text",
      cypherReturnIdField: "docId",
      // model: model 
    });
  }

  protected async getInitialVectorDocs(query: string, k: number): Promise<Document[]> {
    const hypotheticalResponse = await this.ai.generate({
      model: this.ragConfig.model, 
      prompt: `Write a brief hypothetical paragraph perfectly answering this question: "${query}". It does not need to be factual, just capture relevant vocabulary.`,
    });

    return await this.ai.retrieve({
      retriever: this.vectorRetrieverRef,
      query: hypotheticalResponse.text, 
      options: { k }
    });
  }

  async ingestDocument({
    documents,
  }: {
    documents: { id?: string; text: string; metadata?: any }[];
  }) {
    const session = this.getNeo4jInstance().session();

    for (const doc of documents) {
      const docId = doc.id ?? uuidv4();
      
      await this.ai.index({ 
        indexer: this.indexerRef, 
        documents: [
          new Document({
            content: [{ text: doc.text }],
            metadata: { docId, ...doc.metadata }
          })
        ] 
      });

      await session.run(
        `MERGE (d:Document {id: $docId})
         SET d.text = $text, d += $metadata`,
        { docId, text: doc.text, metadata: doc.metadata ?? {} }
      );
    }
    
    await session.close();
    return { status: "ok" };
  }
}