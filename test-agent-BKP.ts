import { genkit, z } from 'genkit';
import { googleAI, gemini15Flash } from '@genkit-ai/googleai';
import { neo4j } from './src';

const ai = genkit({
    plugins: [
        googleAI(),
        neo4j([{
            indexId: 'memoria-agente',
            embedder: 'mock-embedder' as any, // Il server Python gestisce gli embedding
            clientParams: { url: 'bolt://localhost:7687', username: 'neo4j', password: 'password' },
            enableAgentMemoryTools: true,
        }]),
    ],
    model: gemini15Flash,
});

async function runAgent() {
    // Recuperiamo i tool dal plugin neo4j
    const addTool = await ai.registry.lookupAction('/tool/neo4j/memoria-agente/addMemoryEntity');
    const searchTool = await ai.registry.lookupAction('/tool/neo4j/memoria-agente/searchMemoryEntities');

    console.log("--- Conversazione 1: L'utente si presenta ---");

    const response1 = await ai.generate({
        prompt: "Ciao, mi chiamo Ajeje Brazorf e sono uno sviluppatore esperto di Genkit. Ricordatelo per favore.",
        tools: [addTool!], // Diamo all'IA il potere di scrivere nella memoria
    });

    console.log("AI:", response1.text);

    console.log("\n--- Conversazione 2: L'IA recupera le info ---");

    const response2 = await ai.generate({
        prompt: "Chi sono io e di cosa mi occupo?",
        tools: [searchTool!], // Diamo all'IA il potere di cercare nella memoria
    });

    console.log("AI:", response2.text);
}

runAgent();