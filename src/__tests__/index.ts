import { googleAI } from '@genkit-ai/googleai';
import { Document, genkit } from 'genkit';
import { test, describe, expect, afterAll, beforeAll, beforeEach, afterEach } from '@jest/globals';
import { Driver, auth, driver as neo4jDriver, Session } from 'neo4j-driver';
// Imports necessary functions and references from the neo4j plugin
import { neo4j, neo4jIndexerRef, neo4jRetrieverRef } from '..';

/**
 * This file contains integration tests for the Genkit Neo4j plugin.
 * To run these tests, ensure the following environment variables are set:
 * - NEO4J_URI: The URI of the Neo4j instance (e.g., bolt://localhost:7687)
 * - NEO4J_USERNAME: The username for Neo4j authentication
 * - NEO4J_PASSWORD: The password for Neo4j authentication
 * - GEMINI_API_KEY: Your Google Gemini API key
 *
 * The Neo4j instance must be running and accessible.
 */
describe('Neo4j Plugin Integration', () => {
  // --- Configuration and Environment Variables ---
  const requiredVars = ['NEO4J_URI', 'NEO4J_USERNAME', 'NEO4J_PASSWORD', 'GEMINI_API_KEY'];
  const missingVars = requiredVars.filter(env => !process.env[env]);
  const canRunTest = missingVars.length === 0;

  // Decides whether to run or skip the tests based on the presence of environment variables.
  const runTest = canRunTest ? test : test.skip;

  // Global variables for the Genkit instance and Neo4j connection
  let ai: ReturnType<typeof genkit>;
  let driver: Driver;
  let session: Session;

  // Unique ID used for the vector index in Neo4j (corresponds to the node label)
  const indexId = 'genkit-test-index';
  // Cypher Label for the node, quoted for safety
  const INDEX_LABEL = `\`${indexId}\``; 

  // References to the Indexer and Retriever, defined once
  const INDEXER_REF = neo4jIndexerRef({ indexId });
  const RETRIEVER_REF = neo4jRetrieverRef({ indexId });

  // Cypher Cleanup Query: deletes all nodes with the test label
  const CLEANUP_QUERY = `MATCH (n:${INDEX_LABEL}) DETACH DELETE n`;
  // Cypher Verification Query: finds a node based on a unique ID
  const FIND_NODE_QUERY = `MATCH (n:${INDEX_LABEL} {uniqueId: $uniqueId}) RETURN n`;

  
  // --- Setup and Teardown ---

  beforeAll(async () => {
    if (!canRunTest) {
        console.warn(`Skipping Neo4j tests: Missing environment variables: ${missingVars.join(', ')}`);
        return;
    }

    // Initializes the standalone Neo4j driver for verification and cleanup operations
    driver = neo4jDriver(
      process.env.NEO4J_URI as string,
      auth.basic(process.env.NEO4J_USERNAME as string, process.env.NEO4J_PASSWORD as string),
    );
  });

  beforeEach(async () => {
    if (!canRunTest) return;

    // Configuration of Neo4j client connection parameters for the Genkit plugin
    const clientParams = {
        url: process.env.NEO4J_URI as string,
        username: process.env.NEO4J_USERNAME as string,
        password: process.env.NEO4J_PASSWORD as string,
        database: 'neo4j',
    };

    // Initializes Genkit with the Google AI plugin and the Neo4j plugin
    ai = genkit({
      plugins: [
        googleAI(),
        neo4j([
          {
            indexId, // The index ID to configure
            embedder: googleAI.embedder('gemini-embedding-001'), // Embedder to use
            clientParams, // Neo4j connection parameters
          },
        ]),
      ],
    });
    
    // Opens a new Neo4j session for verification operations
    session = driver.session();
  });
  
  afterEach(async () => {
    if (!canRunTest) return;
    
    // Cleanup: deletes all nodes created by the test to ensure test isolation
    try {
      await session.run(CLEANUP_QUERY);
    } finally {
      // Closes the Neo4j session after cleanup
      await session.close();
    }
  });

  afterAll(async () => {
    if (!canRunTest) return;
    // Closes the global Neo4j driver at the end of all tests
    await driver.close();
  });


  // --- Integration Tests ---

  runTest('should successfully index a document and verify node creation', async () => {
    // 1. Data Setup
    const uniqueId = `test-doc-${Date.now()}`;
    const initialText = 'This is a test document for indexing and retrieval.';
    const newDocument = new Document({
      content: [{ text: initialText }],
      metadata: { uniqueId },
    });
    const retrievalQuery = 'This is a test document to be indexed.';

    // 2. Action: Index the document
    // Uses the predefined indexer reference (INDEXER_REF)
    await ai.index({ indexer: INDEXER_REF, documents: [newDocument] });

    // 3. Neo4j Verification: ensure the node was created
    const result = await session.run(
      FIND_NODE_QUERY,
      { uniqueId },
    );
    
    expect(result.records).toHaveLength(1);
    expect(result.records[0].get('n').properties.uniqueId).toBe(uniqueId);
    // Verifies that the content was stored correctly
    expect(result.records[0].get('n').properties.text).toBe(initialText);

    // 4. Action: Retrieve the indexed document
    // Uses the predefined retriever reference (RETRIEVER_REF)
    const docs = await ai.retrieve({
      retriever: RETRIEVER_REF,
      query: retrievalQuery,
      options: {
        k: 10,
        filter: { uniqueId }, // Filters by the unique ID to ensure a hit
      },
    });

    // 5. Retrieval Verification
    expect(docs).toHaveLength(1);
    expect(docs[0].content[0].text).toContain('indexing and retrieval');
  });

  runTest('should retrieve documents using a specific metadata filter', async () => {
    // 1. Data Setup
    const commonId = `common-doc-${Date.now()}`;
    const CAT_ANIMAL = 'cat';
    const DOG_ANIMAL = 'dog';

    const docsToInsert = [
      new Document({
        content: [{ text: `Document 1 about ${CAT_ANIMAL}s.` }],
        metadata: { animal: CAT_ANIMAL, commonId },
      }),
      new Document({
        content: [{ text: `Document 2 about ${DOG_ANIMAL}s.` }],
        metadata: { animal: DOG_ANIMAL, commonId },
      }),
      new Document({
        content: [{ text: `Another document about ${CAT_ANIMAL}s.` }],
        metadata: { animal: CAT_ANIMAL, commonId },
      }),
    ];

    // 2. Action: Index multiple documents
    await ai.index({ indexer: INDEXER_REF, documents: docsToInsert });

    // 3. Neo4j Verification: ensure all 3 nodes with commonId were created
    const verificationQuery = `MATCH (n:${INDEX_LABEL} {commonId: $commonId}) RETURN n`;
    const result = await session.run(verificationQuery, { commonId });

    expect(result.records).toHaveLength(3);
    const animals = result.records.map(r => r.get('n').properties.animal);
    expect(animals).toEqual(expect.arrayContaining([CAT_ANIMAL, CAT_ANIMAL, DOG_ANIMAL]));

    // 4. Action: Retrieve using a metadata filter
    const retrievalQuery = 'What animal information is available?';
    const filter = { animal: CAT_ANIMAL, commonId };

    const retrievedDocs = await ai.retrieve({
      retriever: RETRIEVER_REF,
      query: retrievalQuery,
      options: {
        k: 10,
        filter, // Apply the filter: should only retrieve "cat" documents
      },
    });

    // 5. Retrieval Verification: two documents should match the 'cat' filter
    expect(retrievedDocs).toHaveLength(2);
    expect(retrievedDocs.every(doc => doc.metadata?.animal === CAT_ANIMAL)).toBe(true);
  });

  runTest('should return an empty array for a non-matching query', async () => {
    // 1. Data Setup
    const uniqueId = `test-doc-${Date.now()}`;
    const newDocument = new Document({
      content: [{ text: 'This is a test document about technology.' }],
      metadata: { uniqueId },
    });
    const retrievalQuery = 'This query should not find anything about animals.';
    const nonMatchingFilter = { nonExistentField: 'nonExistentValue' };

    // 2. Action: Index a document
    await ai.index({ indexer: INDEXER_REF, documents: [newDocument] });

    // 3. Neo4j Verification
    const createdResult = await session.run(
      FIND_NODE_QUERY,
      { uniqueId },
    );
    expect(createdResult.records).toHaveLength(1);

    // 4. Action: Retrieve using a non-matching filter
    const docs = await ai.retrieve({
      retriever: RETRIEVER_REF,
      query: retrievalQuery,
      options: {
        k: 10,
        // The filter does not match any property on the indexed nodes
        filter: nonMatchingFilter, 
      },
    });

    // 5. Retrieval Verification: the array of retrieved documents should be empty
    expect(docs).toHaveLength(0);
  });
});
