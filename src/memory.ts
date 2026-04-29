import { Genkit } from "genkit";
import { Neo4jParams } from ".";
import { getDefaultConfig } from "./config";
import { z } from "zod";

export async function configureNeo4jAgentMemoryTools<EmbedderCustomOptions extends z.ZodTypeAny>(
    ai: Genkit,
    params: Neo4jParams<EmbedderCustomOptions>,
) {
    let MemoryClient: any;

    // Dynamic import with fallback
    try {
        // @ts-ignore: Ignore missing module error
        const agentMemory = await import("@neo4j-labs/agent-memory");
        MemoryClient = agentMemory.MemoryClient;
    } catch (err: any) {
        // PRINT THE REAL ERROR FOR DEBUGGING:
        console.error("DYNAMIC IMPORT ERROR:", err);

        throw new Error(
            `You must install '@neo4j-labs/agent-memory' to use the agent memory tools. \n` +
            `Internal Error Detail: ${err.message}`
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
            description: "Create a semantic relationship between two existing entities in the Knowledge Graph.",
            inputSchema: z.object({
                sourceId: z.string().describe("The ID or name of the source entity (e.g., 'Lino Banfi')"),
                targetId: z.string().describe("The ID or name of the target entity (e.g., 'Oronzo Canà')"),
                type: z.string().describe("The type of relationship (e.g., 'ACTED_IN', 'PLAYS_ROLE'). Use snake_case or uppercase."),
                description: z.string().optional().describe("An optional text description of the relationship"),
            }),
        },
        async (input) => {
            // Here we call the neo4j-agent-memory TypeScript client!
            // Make sure the method is named addRelationship in the npm client
            const result = await memoryClient.longTerm.addRelationship({
                source: input.sourceId,
                target: input.targetId,
                type: input.type,
                description: input.description
            });
            return `Relationship ${input.type} successfully created between ${input.sourceId} and ${input.targetId}.`;
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