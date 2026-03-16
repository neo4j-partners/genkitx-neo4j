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
import { Genkit, z } from "genkit";
import { GenkitPlugin, genkitPlugin } from "genkit/plugin";

import { EmbedderArgument } from "genkit/embedder";
import {
  CommonRetrieverOptionsSchema,
  Document,
  indexerRef,
  retrieverRef,
} from "genkit/retriever";
import { randomUUID } from 'crypto';
import { SearchStrategy, VectorFunctionStrategy } from "./search-strategy";
import { constructMetadataFilter } from "./filter-utils";
import { ParentChildRetriever, HypotheticalQuestionRetriever } from "./rag-utils";

export const FULLTEXT_INDEX_SUFFIX = "__fulltext";
export const errorMetadataAndHybrid =  "Metadata filtering can't be use in combination with a hybrid search approach."

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

export const neo4jParentChildRetrieverRef = (params: {
  indexId: string;
  displayName?: string;
}) => {
  return retrieverRef({
    name: `neo4j-parent-child/${params.indexId}`,
    info: { label: params.displayName ?? `Neo4j Parent-Child - ${params.indexId}` },
    configSchema: Neo4jRetrieverOptionsSchema,
  });
};

export const neo4jHyDERetrieverRef = (params: {
  indexId: string;
  displayName?: string;
}) => {
  return retrieverRef({
    name: `neo4j-hyde/${params.indexId}`,
    info: { label: params.displayName ?? `Neo4j HyDE - ${params.indexId}` },
    configSchema: Neo4jRetrieverOptionsSchema,
  });
};

/**
 * neo4jIndexerRef function creates an indexer for Neo4j.
 * @param params The params for the new Neo4j indexer.
 * @param params.indexId The indexId for the Neo4j indexer.
 * @param params.displayName  A display name for the indexer.
If not specified, the default label will be `Neo4j - <indexId>`
 * @returns A reference to a Neo4j indexer.
 */
export const neo4jIndexerRef = (params: {
  indexId: string;
  displayName?: string;
  creationQuery?: string;
}) => {
  return indexerRef({
    name: `neo4j/${params.indexId}`,
    info: {
      label: params.displayName ?? `Neo4j - ${params.indexId}`,
    },
  });
};

export interface Neo4jParams<EmbedderCustomOptions extends z.ZodTypeAny> {
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
  searchType?: SearchType;
  fullTextRetrievalQuery?: string;
  fullTextIndexName?: string;
  fullTextQuery?: string;
  searchStrategy?: SearchStrategy;
  filterMetadata?: string[];
  ragModel?: any;
}

/**
 * Neo4j plugin that provides a Neo4j retriever and indexer
 * @param params An array of params to set up Neo4j retrievers and indexers
 * @param params.clientParams Neo4jConfiguration containing the
username, password, and url. If not set, the NEO4J_URI, NEO4J_USERNAME,
and NEO4J_PASSWORD environment variable will be used instead.
 * @param params.indexId The name of the index
 * @param params.embedder The embedder to use for the indexer and retriever
 * @param params.embedderOptions  Options to customize the embedder
 * @returns The Neo4j Genkit plugin
 */
export function neo4j<EmbedderCustomOptions extends z.ZodTypeAny>(
  params: Neo4jParams<EmbedderCustomOptions>[],
): GenkitPlugin {
  return genkitPlugin("neo4j", async (ai: Genkit) => {
    params.map((i) => configureNeo4jRetriever(ai, i));
    params.map((i) => configureNeo4jIndexer(ai, i));
    
    // Register Genkit GraphRAG Retrievers & Tools
    params.map((i) => configureNeo4jGraphRagRetrievers(ai, i));
    params.map((i) => configureNeo4jGraphRagTools(ai, i));
  });
}

export default neo4j;

export function configureNeo4jGraphRagRetrievers<EmbedderCustomOptions extends z.ZodTypeAny>(
  ai: Genkit,
  params: Neo4jParams<EmbedderCustomOptions>,
) {
  const { indexId, ragModel } = params;
  const neo4jConfig = params.clientParams ?? getDefaultConfig();
  const indexer = neo4jIndexerRef({ indexId });
  const vectorRetriever = neo4jRetrieverRef({ indexId });

  ai.defineRetriever(
    {
      name: `neo4j-parent-child/${indexId}`,
      configSchema: Neo4jRetrieverOptionsSchema,
    },
    async (content, options) => {
      const pcRetriever = new ParentChildRetriever(ai, neo4jConfig, indexer, vectorRetriever, ragModel);
      const documents = await pcRetriever.retrieve(content.text ?? '', options?.k);
      return { documents };
    }
  );

  ai.defineRetriever(
    {
      name: `neo4j-hyde/${indexId}`,
      configSchema: Neo4jRetrieverOptionsSchema,
    },
    async (content, options) => {
      const hydeRetriever = new HypotheticalQuestionRetriever(ai, neo4jConfig, indexer, vectorRetriever, ragModel);
      const documents = await hydeRetriever.retrieve(content.text ?? '', options?.k);
      return { documents };
    }
  );
}

