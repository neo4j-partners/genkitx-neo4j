// import * as neo4j_driver from "neo4j-driver";
// import { v4 as uuidv4 } from "uuid";

// export interface BaseNeo4jGraphRagOptions {
//   embedder: any;
//   embedderOptions?: any;
//   neo4jInstance: neo4j_driver.Driver;

//   // Optional Cypher queries
//   documentQuery?: string;
//   chunkQuery?: string;
//   subChunkQuery?: string;
//   retrievalQuery?: string;
//   promptTemplate?: string;
// }

// export interface DocumentInput {
//   id?: string;
//   text: string;
//   metadata?: Record<string, any>;
// }

// /**
//  * Base class for Neo4j Graph RAG retrievers.
//  */
// export abstract class BaseNeo4jGraphRagRetriever {
//   protected options: BaseNeo4jGraphRagOptions;

//   constructor(options: BaseNeo4jGraphRagOptions) {
//     this.options = options;
//   }

//   /** Ingest documents using parent → chunk → subchunk logic */
//   async ingestDocument({ documents }: { documents: DocumentInput[] }): Promise<{ status: "ok"; count: number }> {
//     let chunk: any;
//     try {
//       ({ chunk } = await import("llm-chunk"));
//     } catch (err) {
//       throw new Error(
//         "The 'llm-chunk' package is not installed. Install it with 'npm install llm-chunk' to use parent-child ingestion."
//       );
//     }

//     const session = this.options.neo4jInstance.session();

//     const chunkingConfig = {
//       minLength: 1000,
//       maxLength: 2000,
//       splitter: "sentence",
//       overlap: 100,
//       delimiters: "",
//     } as any;

//     const docQuery = this.options.documentQuery ?? `
//       MERGE (d:Document {id: $docId})
//       ON CREATE SET d.createdAt = timestamp(), d.metadata = $metadata
//     `;
//     const chunkQuery = this.options.chunkQuery ?? `
//       MERGE (c:Chunk {id: $chunkId})
//       SET c.text = $chunkText
//       MERGE (d)-[:HAS_CHUNK]->(c)
//     `;
//     const subChunkQuery = this.options.subChunkQuery ?? `
//       MERGE (s:SubChunk {id: $subId})
//       SET s.text = $text, s.embedding = $embedding
//       MERGE (c:Chunk {id: $chunkId})
//       MERGE (c)-[:HAS_SUBCHUNK]->(s)
//     `;

//     for (const doc of documents) {
//       const docId = doc.id ?? uuidv4();
//       const chunks = await chunk(doc.text, chunkingConfig);

//       for (const chunkText of chunks) {
//         const chunkId = uuidv4();
//         const subChunks = await chunk(chunkText, { ...chunkingConfig, minLength: 300, maxLength: 500, overlap: 50 });

//         const embeddings = await Promise.all(
//           subChunks.map((s) => this.options.embedder.embed({ content: s, options: this.options.embedderOptions }))
//         );

//         await session.run(docQuery, { docId, metadata: doc.metadata ?? {} });
//         await session.run(chunkQuery, { docId, chunkId, chunkText });

//         for (let i = 0; i < subChunks.length; i++) {
//           const subId = uuidv4();
//           const embedding = embeddings[i][0].embedding;
//           await session.run(subChunkQuery, { subId, text: subChunks[i], embedding, chunkId });
//         }
//       }
//     }

//     await session.close();
//     return { status: "ok", count: documents.length };
//   }

//   /** Returns the retrieval query */
//   getRetrievalQuery(): string {
//     return this.options.retrievalQuery ?? "";
//   }

//   /** Returns the prompt template */
//   getPrompt(): string {
//     return this.options.promptTemplate ?? "";
//   }

//   /** Abstract method for retrieving documents according to the strategy */
//   abstract retrieve(query: string, options?: any): Promise<any>;
// }

// /**
//  * ParentChildRetriever
//  * Uses the parent → chunk → subchunk hierarchy
//  */
// export class ParentChildRetriever extends BaseNeo4jGraphRagRetriever {
//   constructor(options: BaseNeo4jGraphRagOptions) {
//     super({
//       ...options,
//       retrievalQuery:
//         options.retrievalQuery ??
//         `
//       MATCH (d:Document)-[:HAS_CHUNK]->(c:Chunk)-[:HAS_SUBCHUNK]->(s:SubChunk)
//       RETURN d, c, s
//       `,
//       promptTemplate:
//         options.promptTemplate ??
//         `
//       You are given a document split into chunks and subchunks.
//       Use the most relevant subchunks to answer the question.
//       Document: {document}
//       Question: {question}
//       Answer:
//       `,
//     });
//   }

//   async retrieve(query: string, options?: { k?: number }): Promise<any> {
//     const session = this.options.neo4jInstance.session();
//     const k = options?.k ?? 10;

//     const result = await session.run(this.getRetrievalQuery(), { k });
//     await session.close();

//     // Flatten results into text and metadata
//     return result.records.map((r) => ({
//       document: r.get("d"),
//       chunk: r.get("c"),
//       subChunk: r.get("s"),
//     }));
//   }
// }

// /**
//  * HypotheticalQuestionRetriever
//  * Uses a hypothetical question transformation for retrieval
//  */
// export class HypotheticalQuestionRetriever extends BaseNeo4jGraphRagRetriever {
//   constructor(options: BaseNeo4jGraphRagOptions) {
//     super({
//       ...options,
//       retrievalQuery:
//         options.retrievalQuery ??
//         `
//       MATCH (d:Document)-[:HAS_CHUNK]->(c:Chunk)
//       RETURN d, c
//       `,
//       promptTemplate:
//         options.promptTemplate ??
//         `
//       Transform the user query into a hypothetical question,
//       then retrieve relevant chunks to answer it.
//       User Query: {query}
//       Retrieved Context: {context}
//       Answer:
//       `,
//     });
//   }

//   async retrieve(query: string, options?: { k?: number }): Promise<any> {
//     const session = this.options.neo4jInstance.session();
//     const k = options?.k ?? 10;

//     const result = await session.run(this.getRetrievalQuery(), { k });
//     await session.close();

//     return result.records.map((r) => ({
//       document: r.get("d"),
//       chunk: r.get("c"),
//     }));
//   }
// }
