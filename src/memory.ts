import { Genkit } from "genkit";
import { Neo4jParams } from ".";
import { getDefaultConfig } from "./config";
import { z } from "zod";

export async function configureNeo4jAgentMemoryTools<EmbedderCustomOptions extends z.ZodTypeAny>(
    ai: Genkit,
    params: Neo4jParams<EmbedderCustomOptions>,
) {
    let MemoryClient: any;

    // Import dinamico con fallback
    try {
        // @ts-ignore: Ignoriamo l'errore di modulo mancante
        const agentMemory = await import("@neo4j-labs/agent-memory");
        MemoryClient = agentMemory.MemoryClient;
    } catch (err: any) {
        // STAMPIAMO IL VERO ERRORE PER DEBUG:
        console.error("ERRORE DI IMPORT DINAMICO:", err);

        throw new Error(
            `You must install '@neo4j-labs/agent-memory' to use the agent memory tools. \n` +
            `Dettaglio Errore Interno: ${err.message}`
        );
    }

    const { indexId } = params;
    const neo4jConfig = params.clientParams ?? getDefaultConfig();

    let memoryEndpoint = neo4jConfig.url || "http://localhost:8000";
    if (memoryEndpoint.startsWith("bolt://") || memoryEndpoint.startsWith("neo4j://")) {
        memoryEndpoint = "http://localhost:8000";
    }


    const memoryClient = new MemoryClient({
        endpoint: memoryEndpoint,
        username: neo4jConfig.username,
        password: neo4jConfig.password,
    });

    ai.defineTool(
        {
            name: `neo4j/${indexId}/addMemoryEntity`,
            description: "Save a fact, person, or important concept into long-term memory.",
            inputSchema: z.object({
                name: z.string().describe("Name of the entity (e.g. John Doe, React, Apple)"),
                entityType: z.string().describe("Type of entity (e.g. PERSON, TECHNOLOGY, ORG)"),
                description: z.string().optional().describe("Optional description or context of the entity"),
            }),
        },
        async (input) => {
            await memoryClient.connect();
            const entity = await memoryClient.longTerm.addEntity(
                input.name,
                input.entityType,
                { description: input.description }
            );
            await memoryClient.close();
            return `Entity ${input.name} saved successfully to memory.`;
        }
    );
    ai.defineTool(
        {
            name: `neo4j/${indexId}/addMemoryRelationship`,
            description: "Crea una relazione semantica tra due entità esistenti nel Knowledge Graph.",
            inputSchema: z.object({
                sourceId: z.string().describe("L'ID o il nome dell'entità di partenza (es. 'Lino Banfi')"),
                targetId: z.string().describe("L'ID o il nome dell'entità di arrivo (es. 'Oronzo Canà')"),
                type: z.string().describe("Il tipo di relazione (es. 'ACTED_IN', 'PLAYS_ROLE'). Usa lo snake_case o l'uppercase."),
                description: z.string().optional().describe("Una descrizione testuale opzionale della relazione"),
            }),
        },
        async (input) => {
            // Qui richiamiamo il client TypeScript di neo4j-agent-memory!
            // Assicurati che il metodo si chiami addRelationship nel client npm
            const result = await memoryClient.longTerm.addRelationship({
                source: input.sourceId,
                target: input.targetId,
                type: input.type,
                description: input.description
            });
            return `Relazione ${input.type} creata con successo tra ${input.sourceId} e ${input.targetId}.`;
        });

    ai.defineTool(
        {
            name: `neo4j/${indexId}/searchMemoryEntities`,
            description: "Search for previously saved entities or facts in long-term memory.",
            inputSchema: z.object({
                query: z.string().describe("Keyword to search in memory"),
            }),
        },
        async (input) => {
            await memoryClient.connect();
            const results = await memoryClient.longTerm.searchEntities(input.query);
            await memoryClient.close();
            return results;
        }
    );
}