export function configureNeo4jGraphRagTools<EmbedderCustomOptions extends z.ZodTypeAny>(
  ai: Genkit,
  params: Neo4jParams<EmbedderCustomOptions>,
) {
  const { indexId } = params;
  const neo4jConfig = params.clientParams ?? getDefaultConfig();
  const indexer = neo4jIndexerRef({ indexId });
  const vectorRetriever = neo4jRetrieverRef({ indexId });

  ai.defineTool(
    {
      name: `neo4j/${indexId}/parentChildIngestor`,
      description: "Ingest documents with parent-child-subchunk structure in Neo4j",
    },
    async ({ documents }: { documents: { id?: string; text: string; metadata?: any }[] }) => {
      const pcRetriever = new ParentChildRetriever(ai, neo4jConfig, indexer, vectorRetriever);
      return await pcRetriever.ingestDocument({ documents });
    }
  );

  ai.defineTool(
    {
      name: `neo4j/${indexId}/hydeIngestor`,
      description: "Ingest documents for HyDE retrieval in Neo4j",
    },
    async ({ documents }: { documents: { id?: string; text: string; metadata?: any }[] }) => {
      const hydeRetriever = new HypotheticalQuestionRetriever(ai, neo4jConfig, indexer, vectorRetriever);
      return await hydeRetriever.ingestDocument({ documents });
    }
  );
}

export function configureNeo4jRetriever<
  EmbedderCustomOptions extends z.ZodTypeAny,
>(
  ai: Genkit,
  params: Neo4jParams<EmbedderCustomOptions>,
) {
  const { indexId, embedder, embedderOptions, searchStrategy } = { ...params };
  const neo4jConfig = params.clientParams ?? getDefaultConfig();
  const neo4j_instance = neo4j_driver.driver(
    neo4jConfig.url,
    neo4j_driver.auth.basic(neo4jConfig.username, neo4jConfig.password),
  );
  
  // Default to VectorFunctionStrategy
  const strategy = searchStrategy || new VectorFunctionStrategy();

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

      // Delegate query generation to the strategy
      const retriever_query = strategy.generateQuery(options, params, content?.text ?? '');
      
      const response = await neo4j_instance.executeQuery(
        retriever_query.query,
        {
          k: options.k,
          embedding: queryEmbeddings[0].embedding,
          index: indexId,
          ...retriever_query.additionalParams
        },
        { database: neo4jConfig.database },
      );
      
      const documents = response.records.map((el) => {
        return Document.fromText(
          el.get("text"),
          Object.fromEntries(
            Object.entries(el.get("metadata")).filter(([_, value]) => value !== null),
          ),
        );
      });

      neo4j_instance.close();
      return { documents };
    },
  );
}

const retrieverQuery = <EmbedderCustomOptions extends z.ZodTypeAny>(
  options: {
    filter?: Record<string, any> | undefined;
    k?: number | undefined;
  },
  params: Neo4jParams<EmbedderCustomOptions>,
  content: string,
): { query: string, additionalParams: Record<string, any> } => {
  const filter = options.filter;
  const { indexId, label, embeddingProperty = 'embedding', textProperty = 'text', fullTextIndexName = params.indexId + FULLTEXT_INDEX_SUFFIX } = params;

  const nodeLabel = label || indexId;

  const retrievalQuery = params?.retrievalQuery ?? `RETURN node.${textProperty} AS text, node {.*, text: Null,
      embedding: Null, id: Null } AS metadata`;

  const fullTextRetrievalQuery = params?.fullTextRetrievalQuery ?? retrievalQuery;
  const isHybrid = params?.searchType === 'hybrid';
  if (params?.fullTextQuery == undefined && content == undefined) {
    throw new Error("Neither fullTextQuery nor content is defined for hybrid search.");
  }

  if (filter == null) {
    const hybridQuery = `
          CALL {
              CALL db.index.vector.queryNodes($index, $k * 5, $embedding) YIELD node, score
              WITH collect({node:node, score:score}) AS nodes, max(score) AS max
              UNWIND nodes AS n
              // We use 0 as min
              RETURN n.node AS node, (n.score / max) AS score 
              UNION
              CALL db.index.fulltext.queryNodes("${fullTextIndexName}", $fullTextQuery, {limit: $k}) YIELD node, score
              WITH collect({node: node, score: score}) AS nodes, max(score) AS max
              UNWIND nodes AS n
              RETURN n.node AS node, (n.score / max) AS score
          }
          WITH node, max(score) AS score ORDER BY score DESC LIMIT toInteger($k)
          ${fullTextRetrievalQuery}`

    const vectorQuery = `
      CALL db.index.vector.queryNodes($index, $k, $embedding) YIELD node, score
      ${retrievalQuery}
      `;

    const query = isHybrid
      ? hybridQuery
      : vectorQuery;

    isHybrid && console.log("Generated Query name:", fullTextIndexName);

    const additionalParams = isHybrid
      ? { fullTextQuery: params?.fullTextQuery ?? content, fullTextIndexName: fullTextIndexName }
      : {};

    return { query, additionalParams };
  }

  if (isHybrid) {
    throw new Error(errorMetadataAndHybrid);
  }

  const baseIndexQuery = `
    CYPHER runtime = parallel parallelRuntimeSupport=all 
    MATCH (n:\`${nodeLabel}\`)
    WHERE n.\`${embeddingProperty}\` IS NOT NULL
    AND
  `;

  const baseCosineQuery = `
    WITH n as node, vector.similarity.cosine(
      n.\`${embeddingProperty}\`,
      $embedding
    ) AS score ORDER BY score DESC LIMIT toInteger($k)
  `;

  const [fSnippets, fParams] = constructMetadataFilter(filter);
  const indexQuery = baseIndexQuery + fSnippets + baseCosineQuery + retrievalQuery;

  return { query: indexQuery, additionalParams: fParams };
}


