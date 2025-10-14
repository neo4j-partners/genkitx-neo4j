import { genkit, Document } from "genkit";
import { googleAI } from "@genkit-ai/googleai";
import neo4j from "neo4j-driver";
import { z } from "zod";

// -------------------------------
// 🔹 INIT
// -------------------------------
console.log("🚀 Starting Neo4j GraphRAG with Genkit...");

const driver = neo4j.driver(
  "bolt://localhost:7689",
  neo4j.auth.basic("neo4j", "apoc12345")
);

const ai = genkit({
  plugins: [googleAI()],
});

console.log("✅ Genkit + Neo4j initialized");

// -------------------------------
// 🔹 Embedder (mock)
// -------------------------------
const mockEmbedder = ai.defineEmbedder(
  {
    name: "mock-embedder",
    info: { label: "Mock Embedder", dimensions: 10 },
  },
  async (documents: Document[]) => {
    const embeddings = documents.map((doc) => {
      const text = doc.content.map((block) => block.text).join(" ");
      const vector = Array.from({ length: 10 }, (_, i) =>
        Math.sin(text.charCodeAt(0) + i)
      );
      return { embedding: vector, metadata: { source: "mock" } };
    });
    return { embeddings };
  }
);

// -------------------------------
// 🔹 Ingestion
// -------------------------------
async function ingestDocument(docId: string, text: string) {
  console.log(`\n📥 Ingesting: ${docId}`);
  const result = await ai.embed({
    embedder: mockEmbedder,
    content: text,
  });

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

  console.log(`✅ Ingested: ${docId} (Entities: ${entities.join(", ")})`);
}

async function runIngestion() {
  console.log("📥 Running ingestion dataset...");
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
  console.log("✅ Dataset ingested.");
}

// -------------------------------
// 🔹 Neo4j Retriever
// -------------------------------
async function neo4jRetriever(query: string, k = 5) {
  const session = driver.session();
  const limit = neo4j.int(k);

  const result = await session.run(
    `
    MATCH (e:Entity)-[r]->(n)
    WHERE e.name CONTAINS $q
    RETURN n.name as text, properties(n) as metadata
    LIMIT $limit
    `,
    { q: query, limit }
  );
  await session.close();

  const docs = result.records.map((rec) => ({
    text: rec.get("text"),
    metadata: rec.get("metadata"),
  }));

  console.log("🟢 Neo4jRetriever Results:", docs);
  return docs;
}

// -------------------------------
// 🔹 Define Retriever Component
// -------------------------------
const graphRetriever = ai.defineSimpleRetriever(
  {
    name: "graph-retriever",
    configSchema: z
      .object({
        k: z.number().default(3),
      })
      .optional(),
    content: "text",
    metadata: ["source"],
  },
  async (input: Document | Document[], config) => {
    const query = Array.isArray(input)
      ? input.map((d) => d.content.map((b) => b.text).join(" ")).join(" ")
      : input.content.map((b) => b.text).join(" ");

    const k = config?.k ?? 3;
    const docs = await neo4jRetriever(query, k);
    return docs.map(
      (d) => new Document({ content: [{ text: d.text }], metadata: d.metadata })
    );
  }
);

// -------------------------------
// 🔹 Define Flow (RAG)
// -------------------------------
export const graphRagFlow = ai.defineFlow(
  {
    name: "graph-rag-flow",
    inputSchema: z.object({ query: z.string() }),
    outputSchema: z.string(),
  },
  async (input) => {
    const queryDoc = new Document({ content: [{ text: input.query }] });

    // Step 1: Retrieve from Neo4j
    const retrievedDocs = await ai.retrieve({
      retriever: graphRetriever,
      input: [queryDoc],
      query: { content: [{ text: input.query }] },
      options: { k: 3 },
    });

    const contextText = retrievedDocs.map((d) => d.text).join("\n");

    // Step 2: Generate answer with context
    const response = await ai.generate({
      model: "googleai/gemini-2.0-flash",
      prompt: `
You are a helpful assistant. 
Answer the question based on the following context:

${contextText}

Question: ${input.query}
      `,
    });

    return response.text;
  }
);

// -------------------------------
// 🚀 MAIN
// -------------------------------
async function main() {
  await runIngestion();

  const questions = ["Albert", "Marie", "Isaac"];
  for (const q of questions) {
    console.log(`\n❓ Asking: ${q}`);
    const answer = await graphRagFlow({ query: q });
    console.log(`💬 Answer: ${answer}`);
  }

  await driver.close();
  console.log("✅ Neo4j driver closed. Done!");
}

main().catch(console.error);
