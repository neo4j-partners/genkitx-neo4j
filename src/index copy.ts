/**
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 *
 * You may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as neo4j_driver from "neo4j-driver";
import { Genkit, RetrieverArgument, z } from "genkit";
import { GenkitPlugin, genkitPlugin } from "genkit/plugin";
import { EmbedderArgument } from "genkit/embedder";
import {
  CommonRetrieverOptionsSchema,
  Document,
  indexerRef,
  retrieverRef,
} from "genkit/retriever";
import { constructMetadataFilter } from "./filter-utils";

import { v4 as uuidv4 } from "uuid";

const Neo4jRetrieverOptionsSchema = CommonRetrieverOptionsSchema.extend({
  filter: z.record(z.string(), z.any()).optional(),
});

const Neo4jIndexerOptionsSchema = z.object({
  namespace: z.string().optional(),
});

export interface Neo4jGraphConfig {
  url: string;
  username: string;
  password: string;
  database?: string;
}

export const neo4jRetrieverRef = (params: {
  indexId: string;
  displayName?: string;
  retrievalQuery?: string;
}) => {
  return retrieverRef({
    name: `neo4j/${params.indexId}`,
    info: {
      label: params.displayName ?? `Neo4j - ${params.indexId}`,
    },
    configSchema: Neo4jRetrieverOptionsSchema,
  });
};

export const neo4jIndexerRef = (params: {
  indexId: string;
  displayName?: string;
  creationQuery?: string;
  a?: string;
}) => {
  return indexerRef({
    name: `neo4j/${params.indexId}`,
    info: {
      label: params.displayName ?? `Neo4j - ${params.indexId}`,
    },
  });
};

interface Neo4jParams<EmbedderCustomOptions extends z.ZodTypeAny> {
  indexId: string;
  embedder: EmbedderArgument<EmbedderCustomOptions>;
  embedderOptions?: z.infer<EmbedderCustomOptions>;
  clientParams?: Neo4jGraphConfig;
  label?: string;
  textProperty?: string;
  embeddingProperty?: string;
  idProperty?: string;
  retrievalQuery?: string;
  creationQuery?: string;
  retriever?: any;
}

export function configureNeo4jRetriever<
  EmbedderCustomOptions extends z.ZodTypeAny,
>(
  ai: Genkit,
  params: Neo4jParams<EmbedderCustomOptions>,
) {
  const { indexId, embedder, embedderOptions } = params;
  const neo4jConfig = params.clientParams ?? getDefaultConfig();
  const neo4j_instance = neo4j_driver.driver(
    neo4jConfig.url,
    neo4j_driver.auth.basic(neo4jConfig.username, neo4jConfig.password),
  );

  return ai.defineRetriever(
    {
      name: `neo4j/${params.indexId}`,
      configSchema: Neo4jRetrieverOptionsSchema,
    },
    async (content, options) => {
      const queryEmbeddings = await ai.embed({
        embedder,
        content,
        options: embedderOptions,
      });

      const retriever_query = retrieverQuery(options, params);
      const response = await neo4j_instance.executeQuery(
        retriever_query.query,
        {
          k: options.k,
          embedding: queryEmbeddings[0].embedding,
          index: indexId,
          ...retriever_query.additionalParams,
        },
        {
          database: neo4jConfig.database,
        },
      );

      const documents = response.records.map((el) => {
        return Document.fromText(
          el.get("text"),
          Object.fromEntries(
            Object.entries(el.get("metadata")).filter(
              ([_, value]) => value !== null,
            ),
          ),
        );
      });

      neo4j_instance.close();
      return { documents };
    },
  );
}

const retrieverQuery = (
  options: { filter?: Record<string, any>; k?: number },
  params: Neo4jParams<any>,
) => {
  const filter = options.filter;
  const parallelQuery = "CYPHER runtime = parallel parallelRuntimeSupport=all ";

  const nodeLabel = params?.label ?? params.indexId;
  const embeddingNodeProperty = params?.embeddingProperty ?? "embedding";
  const textNodeProperty = params?.textProperty ?? "text";
  const idNodeProperty = params?.idProperty ?? "id";

  const retrievalQuery = params?.retrievalQuery ?? `RETURN node.${textNodeProperty} AS text, node {.*, ${textNodeProperty}: Null,
    ${embeddingNodeProperty}: Null, ${idNodeProperty}: Null } AS metadata`;

  if (!filter) {
    return {
      query: `
      CALL db.index.vector.queryNodes($index, $k, $embedding) YIELD node, score
      ${retrievalQuery}
      `,
      additionalParams: {},
    };
  }

  const [fSnippets, fParams] = constructMetadataFilter(filter);

  const indexQuery = `
    ${parallelQuery}
    MATCH (n:\`${nodeLabel}\`)
    WHERE n.\`${embeddingNodeProperty}\` IS NOT NULL
    ${fSnippets}
    WITH n as node, vector.similarity.cosine(n.\`${embeddingNodeProperty}\`, $embedding) AS score
    ORDER BY score DESC LIMIT toInteger($k)
    ${retrievalQuery}
  `;

  return { query: indexQuery, additionalParams: fParams };
};

export function configureNeo4jIndexer<
  EmbedderCustomOptions extends z.ZodTypeAny,
>(
  ai: Genkit,
  params: Neo4jParams<EmbedderCustomOptions>,
) {
  const { indexId, embedder, embedderOptions, label, embeddingProperty = 'embedding', idProperty, textProperty = 'text' } = params;
  const neo4jConfig = params.clientParams ?? getDefaultConfig();
  const neo4j_instance = neo4j_driver.driver(
    neo4jConfig.url,
    neo4j_driver.auth.basic(neo4jConfig.username, neo4jConfig.password),
  );

  return ai.defineIndexer(
    {
      name: `neo4j/${params.indexId}`,
    },
    async (docs, options) => {
      const embeddings = await Promise.all(
        docs.map((doc) =>
          ai.embed({ embedder, content: doc, options: embedderOptions }),
        ),
      );

      const BATCH_SIZE = 1000;
      const labelName = label || indexId;

      for (let i = 0; i < docs.length; i += BATCH_SIZE) {
        const batchDocs = docs.slice(i, i + BATCH_SIZE);
        const batchEmbeddings = embeddings.slice(i, i + BATCH_SIZE);

        const batchParams = batchDocs.map((el, j) => ({
          text: el.content[0]["text"],
          metadata: el.metadata ?? {},
          embedding: batchEmbeddings[j][0]["embedding"],
        }));
        
        const createOrMerge = idProperty 
          ? `MERGE (t:\`${labelName}\` {${idProperty}: row.id})`
          : `CREATE (t:\`${labelName}\`)`;
          
        const creationQuery = params?.creationQuery ?? `
          UNWIND $data AS row
          ${createOrMerge}
          SET t.${textProperty} = row.text,
              t += row.metadata
          WITH t, row.embedding AS embedding
          CALL db.create.setNodeVectorProperty(t, $embedding, embedding)
        `;

        await neo4j_instance.executeQuery(
          creationQuery,
          { data: batchParams, embedding: embeddingProperty },
          { database: neo4jConfig.database },
        );
      }

      await neo4j_instance.executeQuery(
        `CREATE VECTOR INDEX $indexName IF NOT EXISTS FOR (n:\`${labelName}\`) ON n.embedding`,
        { indexName: indexId },
        { database: neo4jConfig.database },
      );

      neo4j_instance.close();
    },
  );
}

function getDefaultConfig() {
  const {
    NEO4J_URI: url,
    NEO4J_USERNAME: username,
    NEO4J_PASSWORD: password,
    NEO4J_DATABASE: database,
  } = process.env;

  if (!url || !username || !password) {
    throw new Error(
      "Please provide Neo4j connection details through environment variables: NEO4J_URI, NEO4J_USERNAME, and NEO4J_PASSWORD are required.",
    );
  }

  return { url, username, password, ...(database && { database }) };
}

/**
 * --- CONFIGURAZIONE PARENT-CHILD CON llm-chunk ---
 */
