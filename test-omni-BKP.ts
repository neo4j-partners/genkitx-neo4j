import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/googleai';
import { neo4j } from './src';
import { Neo4jSessionStore } from './src/session';
import { geminiModel } from './src/utils';

const indexId = 'lino-omni-index';

// 1. Initialize Genkit Session Store (Short-term memory TCK Bronze)
const sessionStore = new Neo4jSessionStore({
    url: 'bolt://localhost:7687',
    username: 'neo4j',
    password: 'apoc1234',
    useTckFormat: true // CRITICAL: Matches the Python backend's expected schema
});

// 2. Initialize Genkit and the Plugin (Long-term & Reasoning TCK Silver/Gold)
const ai = genkit({
    plugins: [
        googleAI(),
        neo4j([{
            indexId: indexId,
            embedder: 'mock-embedder' as any,
            clientParams: { url: 'bolt://localhost:7687', username: 'neo4j', password: 'password' },
            enableAgentMemoryTools: true,
        }]),
    ],
    model: geminiModel,
});

async function runOmniLino() {
    console.log("🚀 Starting Multi-Memory Agent on Neo4j...");

    // Retrieve ALL tools exposed by your plugin following TCK specs
    const addEntity = await ai.registry.lookupAction(`/tool/neo4j/${indexId}/addMemoryEntity`);
    const searchEntities = await ai.registry.lookupAction(`/tool/neo4j/${indexId}/searchMemoryEntities`);
    const addRelation = await ai.registry.lookupAction(`/tool/neo4j/${indexId}/addMemoryRelationship`);
    const startTrace = await ai.registry.lookupAction(`/tool/neo4j/${indexId}/startReasoningTrace`);

    const availableTools = [addEntity, searchEntities, addRelation, startTrace].filter(Boolean) as any[];

    // 3. Define the session ID for Genkit
    const sessionId = "lino-session-" + Date.now();
    console.log(`\n💬 Starting session: ${sessionId}`);

    const systemPrompt = `
    You are an expert archivist of Italian cinema. 
    Use the tools at your disposal to:
    1. Save historical characters as Entities.
    2. Create Relationships between them.
    3. If you have the 'startReasoningTrace' tool, use it to track your logic before answering.
  `;

    // --- INTERACTION 1: User inserts historical data ---
    console.log("\n👤 User: Inserting core concepts...");
    const prompt1 = `
    Lino Banfi acted in the movie 'L'allenatore nel pallone' playing Oronzo Canà. 
    Save Lino Banfi and the movie as entities. Then, if possible, create a relationship between them called 'ACTED_IN'.
  `;

    // Use ai.generate with the store injected (Modern Genkit API for Chat)
    const response1 = await ai.generate({
        model: geminiModel,
        messages: [
            { role: 'system', content: [{ text: systemPrompt }] },
            { role: 'user', content: [{ text: prompt1 }] }
        ],
        tools: availableTools,
        config: { temperature: 0.2 },
    });

    console.log("🤖 Gemini Action Log:", response1.text);

    // MANUALLY SAVE TO STORE (If Genkit doesn't auto-save via ai.generate)
    // In newer Genkit versions, session management is often manual or wrapped in a helper.
    // We explicitly save the user prompt and the model response to guarantee Bronze TCK compliance.
    await sessionStore.save(sessionId, {
        id: sessionId,
        state: {},
        threads: {
            main: [
                { content: [{ text: prompt1 }], role: 'user', metadata: {} },
                { content: [{ text: response1.text }], role: 'model', metadata: {} }
            ]
        }
    });

    console.log("⏳ Waiting for vector indexing...");
    await new Promise(resolve => setTimeout(resolve, 2000));

    // --- INTERACTION 2: Reasoning and Search ---
    console.log("\n👤 User: Complex Question...");
    const prompt2 = "Tell me everything you remember about Lino Banfi and his movies. Use semantic search to be precise.";

    // Retrieve previous history from the store to maintain context
    const previousSession = await sessionStore.get(sessionId);
    const history = previousSession?.threads?.main || [];

    const response2 = await ai.generate({
        model: geminiModel,
        messages: [
            { role: 'system', content: [{ text: systemPrompt }] },
            // Inject history into the prompt
            ...history,
            { role: 'user', content: [{ text: prompt2 }] }
        ],
        tools: availableTools,
    });

    console.log("🤖 Gemini Answer:", response2.text);

    // Update the store with the new interaction
    await sessionStore.save(sessionId, {
        id: sessionId,
        state: {},
        threads: {
            main: [
                { content: [{ text: prompt2 }], role: 'user', metadata: {} },
                { content: [{ text: response2.text }], role: 'model', metadata: {} }
            ] // The store's logic (append new nodes) handles adding these to the existing chain
        }
    });

    await sessionStore.close();
    console.log("\n✅ Test completed. Open Neo4j Desktop to see the graph!");
}

runOmniLino().catch(console.error);