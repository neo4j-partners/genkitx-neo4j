import { genkit } from "genkit";
import { defineFirestoreRetriever } from "@genkit-ai/firebase";
import * as admin from "firebase-admin";
import neo4j from "neo4j-driver";
import { z } from "zod";
import { EmbedderInfoSchema } from "genkit/embedder";

// -------------------------------
// 🔑 INIT
// -------------------------------
admin.initializeApp();
const firestore = admin.firestore();

// -------------------------------
// 🔹 Mock Embedder Plugin
// -------------------------------
// function mockEmbedderPlugin() {
//   return {
//     name: "mock-embedder-plugin",
//     version: "v2" as const,
//     setup(ai: any) {
//       ai.defineEmbedder(
//         {
//           name: "mock-embedder",
//           inputSchema: z.string(),
//           outputSchema: z.object({
//             embeddings: z.array(
//               z.object({
//                 embedding: z.array(z.number()),
//               })
//             ),
//           }),
//         },
//         async (text: string) => {
//           // Genera un embedding fake di lunghezza 10
//           const vector = Array.from({ length: 10 }, (_, i) =>
//             Math.sin(text.charCodeAt(0) + i)
//           );

//           return { embeddings: [{ embedding: vector }] };
//         }
//       );
//     },
//   };
// }

const ai = genkit({
//   plugins: [mockEmbedderPlugin()],
});

// ai.defineEmbedder("mock-embedder",
//     // inputSchema: z.string(),
//     // outputSchema: z.object({
//     //   embeddings: z.array(
//     //     z.object({
//     //       embedding: z.array(z.number()),
//     //     })
//     //   ),
//     // }),
// //   },
// {}
// )


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
//   return embedder;

// -------------------------------
// 🔹 Neo4j
// -------------------------------
const driver = neo4j.driver(
  "bolt://localhost:7689",
  neo4j.auth.basic("neo4j", "apoc12345")
);

// -------------------------------
// 📥 INGESTION
// -------------------------------
async function ingestDocument(docId: string, text: string) {
  // 1. Embedding
  const result = await ai.embed({
    embedder: embedder,
    content: text,
  });
  const embedding = result[0].embedding[0];

  // TODO
  // TODO
  // TODO - necessario??
  // TODO
  // TODO
  // 2. Salva in Firestore
//   await firestore.collection("documentsCollection").doc(docId).set({
//     text,
//     embedding,
//   });

  // 3. Estrazione entità/relazioni fittizie
  const entities = text.match(/\b[A-Z][a-z]+\b/g) || [];
  const relations = entities.slice(0, entities.length - 1).map((e, i) => ({
    from: e,
    to: entities[i + 1],
    type: "related",
  }));

  // 4. Salva in Neo4j
  const session = driver.session();
  try {
    for (const e of entities) {
      await session.run(`MERGE (n:Entity {name: $name})`, { name: e });
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

  console.log(`✅ Ingested: ${docId}`);
}

// -------------------------------
// 📝 Mini Dataset
// -------------------------------
async function runIngestion() {
  await ingestDocument(
    "doc1",
    "Albert Einstein was a physicist who developed the theory of relativity."
  );
  await ingestDocument(
    "doc2",
    "Marie Curie discovered radium and polonium, and conducted pioneering research on radioactivity."
  );
  await ingestDocument(
    "doc3",
    "Isaac Newton formulated the laws of motion and universal gravitation."
  );
  console.log("📥 Dataset ingestito!");
}

// -------------------------------
// 🔎 RETRIEVER
// -------------------------------
const vectorRetriever = defineFirestoreRetriever(ai, {
  name: "myVectorRetriever",
  firestore,
  collection: "documentsCollection",
  contentField: "text",
  vectorField: "embedding",
  embedder: embedder,
  distanceMeasure: "COSINE",
});

async function graphQuery(query: string, k: number) {
  const session = driver.session();
  const result = await session.run(
    `
    MATCH (e:Entity)-[r]->(n)
    WHERE e.name CONTAINS $q
    RETURN n.name as text, properties(n) as metadata
    LIMIT $limit
    `,
    { q: query, limit: k }
  );
  await session.close();

  return result.records.map((rec) => ({
    text: rec.get("text"),
    metadata: rec.get("metadata"),
  }));
}

const hybridRetriever = ai.defineSimpleRetriever(
  {
    name: "hybridRetriever",
    configSchema: z
      .object({
        kVector: z.number().optional(),
        kGraph: z.number().optional(),
        kTotal: z.number().optional(),
      })
      .optional(),
    content: "text",
    metadata: ["source"],
  },
  async (input, config) => {
    const q = input.text;
    const kVector = config?.kVector ?? 2;
    const kGraph = config?.kGraph ?? 2;

    const vectorDocs = await ai.retrieve({
      retriever: vectorRetriever,
      query: q,
      options: { k: kVector },
    });

    const graphDocs = await graphQuery(q, kGraph);

    const merged = [
      ...vectorDocs.map((doc) => ({
        text: doc.content,
        metadata: { source: "vector", ...doc.metadata },
      })),
      ...graphDocs.map((d) => ({
        text: d.text,
        metadata: { source: "graph", ...d.metadata },
      })),
    ];

    const kTotal = config?.kTotal ?? merged.length;
    return merged.slice(0, kTotal);
  }
);

// -------------------------------
// 🤖 QUERY
// -------------------------------
async function ask(query: string) {
  const docs = await ai.retrieve({
    retriever: hybridRetriever,
    query,
    options: { kVector: 3, kGraph: 3, kTotal: 5 },
  });

  console.log("\n❓ Domanda:", query);
  console.log("💡 Documenti trovati:", docs.map((d) => d.text));
}

// -------------------------------
// 🚀 MAIN
// -------------------------------
async function main() {
  await runIngestion();
  await ask("Einstein");
  await ask("Curie");
  await ask("Newton");
  process.exit(0);
}

main().catch(console.error);