/**
 * Configures a Neo4j indexer.
 * @param ai A Genkit instance
 * @param params The params for the indexer
 * @param params.indexId The name of the indexer
 * @param params.clientParams Neo4jConfiguration containing the
username, password, and url. If not set, the NEO4J_URI, NEO4J_USERNAME,
and NEO4J_PASSWORD environment variable will be used instead.
 * @param params.embedder The embedder to use for the retriever
 * @param params.embedderOptions  Options to customize the embedder
 * @returns A Genkit indexer
 */
export function configureNeo4jIndexer<
  EmbedderCustomOptions extends z.ZodTypeAny,
>(
  ai: Genkit,
  params: Neo4jParams<EmbedderCustomOptions>
) {
  const { 
    indexId, 
    embedder, 
    embedderOptions,
    embeddingProperty = 'embedding',
    idProperty = 'id',
    label,
    textProperty = 'text',
    searchType = 'vector',
    fullTextIndexName = indexId + FULLTEXT_INDEX_SUFFIX,
    fullTextQuery,
    searchStrategy,
    filterMetadata = []
  } = {
    ...params,
  };
  const neo4jConfig = params.clientParams ?? getDefaultConfig();
  const neo4j_instance = neo4j_driver.driver(
    neo4jConfig.url,
    neo4j_driver.auth.basic(neo4jConfig.username, neo4jConfig.password),
  );

  const strategy = searchStrategy || new VectorFunctionStrategy();
  const cypherPrefix = strategy.cypherPrefix();

  return ai.defineIndexer(
    {
      name: `neo4j/${params.indexId}`,
    },
    async (docs, options) => {
      const embeddings = await Promise.all(
        docs.map((doc) =>
          ai.embed({
            embedder,
            content: doc,
            options: embedderOptions,
          }),
        ),
      );

      const BATCH_SIZE = 1000;
      const labelName = label || indexId;

      for (let i = 0; i < docs.length; i += BATCH_SIZE) {
        const batchDocs = docs.slice(i, i + BATCH_SIZE);
        const batchEmbeddings = embeddings.slice(i, i + BATCH_SIZE);

        const batchParams = batchDocs.map((el, j) => {
          return ({
            text: el.content[0]["text"],
            metadata: el.metadata ?? {},
            embedding: batchEmbeddings[j][0]["embedding"],
            id: el.content[0]["id"] || randomUUID(),
          })
        });

        const createOrMerge = `MERGE (t:\`${labelName}\` {${idProperty}: row.id})`;

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

      let withMetadataClause = "";
      if (filterMetadata.length > 0) {
        // Mappa le chiavi nell'array in formato n.`chiave` e le unisce con la virgola
        const metadataProps = filterMetadata.map(key => `n.\`${key}\``).join(", ");
        withMetadataClause = ` WITH [${metadataProps}]`;
      }

      const createVectorIndexQuery = `
      ${cypherPrefix}CREATE VECTOR INDEX $indexName IF NOT EXISTS
      FOR (n:\`${labelName}\`) ON (n.\`${embeddingProperty}\`)${withMetadataClause}
            `.trim();

      await neo4j_instance.executeQuery(
        createVectorIndexQuery,
        { indexName: indexId },
        { database: neo4jConfig.database },
      );

      if (fullTextQuery != undefined) {
        const fullTextIndexQuery = `
          CREATE FULLTEXT INDEX $fullTextIndexName IF NOT EXISTS
          FOR (n:\`${labelName}\`)
          ON EACH [n.\`${textProperty}\`]
          `;
          console.log("Creating fulltext index:", fullTextIndexQuery);
          console.log("With name:", fullTextIndexName);
        await neo4j_instance.executeQuery(
          fullTextIndexQuery,
          { fullTextIndexName: fullTextIndexName },
          { database: neo4jConfig.database },
        );
      }

      neo4j_instance.close();
    },
  );
}

function getDefaultConfig() {
  const { NEO4J_URI: url, NEO4J_USERNAME: username, NEO4J_PASSWORD: password, NEO4J_DATABASE: database } = process.env;

  if (!url || !username || !password) {
    throw new Error(
      "Please provide Neo4j connection details through environment variables: NEO4J_URI, NEO4J_USERNAME, and NEO4J_PASSWORD are required.\n" +
      "For more details see https://neo4j.com/docs/api/javascript-driver/current/",
    );
  }

  return { url, username, password, ...(database && { database }) };
}

type SearchType = "vector" | "hybrid";