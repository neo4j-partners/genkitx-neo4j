
import { Document, genkit } from 'genkit';
import { test, describe, expect, afterAll, beforeAll, beforeEach, afterEach } from '@jest/globals';
import { Driver, auth, driver as neo4jDriver, Session } from 'neo4j-driver';
import { neo4j, Neo4jGraphConfig, neo4jIndexerRef, neo4jRetrieverRef } from '..';

// Import the Testcontainers equivalent for Node.js
import { Neo4jContainer, StartedNeo4jContainer } from '@testcontainers/neo4j';
import { mockEmbedder } from '../dummyEmbedder';
import { Wait } from 'testcontainers';
import { fail } from 'assert';
import { googleAI } from '@genkit-ai/googleai';
import { HypotheticalQuestionRetriever, ParentChildRetriever } from '../rag-utils';


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

describe("Neo4j RAG Retrievers", () => {
  const requiredVars = ["NEO4J_URI", "NEO4J_USERNAME", "NEO4J_PASSWORD", "GEMINI_API_KEY"];
  const missingVars = requiredVars.filter((env) => !process.env[env]);
  const canRunTest = missingVars.length === 0;

  if (!canRunTest) {
    console.warn("Skipping Neo4j integration tests due to missing environment variables.");
    return;
  }

  let ai: ReturnType<typeof genkit>;
  let indexer: ReturnType<typeof neo4jIndexerRef>;
  const indexId = "genkit-test-index";
  const clientParams: Neo4jGraphConfig = {
    url: process.env.NEO4J_URI!,
    username: process.env.NEO4J_USERNAME!,
    password: process.env.NEO4J_PASSWORD!,
    database: "neo4j",
  };

  beforeAll(() => {
    ai = genkit({
      plugins: [
        googleAI(),
        // Neo4j plugin registers indexer internally
        neo4j([
          {
            indexId,
            embedder: googleAI.embedder("gemini-embedding-001"),
            clientParams,
          },
        ]),
      ],
    });

    indexer = neo4jIndexerRef({ indexId });
  });

  test("ParentChildRetriever ingests and retrieves subchunks", async () => {
    const retriever = new ParentChildRetriever(ai, clientParams, indexer);

    const uniqueId = `pc-doc-${Date.now()}`;
    const docText =
      "This is a test document for parent-child ingestion in Neo4j. It should be chunked and subchunked properly.";

    await retriever.ingestDocument({ documents: [{ text: docText, metadata: { uniqueId } }] });

    const session = retriever.getNeo4jInstance().session();
    const result = await session.run(retriever.getRetrievalQuery());
    const records = result.records;

    expect(records.length).toBeGreaterThan(0);

    const foundText = records
      .flatMap((r) => r.get("subChunks") || [])
      .map((s: any) => s.properties.text)
      .join(" ");
    expect(foundText).toContain("test document for parent-child");

    await session.close();
  });

  test("HypotheticalQuestionRetriever ingests and retrieves documents", async () => {
    const retriever = new HypotheticalQuestionRetriever(ai, clientParams, indexer);

    const uniqueId = `hq-doc-${Date.now()}`;
    const docText = "This is a test document for the hypothetical question retriever.";

    await retriever.ingestDocument({ documents: [{ text: docText, metadata: { uniqueId } }] });

    const session = retriever.getNeo4jInstance().session();
    const result = await session.run(retriever.getRetrievalQuery());
    const records = result.records;

    expect(records.length).toBeGreaterThan(0);

    const foundText = records.map((r) => r.get("d").properties.text).join(" ");
    expect(foundText).toContain("hypothetical question retriever");

    await session.close();
  });

  test("ParentChildRetriever indexing works with Genkit", async () => {
    const retriever = new ParentChildRetriever(ai, clientParams, indexer);

    const uniqueId = `pc-index-doc-${Date.now()}`;
    const docText = "This document will be indexed in Genkit via ParentChildRetriever.";

    await retriever.ingestDocument({ documents: [{ text: docText, metadata: { uniqueId } }] });

    const retrieverRef = neo4jRetrieverRef({ indexId });
    const results = await ai.retrieve({
      retriever: retrieverRef,
      query: "indexed in Genkit",
      options: { k: 10, filter: { uniqueId } },
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content[0].text).toContain("indexed in Genkit");
  });
});




describe('Neo4j Plugin Integration', () => {
  
  // Reference to the Testcontainers Neo4j instance
  let neo4jContainer: StartedNeo4jContainer;

  // Global variables for the Genkit instance and Neo4j connection
  let ai: ReturnType<typeof genkit>;
  let driver: Driver;
  let session: Session;

  // Unique ID used for the vector index in Neo4j (corresponds to the node label)
  const indexId = 'genkit-test-index';
  // Cypher Label for the node, quoted for safety
  const INDEX_LABEL = `\`${indexId}\``; 
  const INDEXER_REF = neo4jIndexerRef({ indexId });
  const RETRIEVER_REF = neo4jRetrieverRef({ indexId });
  const CLEANUP_QUERY = `MATCH (n) DETACH DELETE n`;
  const FIND_NODE_QUERY = `MATCH (n:${INDEX_LABEL} {uniqueId: $uniqueId}) RETURN n`;

  let clientParams;
  
  // --- Setup and Teardown ---

  beforeAll(async () => {

    // 1. Start the Neo4j Docker container using Testcontainers.
    // This automatically pulls the image and waits for the database to be ready.
    neo4jContainer = await new Neo4jContainer('neo4j:5.26.16')
      .withWaitStrategy(Wait.forLogMessage('Started.'))
      .start();
    
    // 2. Get the dynamically generated connection parameters
    const uri = neo4jContainer.getBoltUri();
    const username = neo4jContainer.getUsername();
    const password = neo4jContainer.getPassword();

    // 3. Initialize the standalone Neo4j driver (for cleanup/verification)
    driver = neo4jDriver(
      uri,
      auth.basic(username, password),
    );
  }, 120000);

  beforeEach(async () => {

    // 4. Configure the client with dynamic connection parameters from the container
    clientParams = {
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
            embedder: mockEmbedder, 
            clientParams: clientParams, 
          },
        ]),
      ],
    });
    
    // Open a new Neo4j session for verification operations
    session = driver.session();
  });
  
  afterEach(async () => {
    
    // Cleanup: deletes all test nodes
    try {
      await session.run(CLEANUP_QUERY);
    } finally {
      // Close the Neo4j session after cleanup
      await session.close();
    }
  });

  afterAll(async () => {
    // Close the global Neo4j driver
    await driver.close();
    
    // 5. Stop and dispose of the Testcontainers Neo4j container
    await neo4jContainer.stop();
  });


  // --- Integration Tests ---

  test('should successfully index a document and verify node creation', async () => {
    // 1. Data Setup
    const uniqueId = `test-doc-${Date.now()}`;
    const initialText = 'This is a test document for indexing and retrieval.';
    const newDocument = new Document({
      content: [{ text: initialText }],
      metadata: { uniqueId },
    });
    const query = 'This is a test document to be retrieved.';

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
      query: query,
      options: {
        k: 10,
        filter: { uniqueId }, // Filters by the unique ID to ensure a hit
      },
    });

    // 5. Retrieval Verification
    expect(docs).toHaveLength(1);
    expect(docs[0].content[0].text).toContain('indexing and retrieval');
  });

  test('should retrieve documents using a specific metadata filter', async () => {
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
    const query = 'What animal information is available?';
    const filter = { animal: CAT_ANIMAL, commonId };

    const retrievedDocs = await ai.retrieve({
      retriever: RETRIEVER_REF,
      query: query,
      options: {
        k: 10,
        filter, // Apply the filter: should only retrieve "cat" documents
      },
    });

    // 5. Retrieval Verification: two documents should match the 'cat' filter
    expect(retrievedDocs).toHaveLength(2);
    expect(retrievedDocs.every(doc => doc.metadata?.animal === CAT_ANIMAL)).toBe(true);
  });

  test('should return an empty array for a non-matching query', async () => {
    // 1. Data Setup
    const uniqueId = `test-doc-${Date.now()}`;
    const newDocument = new Document({
      content: [{ text: 'This is a test document about technology.' }],
      metadata: { uniqueId },
    });
    const query = 'This query should not find anything about animals.';
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
      query: query,
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