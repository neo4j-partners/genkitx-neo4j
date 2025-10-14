import { genkit, Document } from "genkit";
import { googleAI } from "@genkit-ai/googleai";
import { z } from "zod";
import {
  neo4j,
  neo4jIndexerRef,
  neo4jRetrieverRef,
} from "./src";

// -------------------------------
// 🔹 INIT Genkit con plugin Neo4j
// -------------------------------
console.log("🚀 Initializing Genkit with GoogleAI + Neo4j plugin...");

// 
// 
// 
// 
// TODO - andrebbe un altro plugin separato che richiama embedding??
// TODO - no, forse metto giusto un retriever richiamabile dentro il plugin??
// 
const ai = genkit({
  plugins: [
    googleAI(),
    neo4j([
      {
        // retriever: QUI METTO IL RETRIEVER RICHIAMABILE PER LA RAG
        indexId: "my-graph-index",
        embedder: googleAI.embedder("text-embedding-004"),
        retrievalQuery: `
          MATCH (e:Entity)-[r]->(n)
          WHERE e.name CONTAINS $q
          RETURN n.name as text, properties(n) as metadata
          LIMIT $limit
        `,
        creationQuery: 'CREATE (N)',
        clientParams: {
          url: process.env.NEO4J_URI as string,
          username: process.env.NEO4J_USERNAME as string,
          password: process.env.NEO4J_PASSWORD as string,
          database: process.env.NEO4J_DATABASE ?? "neo4j",
        },
      },
    ]),
  ],
});

console.log("✅ Genkit initialized with Neo4j index 'my-graph-index'");

// -------------------------------
// 🔹 INDEXER / RETRIEVER REFERENCES
// -------------------------------
export const myNeo4jIndexer = neo4jIndexerRef({ indexId: "my-graph-index" });
export const myNeo4jRetriever = neo4jRetrieverRef({
  indexId: "my-graph-index",
  retrievalQuery: `
    MATCH (e:Entity)-[r]->(n)
    WHERE e.name CONTAINS $q
    RETURN n.name as text, properties(n) as metadata
    LIMIT $limit
  `,
});

// -------------------------------
// 📥 INGEST / INDEXING
// -------------------------------
async function runIngestion() {
  console.log("\n🚀 Starting dataset ingestion...");

  const docs = [
    new Document({
      content: [
        { text: "Albert Einstein was a physicist who developed the theory of relativity." }
      ],
      metadata: { uniqueId: "doc1" },
    }),
    new Document({
      content: [
        { text: "Marie Curie discovered radium and polonium, and conducted pioneering research on radioactivity." }
      ],
      metadata: { uniqueId: "doc2" },
    }),
    new Document({
      content: [
        { text: "Isaac Newton formulated the laws of motion and universal gravitation." }
      ],
      metadata: { uniqueId: "doc3" },
    }),
  ];

  console.log(`⚙️ Sending all ${docs.length} documents to Neo4j indexer at once...`);
  await ai.index({
    indexer: myNeo4jIndexer,
    documents: docs,
  });

  console.log(`✅ All ${docs.length} documents indexed in Neo4j.`);
}


// -------------------------------
// 🔎 DEFINE FLOW (GRAPH RAG)
// -------------------------------
export const graphRagFlow = ai.defineFlow(
  {
    name: "graph-rag-flow",
    inputSchema: z.object({ query: z.string() }),
    outputSchema: z.string(),
  },
  async (input) => {
    console.log("\n🔍 [FLOW] Starting GraphRAG flow for query:", input.query);

    // Step 1️⃣ — Retrieval
    console.log("🔎 Retrieving relevant nodes from Neo4j via retriever...");
    const retrievedDocs = await ai.retrieve({
      retriever: myNeo4jRetriever,
      query: input.query,
      options: { k: 5 },
    });

    if (retrievedDocs.length === 0) {
      console.warn("⚠️ No documents retrieved for:", input.query);
      return "No relevant information found in the Neo4j knowledge graph.";
    }

    console.log(`📚 Retrieved ${retrievedDocs.length} documents from Neo4j:`);
    retrievedDocs.forEach((d, i) => {
      console.log(`   ${i + 1}. "${d.text}"`);
    });

    const context = retrievedDocs.map((d) => d.text).join("\n---\n");

    // Step 2️⃣ — Generation
    console.log("\n🧠 Sending context to LLM (Gemini) for answer generation...");
    const response = await ai.generate({
      model: "googleai/gemini-1.5-flash",
      prompt: `
You are a helpful assistant.
Answer the following question using ONLY the context provided.

Context:
${context}

Question: ${input.query}
      `,
    });

    console.log("💡 Model response received:");
    console.log(response.text);

    return response.text;
  }
);

// -------------------------------
// 🚀 MAIN
// -------------------------------
async function main() {
  console.log("🟢 Starting GraphRAG main execution...");

  // Step 1 — Ingestion
  await runIngestion();

  // Step 2 — Run Queries
  const queries = ["Albert", "Marie", "Isaac"];
  for (const q of queries) {
    console.log("\n==========================================");
    console.log(`❓ Running RAG flow for: "${q}"`);
    const ans = await graphRagFlow({ query: q });
    console.log(`💬 Final Answer for "${q}":`);
    console.log(ans);
  }

  console.log("\n🏁 All queries processed successfully!");
}

main().catch((err) => {
  console.error("❌ Error in main execution:", err);
  process.exit(1);
});
