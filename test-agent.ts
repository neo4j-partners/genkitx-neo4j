import { genkit } from 'genkit';
import { neo4j } from './src'; // Your local plugin
import googleAI from '@genkit-ai/googleai';

export const geminiModel = 'googleai/gemini-2.5-flash'

const indexId = 'lino-memory-index';

const ai = genkit({
    plugins: [
        googleAI(),
        neo4j([{
            indexId: indexId,
            // The Python server handles the actual embedding logic (sentence_transformers)
            embedder: 'mock-embedder' as any,
            clientParams: {
                url: 'bolt://localhost:7687',
                username: 'neo4j',
                password: 'password'
            },
            enableAgentMemoryTools: true,
        }]),
    ],
    model: geminiModel,
});

async function runLinoBanfiAgent() {
    console.log("🚀 Starting Genkit Cognitive Agent with Neo4j Memory...");

    // 1. Retrieve the tools registered by your plugin
    const addEntityTool = await ai.registry.lookupAction(`/tool/neo4j/${indexId}/addMemoryEntity`);
    const searchTool = await ai.registry.lookupAction(`/tool/neo4j/${indexId}/searchMemoryEntities`);

    if (!addEntityTool || !searchTool) {
        throw new Error("Required tools not found! Check your plugin registration.");
    }

    // --- SCENARIO 1: Storing a Fact (Long-term Memory) ---
    console.log("\n--- Scenario 1: Information Ingestion ---");

    const ingestPrompt = `
    Lino Banfi is a legendary Italian actor known for his iconic role as Oronzo Canà. 
    He is a master of comedy and deeply loved in Italy. 
    Please save this information to your memory using the appropriate tools.
  `;

    const ingestResponse = await ai.generate({
        prompt: ingestPrompt,
        tools: [addEntityTool],
        config: { temperature: 0.1 } // Keep it deterministic for testing
    });

    console.log("Agent's Action Response:", ingestResponse.text);

    // Allow a small delay for Neo4j indexing (as we discussed before)
    console.log("⏳ Waiting 2 seconds for vector indexing...");
    await new Promise(resolve => setTimeout(resolve, 2000));

    // --- SCENARIO 2: Knowledge Retrieval (RAG via Memory) ---
    console.log("\n--- Scenario 2: Semantic Retrieval ---");

    const queryPrompt = "Who is Lino Banfi and what is his most famous character?";

    const queryResponse = await ai.generate({
        prompt: queryPrompt,
        tools: [searchTool],
    });

    console.log("Agent's Final Answer:", queryResponse.text);

    // --- SCENARIO 3: Relationship Testing (Advanced) ---
    // If your plugin supports addMemoryRelationship, we can test it here
    const relTool = await ai.registry.lookupAction(`/tool/neo4j/${indexId}/addMemoryRelationship`);

    if (relTool) {
        console.log("\n--- Scenario 3: Knowledge Graph Expansion ---");
        // Manually linking Lino to the concept of Italian Cinema
        await relTool({
            sourceId: "Lino Banfi", // Or use the UUID returned by the first call
            targetId: "Italian Cinema",
            type: "LEGEND_OF",
            description: "Lino Banfi is a foundational figure in Italian comedic cinema."
        });
        console.log("✅ Relationship 'LEGEND_OF' created in Neo4j.");
    }
}

runLinoBanfiAgent().catch(console.error);