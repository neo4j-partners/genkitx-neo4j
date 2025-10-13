import { genkit, Document } from "genkit";
import neo4j from "neo4j-driver";
import { z } from "zod";

// -------------------------------
// 🔹 INIT
// -------------------------------
console.log("🚀 Starting RAG example...");
const driver = neo4j.driver(
  "bolt://localhost:7689",
  neo4j.auth.basic("neo4j", "apoc12345")
);
console.log("✅ Neo4j driver initialized");

// -------------------------------
// 🔹 Mock Embedder
// -------------------------------
const ai = genkit({});
console.log("✅ Genkit initialized");

const mockEmbedder = ai.defineEmbedder(
  {
    name: "mock-embedder",
    info: { label: "Mock Embedder", dimensions: 10 },
  },
  async (documents: Document[]) => {
    console.log("🔹 Embedding documents:", documents);
    const embeddings = documents.map((doc) => {
      const text = doc.content.map((block) => block.text).join(" ");
      const vector = Array.from({ length: 10 }, (_, i) =>
        Math.sin(text.charCodeAt(0) + i)
      );
      return { embedding: vector, metadata: { source: "mock" } };
    });
    console.log("🔹 Generated embeddings:", embeddings);
    return { embeddings };
  }
);

// -------------------------------
// 📥 INGESTION
// -------------------------------
async function ingestDocument(docId: string, text: string) {
  console.log(`\n📥 Ingesting: ${docId}`);
  const result = await ai.embed({
    embedder: mockEmbedder,
    content: text,
  });
  console.log("🔹 Embedding result:", result);

  const embedding = result[0].embedding;
  console.log("Embedding vector:", embedding);

  const entities = text.match(/\b[A-Z][a-z]+\b/g) || [];
  console.log("Entities extracted:", entities);

  const relations = entities.slice(0, -1).map((e, i) => ({
    from: e,
    to: entities[i + 1],
    type: "related",
  }));
  console.log("Relations:", relations);

  const session = driver.session();
  try {
    for (const e of entities) {
      console.log(`MERGE entity: ${e}`);
      await session.run(`MERGE (n:Entity {name: $name})`, { name: e });
    }
    for (const r of relations) {
      console.log(`MERGE relation: ${r.from} -> ${r.to}`);
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
  console.log(`✅ Ingested: ${docId}, Entities: ${entities.join(", ")}`);
}

// -------------------------------
// 📝 Mini Dataset
// -------------------------------
async function runIngestion() {
  console.log("\n📥 Running dataset ingestion...");
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
// 🔎 Neo4j Retriever
// -------------------------------

async function neo4jRetriever(query: string, k = 5) {
  const session = driver.session();

  // Convertiamo k in Neo4j Integer
  const limit = neo4j.int(k);

  console.log("🔎 Neo4jRetriever called with query:", query, "limit:", limit.toString());

  const result = await session.run(
    `
    MATCH (e:Entity)-[r]->(n)
    WHERE e.name CONTAINS $q
    RETURN n.name as text, properties(n) as metadata
    LIMIT $limit
    `,
    { q: query, limit } // Passiamo Neo4j Integer
  );
  await session.close();

  const docs = result.records.map((rec) => ({
    text: rec.get("text"),
    metadata: rec.get("metadata"),
  }));
  console.log("🟢 Neo4j Retriever Results for", query, docs);
  return docs;
}




// -------------------------------
// 🔎 Hybrid Retriever
// -------------------------------
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
  async (input: Document | Document[], config) => {
    console.log("\n🔹 HybridRetriever called with input:", input, "config:", config);
    const inputs = Array.isArray(input) ? input : [input];
    console.log("🔹 Normalized inputs:", inputs);

    const q = inputs
      .map((doc) => doc.content.map((b) => b.text).join(" "))
      .join(" ");
    console.log("🔹 Query string:", q);

    const kVector = config?.kVector ?? 2;
    const kGraph = config?.kGraph ?? 2;

    // Vector retrieval
    // const vectorDocsRaw = await ai.retrieve({
    //   retriever: mockEmbedder,
    //   input: inputs, // <-- passa gli oggetti Document
    //   query: { content: inputs.flatMap(d => d.content) }, // schema corretto
    //   options: { k: kVector },
    // });
    // console.log("🔹 Vector retrieval raw:", vectorDocsRaw);

    const vectorDocs = inputs.map((d: any) => ({
      text: q,
      metadata: { source: "vector" },
    }));
    console.log("🔹 Vector docs processed:", vectorDocs);

    // Graph retrieval
    const graphDocs = await neo4jRetriever(q, kGraph);
    console.log("🔹 Graph docs:", graphDocs);

    const merged = [...vectorDocs, ...graphDocs];
    const kTotal = config?.kTotal ?? merged.length;
    console.log("🔹 Merged docs (total kTotal):", kTotal, merged);

    return merged.slice(0, kTotal);
  }
);

// -------------------------------
// 🤖 Query
// -------------------------------
async function ask(queryText: string) {
  console.log("\n❓ Asking query:", queryText);
  const docs = await ai.retrieve({
    retriever: hybridRetriever,
    input: [new Document({ content: [{ text: queryText }] })],
    query: {
      content: [{ text: queryText }], // <-- questo è richiesto
    },
    options: { kVector: 3, kGraph: 3, kTotal: 5 },
  });

  console.log("💡 Documents found:", docs.map((d) => d.text));
}

// -------------------------------
// 🚀 MAIN
// -------------------------------
async function main() {
  console.log("🚀 Main started");
  await runIngestion();
  await ask("Einstein");
  await ask("Curie");
  await ask("Newton");

  await driver.close();
  console.log("✅ Driver closed, exiting.");
  process.exit(0);
}

main().catch(console.error);
