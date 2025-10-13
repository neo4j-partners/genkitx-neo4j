import { genkit, Document } from "genkit";
import neo4j from "neo4j-driver";
import { z } from "zod";

// -------------------------------
// 🔹 INIT
// -------------------------------
const driver = neo4j.driver(
  "bolt://localhost:7689",
  neo4j.auth.basic("neo4j", "apoc12345")
);

// -------------------------------
// 🔹 Mock Embedder
// -------------------------------
const ai = genkit({});

const mockEmbedder = ai.defineEmbedder(
  {
    name: "mock-embedder",
    info: { label: "Mock Embedder", dimensions: 10 },
  },
  async (documents: Document[]) => {
    return {
      embeddings: documents.map((doc) => {
        const text = doc.content.map((block) => block.text).join(" ");
        const vector = Array.from({ length: 10 }, (_, i) =>
          Math.sin(text.charCodeAt(0) + i)
        );
        return { embedding: vector, metadata: { source: "mock" } };
      }),
    };
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
  const embedding = result[0].embedding;
  console.log("Embedding:", embedding);

  const entities = text.match(/\b[A-Z][a-z]+\b/g) || [];
  const relations = entities.slice(0, -1).map((e, i) => ({
    from: e,
    to: entities[i + 1],
    type: "related",
  }));

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
  console.log(`✅ Ingested: ${docId}, Entities: ${entities.join(", ")}`);
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
// 🔎 Neo4j Retriever
// -------------------------------
async function neo4jRetriever(query: string, k = 5) {
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
    // input può essere un singolo Document o un array
    const inputs = Array.isArray(input) ? input : [input];

    const q = inputs
      .map((doc) => doc.content.map((b) => b.text).join(" "))
      .join(" ");

    const kVector = config?.kVector ?? 2;
    const kGraph = config?.kGraph ?? 2;

    // Vector retrieval usando mockEmbedder
    // const vectorDocsRaw = await ai.retrieve({
    //   retriever: mockEmbedder,
    //   query: q,
    //   options: { k: kVector },
    // });
    const vectorDocsRaw = await ai.retrieve({
      retriever: mockEmbedder,
      input: inputs, // <-- passa gli oggetti Document
      query: { content: inputs.flatMap(d => d.content) }, // schema corretto
      options: { k: kVector },
    });


    const vectorDocs = vectorDocsRaw.map((d: any) => ({
      text: q,
      metadata: { source: "vector" },
    }));

    // Graph retrieval usando Neo4j
    const graphDocs = await neo4jRetriever(q, kGraph);

    const merged = [...vectorDocs, ...graphDocs];
    const kTotal = config?.kTotal ?? merged.length;

    console.log("🟢 HybridRetriever merged results:", merged);
    return merged.slice(0, kTotal);
  }
);


// -------------------------------
// 🤖 Query
// -------------------------------
async function ask(queryText: string) {
  const docs = await ai.retrieve({
    retriever: hybridRetriever,
    // Qui passiamo direttamente l'array di Document
    query: new Document({ content: [{ text: queryText }] }),
    options: { kVector: 3, kGraph: 3, kTotal: 5, query: queryText },
  });

  console.log("\n❓ Query:", queryText);
  console.log("💡 Documents found:", docs.map((d) => d.text));
}

// -------------------------------
// 🚀 MAIN
// -------------------------------
async function main() {
  await runIngestion();
  await ask("Einstein");
  await ask("Curie");
  await ask("Newton");

  await driver.close();
  process.exit(0);
}

main().catch(console.error);
