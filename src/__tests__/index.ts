
// TODO ---> https://github.com/langchain4j/langchain4j-community/pull/147/files#diff-88eda01fc3b9783cb9d21927a503fe236ed6f4de13e4fc314320736cd52d0150
  // https://github.com/vga91/langchain4j-community/blob/5079cea64e42fd6cd326a45678da533d6a8c0438/embedding-stores/langchain4j-community-neo4j/src/main/java/dev/langchain4j/community/store/embedding/neo4j/Neo4jEmbeddingStore.java
// TODO --> https://genkit.dev/docs/rag/#embedders



import { googleAI } from '@genkit-ai/googleai';
import { Document, genkit } from 'genkit';
import { test, describe, expect, afterAll, beforeAll, beforeEach, afterEach } from '@jest/globals';
import { Driver, auth, driver as neo4jDriver, Session } from 'neo4j-driver';
// Imports necessary functions and references from the neo4j plugin
import { neo4j, neo4jIndexerRef, neo4jRetrieverRef } from '..';






/**
 * This file contains integration tests for the Genkit Neo4j plugin.
 * To run these tests, ensure the following environment variables are set:
 * - NEO4J_URI: The URI of the Neo4j instance (e.g., bolt://localhost:7689)
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
  const CLEANUP_QUERY = `MATCH (n) DETACH DELETE n`;
  // Cypher Verification Query: finds a node based on a unique ID
  const FIND_NODE_QUERY = `MATCH (n:${INDEX_LABEL} {uniqueId: $uniqueId}) RETURN n`;

  const clientParams = {
      url: process.env.NEO4J_URI as string,
      username: process.env.NEO4J_USERNAME as string,
      password: process.env.NEO4J_PASSWORD as string,
      database: 'neo4j',
  };
  
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

  // test('should ingest documents using Parent-Child ingestor if plugin exists', async () => {
  //   const uniqueId = `parent-child-doc-${Date.now()}`;
  //   const docsToIngest = [
  //     { text: 'Parent document text', metadata: { uniqueId } }
  //   ];

  //   let parentChildTool;
  //   try {
  //     parentChildTool = ai.run('neo4j/genkit-test-index/parentChildIngestor');
  //   } catch (err) {
  //     console.warn('Parent-Child ingestor plugin is not available, skipping test.');
  //     return;
  //   }

  //   const res = await parentChildTool({ documents: docsToIngest });
  //   expect(res.status).toBe('ok');
  //   expect(res.count).toBeGreaterThanOrEqual(1);

  //   // Optionally, retrieve and verify content if needed
  //   const retriever = neo4jRetrieverRef({ indexId: 'genkit-test-index' });
  //   const retrievedDocs = await ai.retrieve({
  //     retriever,
  //     query: 'Parent document text',
  //     options: { k: 10, filter: { uniqueId } },
  //   });

  //   expect(retrievedDocs).toHaveLength(1);
  //   expect(retrievedDocs[0].content[0].text).toContain('Parent document text');
  // });

  // test('Neo4j retriever can be defined', async () => {
  //   const retriever = ai.retriever('neo4j/genkit-test-index');
  //   expect(retriever).toBeDefined();
  // });

  // todo - TESTS

  test('graph rag', async () => {
      // TODO - create ingestor, 
      // TODO - create indexer
      const uniqueId = `test-doc-${Date.now()}`;
      const newDocument = new Document({
        content: [
          { text: 'This is a test document for indexing and retrieval.' }
        ],
        metadata: { uniqueId },
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

  test('should document and retrieve it with custom label', async () => {
    const customLabel = 'customLabel'
    const customLabelIdx = 'customLabelIdx'
    ai = genkit({
      plugins: [
        googleAI(),
        neo4j([
          {
            indexId: customLabelIdx,
            embedder: googleAI.embedder('gemini-embedding-001'),
            clientParams,
            label: customLabel
          },
        ]),
      ],
    });

    const uniqueId = `test-doc-${Date.now()}`;
    const newDocument = new Document({
      content: [
        { text: 'This is a test document for indexing and retrieval.' }
      ],
      metadata: { uniqueId },
    });

    const indexerRef = neo4jIndexerRef({ indexId: customLabelIdx });
    const retrieverRef = neo4jRetrieverRef({ indexId: customLabelIdx });
    await ai.index({ indexer: indexerRef, documents: [newDocument] });

    const docs = await ai.retrieve({
      retriever: retrieverRef,
      query: 'This is a test document to be indexed.',
      options: {
        k: 10
      },
    });

    expect(docs).toHaveLength(1);
    expect(docs[0].content[0].text).toContain('indexing and retrieval');
    
    
    const verificationQuery = `MATCH (n:${customLabel}) RETURN n`;
    const result = await session.run(verificationQuery);
    console.log(result.records)

    expect(result.records).toHaveLength(1);
    const allCustomLabels = result.records.every(r => r.get('n').labels[0] == customLabel);
    expect(allCustomLabels).toBeTruthy();
  });

  test('should document and retrieve it with custom label and filter', async () => {
    const customLabel = 'customLabel'
    const customLabelIdx = 'customLabelIdx'
    ai = genkit({
      plugins: [
        googleAI(),
        neo4j([
          {
            indexId: customLabelIdx, 
            embedder: googleAI.embedder('gemini-embedding-001'),
            clientParams, 
            label: customLabel
          },
        ]),
      ],
    });

    const uniqueId = `test-doc-${Date.now()}`;
    const newDocument = new Document({
      content: [
        { text: 'This is a test document for indexing and retrieval.' }
      ],
      metadata: { uniqueId },
    });

    const indexerRef = neo4jIndexerRef({ indexId: customLabelIdx });
    const retrieverRef = neo4jRetrieverRef({ indexId: customLabelIdx });
    await ai.index({ indexer: indexerRef, documents: [newDocument] });

    const docs = await ai.retrieve({
      retriever: retrieverRef,
      query: 'This is a test document to be indexed.',
      options: {
        k: 10,
        filter: { uniqueId },
      },
    });

    expect(docs).toHaveLength(1);
    expect(docs[0].content[0].text).toContain('indexing and retrieval');
    
    
    const verificationQuery = `MATCH (n:${customLabel}) RETURN n`;
    const result = await session.run(verificationQuery);
    console.log(result.records)

    expect(result.records).toHaveLength(1);
    const allCustomLabels = result.records.every(r => r.get('n').labels[0] == customLabel);
    expect(allCustomLabels).toBeTruthy();
  });

  test('should document and retrieve it with custom label, properties and filter', async () => {
    const customLabel = 'customLabelEntities'
    const customEntitiesIdx = 'customEntitiesIdx'
    const customTextProperty = 'customTextProperty'
    const customEmbeddingProperty = 'customEmbeddingProperty'
    const customIdProperty = 'customIdProperty'
    ai = genkit({
      plugins: [
        googleAI(),
        neo4j([
          {
            indexId: customEntitiesIdx, 
            embedder: googleAI.embedder('gemini-embedding-001'),
            clientParams, 
            label: customLabel,
            textProperty: customTextProperty,
            embeddingProperty: customEmbeddingProperty,
            idProperty: customIdProperty,
          },
        ]),
      ],
    });

    const uniqueId = `test-doc-${Date.now()}`;
    const newDocument = new Document({
      content: [
        { text: 'This is a test document for indexing and retrieval.' }
      ],
      metadata: { uniqueId },
    });

    const indexerRef = neo4jIndexerRef({ indexId: customEntitiesIdx });
    const retrieverRef = neo4jRetrieverRef({ indexId: customEntitiesIdx });
    await ai.index({ indexer: indexerRef, documents: [newDocument] });

    const docs = await ai.retrieve({
      retriever: retrieverRef,
      query: 'This is a test document to be indexed.',
      options: {
        k: 10,
        filter: { uniqueId },
      },
    });

    expect(docs).toHaveLength(1);
    expect(docs[0].content[0].text).toContain('indexing and retrieval');
    
    
    const verificationQuery = `MATCH (n:${customLabel}) RETURN n`;
    const result = await session.run(verificationQuery);
    console.log(result.records)

    expect(result.records).toHaveLength(1);
    const allCustomLabels = result.records.every(r => r.get('n').labels[0] == customLabel);
    expect(allCustomLabels).toBeTruthy();

    const props = result.records.map(r => Object.keys(r.get('n').properties));
    expect(props).toEqual([[customEmbeddingProperty, customTextProperty, customIdProperty, 'uniqueId']])
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
