/**
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
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
import { constructMetadataFilter } from "./filter-utils";


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

/**
 * neo4jRetrieverRef function creates a retriever for Neo4j.
 * @param params The params for the new Neo4j retriever
 * @param params.indexId The indexId for the Neo4j retriever
 * @param params.displayName  A display name for the retriever.
If not specified, the default label will be `Neo4j - <indexId>`
 * @returns A reference to a Neo4j retriever.
 */
export const neo4jRetrieverRef = (params: {
  indexId: string;
  displayName?: string;
}) => {
  return retrieverRef({
    name: `neo4j/${params.indexId}`,
    info: {
      label: params.displayName ?? `Neo4j - ${params.indexId}`,
    },
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
}) => {
  return indexerRef({
    name: `neo4j/${params.indexId}`,
    info: {
      label: params.displayName ?? `Neo4j - ${params.indexId}`,
    },
    //configSchema: Neo4jIndexerOptionsSchema.optional(),
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
  searchType?: SearchType;
  fullTextRetrievalQuery?: string;
  fullTextIndexName?: string;
  fullTextQuery?: string;
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
  });
}

export default neo4j;

/**
 * Configures a Neo4j retriever.
 * @param ai A Genkit instance
 * @param params The params for the retriever
 * @param params.indexId The name of the retriever
 * @param params.clientParams PNeo4jConfiguration containing the
username, password, and url. If not set, the NEO4J_URI, NEO4J_USERNAME,
and NEO4J_PASSWORD environment variable will be used instead.
 * @param params.embedder The embedder to use for the retriever
 * @param params.embedderOptions  Options to customize the embedder
 * @returns A Pinecone retriever
 */
export function configureNeo4jRetriever<
  EmbedderCustomOptions extends z.ZodTypeAny,
>(
  ai: Genkit,
  params: Neo4jParams<EmbedderCustomOptions>,
) {
  const { indexId, embedder, embedderOptions } = {
    ...params,
  };
  const neo4jConfig = params.clientParams ?? getDefaultConfig();
  const neo4j_instance = neo4j_driver.driver(
    neo4jConfig.url, // URL (protocol://host:port)
    neo4j_driver.auth.basic(neo4jConfig.username, neo4jConfig.password), // Authentication
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
          ...retriever_query.additionalParams
        },
        {
          database: neo4jConfig.database,
        },
      );
      // Create documents properly by returning the result from map
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
      return { documents: documents };
    },
  );
}

const retrieverQuery = <EmbedderCustomOptions extends z.ZodTypeAny>(
  options: {
    filter?: Record<string, any> | undefined;
    k?: number | undefined;
  },
  params: Neo4jParams<EmbedderCustomOptions>
): {query: string, additionalParams: Record<string, any>} => {
  const filter = options.filter;
  const { indexId, label, embeddingProperty = 'embedding', textProperty = 'text' } = params;

  const nodeLabel = label || indexId;
  
  const retrievalQuery = `RETURN node.${textProperty} AS text, node {.*, text: Null,
      embedding: Null, id: Null } AS metadata`;

  const fullTextRetrievalQuery = params?.fullTextRetrievalQuery ?? retrievalQuery;

  if (filter == null) {
    const vectorQuery = `
      CALL db.index.vector.queryNodes($index, $k, $embedding) YIELD node, score
      ${retrievalQuery}
      `;
      
    const query = params?.searchType === SearchType.hybrid
      ? `${vectorQuery} 
        UNION 
        CALL db.index.fulltext.queryNodes("${params?.fullTextIndexName ?? params.indexId}", $fullTextQuery) YIELD node, score 
        ${fullTextRetrievalQuery}
        `
      : vectorQuery;

    const additionalParams = params?.searchType === SearchType.hybrid
      ? {fullTextQuery: params?.fullTextQuery ?? ""}
      : {};

    return { query, additionalParams };
  }

  if (params?.searchType === SearchType.hybrid) {
    throw new Error("Metadata filtering can't be use in combination with a hybrid search approach.");
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

  return {query: indexQuery, additionalParams: fParams};
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
  const { indexId, 
    embedder, 
    embedderOptions,
    embeddingProperty = 'embedding',
    idProperty = 'id',
    label, 
    textProperty = 'text',
    searchType = SearchType.vector,
  } = {
    ...params,
  };
  const neo4jConfig = params.clientParams ?? getDefaultConfig();
  const neo4j_instance = neo4j_driver.driver(
    neo4jConfig.url, // URL (protocol://host:port)
    neo4j_driver.auth.basic(neo4jConfig.username, neo4jConfig.password), // Authentication
  );

  return ai.defineIndexer(
    {
      name: `neo4j/${params.indexId}`,
      //configSchema: neo4jIndexerOptionsSchema.optional(),
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
          id: el.content[0]["id"] || Date.now()
        })
      });

        const createOrMerge = `CREATE (t:\`${labelName}\` {${idProperty}: row.id})`;

        await neo4j_instance.executeQuery(
          `
          UNWIND $data AS row
          ${createOrMerge}
          SET t.${textProperty} = row.text,
              t += row.metadata
          WITH t, row.embedding AS embedding
          CALL db.create.setNodeVectorProperty(t, $embedding, embedding)
          `,
          { data: batchParams, embedding: embeddingProperty },
          { database: neo4jConfig.database },
        );
      }

      await neo4j_instance.executeQuery(
        `
        CREATE VECTOR INDEX $indexName IF NOT EXISTS
        FOR (n:\`${labelName}\`) ON n.embedding
        `,
        { indexName: indexId },
        { database: neo4jConfig.database },
      );

      if (searchType === SearchType.hybrid) {
        await neo4j_instance.executeQuery(
          `
          CREATE FULLTEXT INDEX $indexName_fulltext IF NOT EXISTS
          FOR (n:\`${labelName}\`)
          ON EACH [n.\`${textProperty}\`]
          `,
          { indexName: indexId },
          { database: neo4jConfig.database },
        );
      }

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
      "Please provide Neo4j connection details through environment variables: NEO4J_URI, NEO4J_USERNAME, and NEO4J_PASSWORD are required.\n" +
      "For more details see https://neo4j.com/docs/api/javascript-driver/current/",
    );
  }

  return {
    url,
    username,
    password,
    ...(database && { database }),
  };
}

enum SearchType { vector, hybrid }

