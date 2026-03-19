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
import { randomUUID } from 'crypto';
import { SearchStrategy, VectorFunctionStrategy } from "./search-strategy";

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
  searchType?: SearchType;
  fullTextRetrievalQuery?: string;
  fullTextIndexName?: string;
  fullTextQuery?: string;
  searchStrategy?: SearchStrategy;
  filterMetadata?: string[];
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

export function configureNeo4jRetriever<
  EmbedderCustomOptions extends z.ZodTypeAny,
>(
  ai: Genkit,
  params: Neo4jParams<EmbedderCustomOptions>,
) {
  const { indexId, embedder, embedderOptions, searchStrategy } = { ...params };
  const neo4jConfig = params.clientParams ?? getDefaultConfig();
  const neo4j_instance = neo4j_driver.driver(
    neo4jConfig.url, // URL (protocol://host:port)
    neo4j_driver.auth.basic(neo4jConfig.username, neo4jConfig.password), // Authentication
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
      return { documents: documents };
    },
  );
}

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

type SearchType = "vector" | "hybrid";

