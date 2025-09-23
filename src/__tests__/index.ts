import { googleAI } from '@genkit-ai/googleai';
import { Document, genkit } from 'genkit';
import { test, describe, expect } from '@jest/globals';
import neo4j, { neo4jIndexerRef, neo4jRetrieverRef } from '..';

describe('Neo4j Plugin Integration', () => {
  const requiredVars = ['NEO4J_URI', 'NEO4J_USERNAME', 'NEO4J_PASSWORD', 'GEMINI_API_KEY'];
  const missingVars = requiredVars.filter(env => !process.env[env]);
  const canRunTest = missingVars.length === 0;

  if (!canRunTest) {
    console.warn('Skipping Neo4j integration tests due to missing environment variables.');
    return;
  }

  let ai: ReturnType<typeof genkit>;

  beforeEach(() => {
    ai = genkit({
      plugins: [
        googleAI(),
        neo4j([
          {
            indexId: 'genkit-test-index',
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
  });

  test('should document and retrieve it with custom label', async () => {
    const uniqueId = `test-doc-${Date.now()}`;
    const newDocument = new Document({
      content: [
        { text: 'This is a test document for indexing and retrieval.' }
      ],
      metadata: { uniqueId },
    });

    const indexer = neo4jIndexerRef({ indexId: 'genkit-test-index' , a: '1'});
    await ai.index({ indexer, documents: [newDocument] });

    const retriever = neo4jRetrieverRef({ indexId: 'genkit-test-index' });
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


  // test('should successfully index a document and retrieve it', async () => {
  //   const uniqueId = `test-doc-${Date.now()}`;
  //   const newDocument = new Document({
  //     content: [
  //       { text: 'This is a test document for indexing and retrieval.' }
  //     ],
  //     metadata: { uniqueId },
  //   });

  //   const indexer = neo4jIndexerRef({ indexId: 'genkit-test-index' });
  //   await ai.index({ indexer, documents: [newDocument] });

  //   const retriever = neo4jRetrieverRef({ indexId: 'genkit-test-index' });
  //   const docs = await ai.retrieve({
  //     retriever,
  //     query: 'This is a test document to be indexed.',
  //     options: {
  //       k: 10,
  //       filter: { uniqueId },
  //     },
  //   });

  //   expect(docs).toHaveLength(1);
  //   expect(docs[0].content[0].text).toContain('indexing and retrieval');
  // });

  // test('should retrieve documents using a specific metadata filter', async () => {
  //   const commonId = `common-doc-${Date.now()}`;
  //   const docsToInsert = [
  //     new Document({
  //       content: [{ text: 'Document 1 about cats.' }],
  //       metadata: { animal: 'cat', commonId },
  //     }),
  //     new Document({
  //       content: [{ text: 'Document 2 about dogs.' }],
  //       metadata: { animal: 'dog', commonId },
  //     }),
  //     new Document({
        
  //       content: [{ text: 'Another document about cats.' }],
  //       metadata: { animal: 'cat', commonId },
  //     }),
  //   ];

  //   const indexer = neo4jIndexerRef({ indexId: 'genkit-test-index' });
  //   await ai.index({ indexer, documents: docsToInsert });

  //   const retriever = neo4jRetrieverRef({ indexId: 'genkit-test-index' });
  //   const retrievedDocs = await ai.retrieve({
  //     retriever,
  //     query: 'What animal information is available?',
  //     options: {
  //       k: 10,
  //       filter: { animal: 'cat', commonId },
  //     },
  //   });

  //   expect(retrievedDocs).toHaveLength(2);
  //   expect(retrievedDocs.every(doc => doc.metadata?.animal === 'cat')).toBe(true);
  // });

  // test('should return an empty array for a non-matching query', async () => {
  //   const retriever = neo4jRetrieverRef({ indexId: 'genkit-test-index' });
  //   const docs = await ai.retrieve({
  //     retriever,
  //     query: 'This query should not find anything.',
  //     options: {
  //       k: 10,
  //       filter: { nonExistentField: 'nonExistentValue' },
  //     },
  //   });
  //   expect(docs).toHaveLength(0);
  // });
});