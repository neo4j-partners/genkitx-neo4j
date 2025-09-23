import { googleAI } from '@genkit-ai/googleai';
import { Document, genkit } from 'genkit';
import { test, describe, expect, afterAll, beforeAll, beforeEach, afterEach } from '@jest/globals';
import { Driver, auth, driver as neo4jDriver, Session } from 'neo4j-driver';
import { neo4j, neo4jIndexerRef, neo4jRetrieverRef } from '..';

describe('Neo4j Plugin Integration', () => {
  const requiredVars = ['NEO4J_URI', 'NEO4J_USERNAME', 'NEO4J_PASSWORD', 'GEMINI_API_KEY'];
  const missingVars = requiredVars.filter(env => !process.env[env]);
  const canRunTest = missingVars.length === 0;

  // Use 'test.skip' if environment variables are not present
  const runTest = canRunTest ? test : test.skip;

  let ai: ReturnType<typeof genkit>;
  let driver: Driver;
  let session: Session;

  const indexId = 'genkit-test-index';
  
  beforeAll(async () => {
    if (!canRunTest) return;

    driver = neo4jDriver(
      process.env.NEO4J_URI as string,
      auth.basic(process.env.NEO4J_USERNAME as string, process.env.NEO4J_PASSWORD as string),
    );
  });

  beforeEach(async () => {
    if (!canRunTest) return;

    ai = genkit({
      plugins: [
        googleAI(),
        neo4j([
          {
            indexId,
            embedder: googleAI.embedder('gemini-embedding-001'),
            clientParams: {
              url: process.env.NEO4J_URI as string,
              username: process.env.NEO4J_USERNAME as string,
              password: process.env.NEO4J_PASSWORD as string,
              database: 'neo4j',
            },
          },
        ]),
      ],
    });
    session = driver.session();
  });
  
  afterEach(async () => {
    if (!canRunTest) return;
    
    try {
      await session.run(`MATCH (n:\`${indexId}\`) DETACH DELETE n`);
    } finally {
      await session.close();
    }
  });

  afterAll(async () => {
    if (!canRunTest) return;
    await driver.close();
  });

  runTest('should successfully index a document and verify node creation', async () => {
    const uniqueId = `test-doc-${Date.now()}`;
    const newDocument = new Document({
      content: [{ text: 'This is a test document for indexing and retrieval.' }],
      metadata: { uniqueId },
    });

    const indexer = neo4jIndexerRef({ indexId });
    await ai.index({ indexer, documents: [newDocument] });

    const result = await session.run(
      `MATCH (n:\`${indexId}\` {uniqueId: $uniqueId}) RETURN n`,
      { uniqueId },
    );
    expect(result.records).toHaveLength(1);
    expect(result.records[0].get('n').properties.uniqueId).toBe(uniqueId);

    const retriever = neo4jRetrieverRef({ indexId });
    const docs = await ai.retrieve({
      retriever,
      query: 'This is a test document to be indexed.',
      options: {
        k: 10,
        filter: { uniqueId },
      },
    });

    expect(docs).toHaveLength(1);
    expect(docs[0].content[0].text).toContain('indexing and retrieval');
  });

  runTest('should retrieve documents using a specific metadata filter', async () => {
    const commonId = `common-doc-${Date.now()}`;
    const docsToInsert = [
      new Document({
        content: [{ text: 'Document 1 about cats.' }],
        metadata: { animal: 'cat', commonId },
      }),
      new Document({
        content: [{ text: 'Document 2 about dogs.' }],
        metadata: { animal: 'dog', commonId },
      }),
      new Document({
        content: [{ text: 'Another document about cats.' }],
        metadata: { animal: 'cat', commonId },
      }),
    ];

    const indexer = neo4jIndexerRef({ indexId });
    await ai.index({ indexer, documents: docsToInsert });

    const result = await session.run(
      `MATCH (n:\`${indexId}\` {commonId: $commonId}) RETURN n`,
      { commonId },
    );
    expect(result.records).toHaveLength(3);
    const animals = result.records.map(r => r.get('n').properties.animal);
    expect(animals).toEqual(expect.arrayContaining(['cat', 'cat', 'dog']));

    const retriever = neo4jRetrieverRef({ indexId });
    const retrievedDocs = await ai.retrieve({
      retriever,
      query: 'What animal information is available?',
      options: {
        k: 10,
        filter: { animal: 'cat', commonId },
      },
    });

    expect(retrievedDocs).toHaveLength(2);
    expect(retrievedDocs.every(doc => doc.metadata?.animal === 'cat')).toBe(true);
  });

  runTest('should return an empty array for a non-matching query', async () => {
    const uniqueId = `test-doc-${Date.now()}`;
    const newDocument = new Document({
      content: [{ text: 'This is a test document.' }],
      metadata: { uniqueId },
    });

    const indexer = neo4jIndexerRef({ indexId });
    await ai.index({ indexer, documents: [newDocument] });

    const createdResult = await session.run(
      `MATCH (n:\`${indexId}\` {uniqueId: $uniqueId}) RETURN n`,
      { uniqueId },
    );
    expect(createdResult.records).toHaveLength(1);

    const retriever = neo4jRetrieverRef({ indexId });
    const docs = await ai.retrieve({
      retriever,
      query: 'This query should not find anything.',
      options: {
        k: 10,
        filter: { nonExistentField: 'nonExistentValue' },
      },
    });
    expect(docs).toHaveLength(0);
  });
});