export function configureNeo4jParentChild<
  EmbedderCustomOptions extends z.ZodTypeAny,
>(
  ai: Genkit,
  params: Neo4jParams<EmbedderCustomOptions>,
) {
  const { indexId, embedder, embedderOptions } = params;
  const neo4jConfig = params.clientParams ?? getDefaultConfig();
  const neo4j_instance = neo4j_driver.driver(
    neo4jConfig.url,
    neo4j_driver.auth.basic(neo4jConfig.username, neo4jConfig.password),
  );

  const chunkingConfig = {
    minLength: 1000,
    maxLength: 2000,
    splitter: 'sentence',
    overlap: 100,
    delimiters: '',
  } as any;

  ai.defineTool(
  {
    name: `neo4j/${indexId}/parentChildIngestor`,
    description: "Ingest documents with parent-child-subchunk structure in Neo4j",
  },
  async ({ documents }: { documents: { id?: string; text: string; metadata?: any }[] }) => {
    // Lazy import chunk with a clear error if it's missing
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

    const session = neo4j_instance.session();

    const chunkingConfig = {
      minLength: 1000,
      maxLength: 2000,
      splitter: 'sentence',
      overlap: 100,
      delimiters: '',
    } as any;

    for (const doc of documents) {
      const docId = doc.id ?? uuidv4();
      const chunks = await chunk(doc.text, chunkingConfig);

      for (const chunkText of chunks) {
        const chunkId = uuidv4();
        const subChunks = await chunk(chunkText, { ...chunkingConfig, minLength: 300, maxLength: 500, overlap: 50 });
        const embeddings = await Promise.all(subChunks.map(s => ai.embed({ embedder, content: s, options: embedderOptions })));

        await session.run(
          `MERGE (d:Document {id: $docId})
           ON CREATE SET d.createdAt = timestamp(), d.metadata = $metadata
           MERGE (c:Chunk {id: $chunkId})
           SET c.text = $chunkText
           MERGE (d)-[:HAS_CHUNK]->(c)`,
          { docId, metadata: doc.metadata ?? {}, chunkId, chunkText },
        );

        for (let i = 0; i < subChunks.length; i++) {
          const subId = uuidv4();
          const embedding = embeddings[i][0].embedding;
          await session.run(
            `MERGE (s:SubChunk {id: $subId})
             SET s.text = $text, s.embedding = $embedding
             MERGE (c:Chunk {id: $chunkId})
             MERGE (c)-[:HAS_SUBCHUNK]->(s)`,
            { subId, text: subChunks[i], embedding, chunkId },
          );
        }
      }
    }

    await session.close();
    return { status: "ok", count: documents.length };
  },
);


  ai.defineRetriever(
    {
      name: `neo4j/${indexId}/parentChildRetriever`,
      configSchema: Neo4jRetrieverOptionsSchema,
    },
    async (query, options) => {
      const session = neo4j_instance.session();
      const queryEmbedding = (await ai.embed({ embedder, content: query, options: embedderOptions }))[0].embedding;

      const result = await session.run(
        `CALL db.index.vector.queryNodes('subchunk_embedding_index', $k, $embedding)
         YIELD node AS sub, score
         MATCH (sub)<-[:HAS_SUBCHUNK]-(c:Chunk)<-[:HAS_CHUNK]-(d:Document)
         RETURN d.id AS documentId, c.text AS chunkText, sub.text AS subText, score
         ORDER BY score DESC`,
        { k: options.k ?? 5, embedding: queryEmbedding },
      );

      await session.close();

      return {
        documents: result.records.map((r) =>
          Document.fromText(r.get("subText"), {
            documentId: r.get("documentId"),
            chunkText: r.get("chunkText"),
            score: r.get("score"),
          }),
        ),
      };
    },
  );
}

/**
 * --- PLUGIN NEO4J ---
 */
export function neo4j<EmbedderCustomOptions extends z.ZodTypeAny>(
  params: Neo4jParams<EmbedderCustomOptions>[],
): GenkitPlugin {
  return genkitPlugin("neo4j", async (ai: Genkit) => {
    params.map((i) => configureNeo4jRetriever(ai, i));
    params.map((i) => configureNeo4jIndexer(ai, i));
    params.map((i) => configureNeo4jParentChild(ai, i));
  });
}

export default neo4j;
