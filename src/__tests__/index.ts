import { googleAI } from '@genkit-ai/googleai';
import { Document, genkit } from 'genkit';
import { test, describe, expect, afterAll, beforeAll, beforeEach, afterEach } from '@jest/globals';
import { Driver, auth, driver as neo4jDriver, Session } from 'neo4j-driver';
import { neo4j, neo4jIndexerRef, neo4jRetrieverRef } from '..';

// Import the Testcontainers equivalent for Node.js
import { Neo4jContainer, StartedNeo4jContainer } from '@testcontainers/neo4j';

/**
 * This file contains integration tests for the Genkit Neo4j plugin,
 * using @testcontainers/neo4j to spin up a disposable Docker Neo4j instance
 * for each test run.
 */
describe('Neo4j Plugin Integration', () => {
  // We only require the GEMINI_API_KEY; all Neo4j connection details are dynamic.
  const requiredVars = ['GEMINI_API_KEY'];
  const missingVars = requiredVars.filter(env => !process.env[env]);
  const canRunTest = missingVars.length === 0;
  const runTest = canRunTest ? test : test.skip;
  
  // Reference to the Testcontainers Neo4j instance
  let neo4jContainer: StartedNeo4jContainer;

  // Global variables for the Genkit instance and Neo4j connection
  let ai: ReturnType<typeof genkit>;
  let driver: Driver;
  let session: Session;

  // Index and query configuration constants
  const indexId = 'genkit-test-index';
  const INDEX_LABEL = `\`${indexId}\``; 
  const INDEXER_REF = neo4jIndexerRef({ indexId });
  const RETRIEVER_REF = neo4jRetrieverRef({ indexId });
  const CLEANUP_QUERY = `MATCH (n:${INDEX_LABEL}) DETACH DELETE n`;
  const FIND_NODE_QUERY = `MATCH (n:${INDEX_LABEL} {uniqueId: $uniqueId}) RETURN n`;

  
  // --- Setup and Teardown ---

  beforeAll(async () => {
    if (!canRunTest) {
        console.warn(`Skipping Neo4j tests: Missing environment variables: ${missingVars.join(', ')}`);
        return;
    }

    // 1. Start the Neo4j Docker container using Testcontainers.
    // This automatically pulls the image and waits for the database to be ready.
    neo4jContainer = await new Neo4jContainer('neo4j:5.26.16').start();
    
    // 2. Get the dynamically generated connection parameters
    const uri = neo4jContainer.getBoltUri();
    const username = neo4jContainer.getUsername();
    const password = neo4jContainer.getPassword();

    // 3. Initialize the standalone Neo4j driver (for cleanup/verification)
    driver = neo4jDriver(
      uri,
      auth.basic(username, password),
    );
  }, 60000); // Increased timeout for container startup

  beforeEach(async () => {
    if (!canRunTest) return;

    // 4. Configure the client with dynamic connection parameters from the container
    const clientParams = {
        url: neo4jContainer.getBoltUri(),
        username: neo4jContainer.getUsername(),
        password: neo4jContainer.getPassword(),
        database: 'neo4j',
    };

    // Initialize Genkit with dynamic parameters
    ai = genkit({
      plugins: [
        googleAI(),
        neo4j([
          {
            indexId, 
            embedder: googleAI.embedder('gemini-embedding-001'), 
            clientParams, 
          },
        ]),
      ],
    });
    
    // Open a new Neo4j session for verification operations
    session = driver.session();
  });
  
  afterEach(async () => {
    if (!canRunTest) return;
    
    // Cleanup: deletes all test nodes
    try {
      await session.run(CLEANUP_QUERY);
    } finally {
      // Close the Neo4j session after cleanup
      await session.close();
    }
  });

  afterAll(async () => {
    if (!canRunTest) return;
    // Close the global Neo4j driver
    await driver.close();
    
    // 5. Stop and dispose of the Testcontainers Neo4j container
    await neo4jContainer.stop();
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
