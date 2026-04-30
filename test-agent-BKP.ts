import { genkit, z } from 'genkit';
import { googleAI, gemini15Flash } from '@genkit-ai/googleai';
import { neo4j } from './src';

const ai = genkit({
    plugins: [
        googleAI(),
        neo4j([{
            indexId: 'agent-memory',
            embedder: 'mock-embedder' as any, // The Python server handles embeddings
            clientParams: { url: 'bolt://localhost:7687', username: 'neo4j', password: 'password' },
            enableAgentMemoryTools: true,
        }]),
    ],
    model: gemini15Flash,
});

async function runAgent() {
    // Retrieve tools from the neo4j plugin
    const addTool = await ai.registry.lookupAction('/tool/neo4j/agent-memory/addMemoryEntity');
    const searchTool = await ai.registry.lookupAction('/tool/neo4j/agent-memory/searchMemoryEntities');

    console.log("--- Conversation 1: The user introduces themselves ---");

    const response1 = await ai.generate({
        prompt: "Hi, my name is Ajeje Brazorf and I am an expert Genkit developer. Please remember that.",
        tools: [addTool!], // Give the AI the power to write to memory
    });

    console.log("AI:", response1.text);

    console.log("\n--- Conversation 2: The AI retrieves info ---");

    const response2 = await ai.generate({
        prompt: "Who am I and what do I do?",
        tools: [searchTool!], // Give the AI the power to search memory
    });

    console.log("AI:", response2.text);
}

runAgent();