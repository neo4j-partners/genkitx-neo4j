import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/googleai';
import { neo4j } from './src';
import { geminiModel } from './src/utils';

const indexId = 'omni-agentic-test-index';
const DB_URL = 'bolt://localhost:7687';
const DB_USER = 'neo4j';
const DB_PASS = 'password';

const ai = genkit({
    plugins: [
        googleAI(),
        neo4j([{
            indexId: indexId,
            embedder: 'mock-embedder' as any,
            clientParams: { url: DB_URL, username: DB_USER, password: DB_PASS },
            enableAgentMemoryTools: true,
        }]),
    ],
});

async function runOmniAgent() {
    console.log("🚀 Starting Omni-Agentic Test (Gemini + Multi-Tier Memory)...");

    const tools = [
        await ai.registry.lookupAction(`/tool/neo4j/${indexId}/addMemoryMessage`),
        await ai.registry.lookupAction(`/tool/neo4j/${indexId}/getMemoryConversation`),
        await ai.registry.lookupAction(`/tool/neo4j/${indexId}/addMemoryEntity`),
        await ai.registry.lookupAction(`/tool/neo4j/${indexId}/addMemoryFact`),
        await ai.registry.lookupAction(`/tool/neo4j/${indexId}/addMemoryPreference`),
        await ai.registry.lookupAction(`/tool/neo4j/${indexId}/addMemoryRelationship`),
        await ai.registry.lookupAction(`/tool/neo4j/${indexId}/searchMemoryEntities`),
        await ai.registry.lookupAction(`/tool/neo4j/${indexId}/startReasoningTrace`),
        await ai.registry.lookupAction(`/tool/neo4j/${indexId}/addReasoningStep`),
        await ai.registry.lookupAction(`/tool/neo4j/${indexId}/recordMemoryToolCall`),
        await ai.registry.lookupAction(`/tool/neo4j/${indexId}/completeReasoningTrace`),
    ].filter(Boolean) as any[];

    const sessionId = "omni-agentic-session-" + Date.now();

    const systemPrompt = `
    You are an AI assistant with access to three memory tiers:
    1. Short-term (Messages)
    2. Long-term (Entities, Facts, Preferences, Relationships)
    3. Reasoning (Traces, Steps, ToolCalls)

    Use them to store and retrieve context effectively. Always start a reasoning trace for complex requests.
    `;

    console.log("\n👤 User: I'm Ajeje, a developer from Italy. I'm building a Genkit plugin for Neo4j.");

    const response = await ai.generate({
        model: geminiModel,
        messages: [
            { role: 'system', content: [{ text: systemPrompt }] },
            { role: 'user', content: [{ text: "I'm Ajeje, a developer from Italy. I'm building a Genkit plugin for Neo4j. Store my preferences and project info." }] }
        ],
        tools: tools,
    });

    console.log("\n🤖 Agent Response:", response.text);

    console.log("\n⏳ Waiting for indexing...");
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log("\n👤 User: What do you remember about my background?");
    const response2 = await ai.generate({
        model: geminiModel,
        messages: [
            { role: 'system', content: [{ text: systemPrompt }] },
            { role: 'user', content: [{ text: "What do you remember about my background?" }] }
        ],
        tools: tools,
    });

    console.log("\n🤖 Agent Response:", response2.text);
}

runOmniAgent().catch(console.error);
