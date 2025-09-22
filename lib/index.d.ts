import * as genkit from 'genkit';
import { z, Genkit } from 'genkit';
import { GenkitPlugin } from 'genkit/plugin';
import { EmbedderArgument } from 'genkit/embedder';

interface Neo4jGraphConfig {
    url: string;
    username: string;
    password: string;
    database?: string;
}
/**
 * neo4jRetrieverRef function creates a retriever for Neo4j.
 * @param params The params for the new Neo4j retriever
 * @param params.indexId The indexId for the Neo4j retriever
 * @param params.displayName  A display name for the retriever.
If not specified, the default label will be `Neo4j - <indexId>`
 * @returns A reference to a Neo4j retriever.
 */
declare const neo4jRetrieverRef: (params: {
    indexId: string;
    displayName?: string;
}) => genkit.RetrieverReference<z.ZodObject<{} & {
    k: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    k: number;
}, {
    k: number;
}>>;
/**
 * neo4jIndexerRef function creates an indexer for Neo4j.
 * @param params The params for the new Neo4j indexer.
 * @param params.indexId The indexId for the Neo4j indexer.
 * @param params.displayName  A display name for the indexer.
If not specified, the default label will be `Neo4j - <indexId>`
 * @returns A reference to a Neo4j indexer.
 */
declare const neo4jIndexerRef: (params: {
    indexId: string;
    displayName?: string;
}) => genkit.IndexerReference<z.ZodTypeAny>;
/**
 * Neo4j plugin that provides a Neo4j retriever and indexer
 * @param params An array of params to set up Neo4j retrievers and indexers
 * @param params.clientParams Neo4jConfiguration containing the
username, password, and url. If not set, the NEO4J_URI, NEO4J_USERNAME,
and NEO4J_PASSWORD environment variable will be used instead.
 * @param params.indexId The name of the index
 * @param params.embedder The embedder to use for the indexer and retriever
 * @param params.embedderOptions  Options to customize the embedder
 * @returns The Neo4j Genkit plugin
 */
declare function neo4j<EmbedderCustomOptions extends z.ZodTypeAny>(params: {
    clientParams?: Neo4jGraphConfig;
    indexId: string;
    embedder: EmbedderArgument<EmbedderCustomOptions>;
    embedderOptions?: z.infer<EmbedderCustomOptions>;
}[]): GenkitPlugin;

/**
 * Configures a Neo4j retriever.
 * @param ai A Genkit instance
 * @param params The params for the retriever
 * @param params.indexId The name of the retriever
 * @param params.clientParams PNeo4jConfiguration containing the
username, password, and url. If not set, the NEO4J_URI, NEO4J_USERNAME,
and NEO4J_PASSWORD environment variable will be used instead.
 * @param params.embedder The embedder to use for the retriever
 * @param params.embedderOptions  Options to customize the embedder
 * @returns A Pinecone retriever
 */
declare function configureNeo4jRetriever<EmbedderCustomOptions extends z.ZodTypeAny>(ai: Genkit, params: {
    indexId: string;
    clientParams?: Neo4jGraphConfig;
    embedder: EmbedderArgument<EmbedderCustomOptions>;
    embedderOptions?: z.infer<EmbedderCustomOptions>;
}): genkit.RetrieverAction<z.ZodObject<{} & {
    k: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    k: number;
}, {
    k: number;
}>>;
/**
 * Configures a Neo4j indexer.
 * @param ai A Genkit instance
 * @param params The params for the indexer
 * @param params.indexId The name of the indexer
 * @param params.clientParams Neo4jConfiguration containing the
username, password, and url. If not set, the NEO4J_URI, NEO4J_USERNAME,
and NEO4J_PASSWORD environment variable will be used instead.
 * @param params.embedder The embedder to use for the retriever
 * @param params.embedderOptions  Options to customize the embedder
 * @returns A Genkit indexer
 */
declare function configureNeo4jIndexer<EmbedderCustomOptions extends z.ZodTypeAny>(ai: Genkit, params: {
    indexId: string;
    clientParams?: Neo4jGraphConfig;
    embedder: EmbedderArgument<EmbedderCustomOptions>;
    embedderOptions?: z.infer<EmbedderCustomOptions>;
}): genkit.IndexerAction<z.ZodTypeAny>;

export { type Neo4jGraphConfig, configureNeo4jIndexer, configureNeo4jRetriever, neo4j as default, neo4j, neo4jIndexerRef, neo4jRetrieverRef };
