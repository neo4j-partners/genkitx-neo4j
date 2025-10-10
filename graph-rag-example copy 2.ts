import { genkit } from "genkit";
import { z } from "zod";
import { driver as neo4jDriver, auth, Driver } from "neo4j-driver";
import neo4j, { neo4jIndexerRef, neo4jRetrieverRef } from "./src";
import { googleAI } from '@genkit-ai/googleai';

/*
TODO:

https://github.com/firebase/genkit/blob/main/js/testapps/rag/src/simple-rag.ts#L74


https://github.dev/langchain4j/langchain4j-community
    - ParentChildEmbeddingStoreIngestor
    final ParentChildEmbeddingStoreIngestor ingestor = ParentChildEmbeddingStoreIngestor.builder()
                .documentSplitter(splitter)
                .embeddingStore(embeddingStore)
                .embeddingModel(embeddingModel)
                .build();



Dire qualcosa tipo: non ci sono interfacce per RAG in genkit, 
quindi creo un retriever che fa una ricerca full text su neo4j e ritorna i nodi trovati come documenti.

todo todo ------> https://chatgpt.com/share/68df8a01-2db8-800c-a111-71cc129aebe1


- [ ] graphRAG retriever: TODO
    - [ ] https://github.com/firebase/genkit/blob/main/js/testapps/rag/src/simple-rag.ts
https://github.dev/langchain4j/langchain4j-community

--->tipo questo qua ParentChildEmbeddingStoreIngestor


- SummaryGraphIngestor

- ParentChildGraphIngestor

- final ParentChildEmbeddingStoreIngestor ingestor = ParentChildEmbeddingStoreIngestor.builder()
                .documentSplitter(splitter)
                .embeddingStore(embeddingStore)
                .embeddingModel(embeddingModel)
                .build();


*/






// -------------------------------
// 🔹 Mock Embedder Plugin
// -------------------------------

/*function  mockEmbedderPlugin() {
  return {
    name: "mock-embedder-plugin",
    version: "v2" as const,
    setup(ai: any) {
      ai.defineEmbedder(
        {
          name: "mock-embedder",
          inputSchema: z.string(),
          outputSchema: z.array(
            z.object({
              embedding: z.array(z.number()),
            })
          ),
        },
        async (text: string) => {
          const vector = Array.from({ length: 10 }, (_, i) =>
            Math.sin(text.charCodeAt(0) + i)
          );
          return [{ embedding: vector }];
        }
      );
    },
  };
} */

// -------------------------------
// 🔹 Neo4j Plugin Retriever
// -------------------------------
function neo4jRetrieverPlugin(driver: Driver, indexId: string) {
  return {
    name: "neo4j-retriever-plugin",
    version: "v2" as const,
    setup(ai: any) {
      ai.defineRetriever(
        {
          name: "neo4jRetriever",
          configSchema: z
            .object({
              k: z.number().optional(),
            })
            .optional(),
          content: "text",
          metadata: ["source", "embedding"],
        },
        async (input: { text: string }, config?: { k?: number }) => {
          const k = config?.k ?? 5;
          const session = driver.session();
          try {
            const result = await session.run(
              `
              MATCH (e:${indexId})
              WHERE e.name CONTAINS $q
              RETURN e.name as text, e.embedding as embedding
              LIMIT $limit
              `,
              { q: input.text, limit: k }
            );

            return result.records.map((rec) => ({
              text: rec.get("text"),
              embedding: rec.get("embedding"),
              metadata: { source: "neo4j" },
            }));
          } finally {
            await session.close();
          }
        }
      );
    },
  };
}

// -------------------------------
// 🔑 INIT
// -------------------------------
const driver = neo4jDriver(
  "bolt://localhost:7689",
  auth.basic("neo4j", "apoc12345")
);

const indexId = 'genkit-test-index';

const clientParams = {
    url: process.env.NEO4J_URI as string,
    username: process.env.NEO4J_USERNAME as string,
    password: process.env.NEO4J_PASSWORD as string,
    database: 'neo4j',
};
const ai = genkit({
  plugins: [
    googleAI(),
    neo4j([
        {
        indexId, // The index ID to configure
        embedder: googleAI.embedder('gemini-embedding-001'), // Embedder to use
        clientParams, // Neo4j connection parameters
        },
    ]),
    neo4jRetrieverPlugin(driver, indexId)
],
});



const INDEXER_REF = neo4jIndexerRef({ indexId });
const RETRIEVER_REF = neo4jRetrieverRef({ indexId });

const embedder = ai.defineEmbedder(
    { name: 'echoEmbedder' },
    async (input, config) => {
      (embedder as any).lastRequest = [input, config];
      return {
        embeddings: [
          {
            embedding: [1, 2, 3, 4],
          },
        ],
      };
    }
  );

// const embedder = "mock-embedder-plugin/mock-embedder";

// -------------------------------
// 📥 INGESTION
// -------------------------------
async function ingestDocument(text: string) {
  const result = await ai.embed({ embedder, content: text });
  const embedding = result[0].embedding;

  const entities = text.match(/\b[A-Z][a-z]+\b/g) || [];
  const relations = entities.slice(0, -1).map((e, i) => ({
    from: e,
    to: entities[i + 1],
    type: "related",
  }));

  const session = driver.session();
  try {
    for (const e of entities) {
      await session.run(
        `MERGE (n:Entity {name: $name, embedding: $embedding})`,
        { name: e, embedding }
      );
    }
    for (const r of relations) {
      await session.run(
        `
        MATCH (a:Entity {name: $from}), (b:Entity {name: $to})
        MERGE (a)-[:REL {type: $type}]->(b)
        `,
        r
      );
    }
  } finally {
    await session.close();
  }
}

// -------------------------------
// 🔎 QUERY
// -------------------------------
async function ask(query: string) {
  const docs = await ai.retrieve({
    retriever: RETRIEVER_REF,
    query,
    options: {
        k: 10
      }
  });

  console.log("\n❓ Domanda:", query);
  console.log("💡 Documenti trovati:", docs.map((d) => d.text));
}

// -------------------------------
// 🚀 MAIN
// -------------------------------
async function main() {
  await ingestDocument(
    "Albert Einstein was a physicist who developed the theory of relativity."
  );
  await ingestDocument(
    "Marie Curie discovered radium and polonium, and conducted pioneering research on radioactivity."
  );
  await ingestDocument(
    "Isaac Newton formulated the laws of motion and universal gravitation."
  );

  await ask("Einstein");
  await ask("Curie");
  await ask("Newton");

  await driver.close();
}

main().catch(console.error);
