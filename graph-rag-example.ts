import { genkit } from "genkit";
import { googleAI, gemini15Pro, textEmbeddingGecko001 } from "@genkit-ai/googleai";
import { defineFirestoreRetriever } from "@genkit-ai/firebase";
import * as admin from "firebase-admin";
import neo4j from "neo4j-driver";
import { z } from "zod";

// -------------------------------
// 🔑 INIT
// -------------------------------
admin.initializeApp();
const firestore = admin.firestore();

const ai = genkit({
  plugins: [googleAI()],
});

const driver = neo4j.driver(
  "bolt://localhost:7687",
  neo4j.auth.basic("neo4j", "password")
);

// -------------------------------
// 📥 INGESTION
// -------------------------------
async function ingestDocument(docId: string, text: string) {
  // 1. Embedding
  const embeddings = await ai.embed({
    embedder: textEmbeddingGecko001,
    content: text,
  });
  const embedding = embeddings[0].embedding;

  // 2. Salva in Firestore
  await firestore.collection("documentsCollection").doc(docId).set({
    text,
    embedding,
  });

  // 3. Estrazione entità/relazioni
  const entityResponse = await ai.generate({
    model: gemini15Pro,
    prompt: `
      Estrai entità e relazioni dal testo seguente.
      Rispondi in JSON come:
      { "entities": ["..."], "relations": [{ "from": "...", "to": "...", "type": "..."}] }
      Testo: ${text}
    `,
  });

  let entities: string[] = [];
  let relations: { from: string; to: string; type: string }[] = [];

  try {
    const parsed = JSON.parse(entityResponse.text);
    entities = parsed.entities ?? [];
    relations = parsed.relations ?? [];
  } catch (e) {
    console.warn("⚠️ Parsing entità fallito:", entityResponse.text);
  }

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

// Ingestione mini dataset
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
// 🔎 HYBRID RETRIEVER
// -------------------------------
const vectorRetriever = defineFirestoreRetriever(ai, {
  name: "myVectorRetriever",
  firestore,                  // 🔹 Aggiungi questa riga!
  collection: "documentsCollection",
  contentField: "text",
  vectorField: "embedding",
  embedder: textEmbeddingGecko001,
  distanceMeasure: "COSINE",
});


async function graphQuery(query: string, k: number) {
  const session = driver.session();
  const result = await session.run(
    `
    MATCH (e:Entity)-[r]->(n)
    WHERE e.name CONTAINS $q
    RETURN n.text as text, properties(n) as metadata
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
    metadata: ["source", "score"],
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
    query: query,
    options: { kVector: 3, kGraph: 3, kTotal: 5 },
  });

  const { text } = await ai.generate({
    model: gemini15Pro,
    prompt: `
      Rispondi alla domanda usando SOLO queste informazioni:
      ${docs.map((d) => d.text).join("\n\n")}
      
      Domanda: ${query}
    `,
  });

  console.log("\n❓ Domanda:", query);
  console.log("💡 Risposta:", text);
}

// -------------------------------
// 🚀 MAIN
// -------------------------------
async function main() {
  await runIngestion();
  await ask("Chi ha scoperto la teoria della relatività?");
  await ask("Chi ha fatto ricerca sulla radioattività?");
  await ask("Chi ha formulato le leggi del moto?");
  process.exit(0);
}

main();
