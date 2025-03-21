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

import { Neo4jVectorStore } from './vector';
import { Document, defineRetriever } from '@genkit-ai/ai/retriever';
import { Neo4jRetrieverOptionsSchema } from './index'
import { Genkit } from 'genkit';

/**
 * Configures a Neo4j retriever.
 */
export function configureNeo4jRetriever(  
  ai: Genkit,
  params: {
  neo4jStore: Neo4jVectorStore;
  indexId: string;
}) {
  const { indexId } = {
    ...params,
  };
  const neo4jStore = params.neo4jStore;

  return ai.defineRetriever(
    {
      name: `neo4j/${indexId}`,
      configSchema: Neo4jRetrieverOptionsSchema,
    },
    async (query, options) => {
      const docs = await neo4jStore.fromExistingIndex(
        options.vectorConfig
      ).then(
          store => store.similaritySearch(query, options.k));
      
      return {
        documents: docs.map(doc => {
          const _doc = Document.fromText(doc.text, doc.metadata);
          return _doc.toJSON()
        })
      };
    }
  );
}