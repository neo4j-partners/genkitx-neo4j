import { googleAI } from '@genkit-ai/googleai';
import { Document, genkit } from 'genkit';
import { test, describe, expect, afterAll, beforeAll, beforeEach, afterEach } from '@jest/globals';
import { neo4j, neo4jIndexerRef, neo4jRetrieverRef } from '..';

import { mockEmbedder } from '../dummyEmbedder';
import { fail } from 'assert';
import { setupNeo4jTestEnvironment } from '../test-utils';


/**
 * This file contains integration tests for the Genkit Neo4j plugin,
 * using @testcontainers/neo4j to spin up a disposable Docker Neo4j instance
 * for each test run.
 */
describe('Neo4j Plugin Integration', () => {

  // Unique ID used for the vector index in Neo4j (corresponds to the node label)
  const indexId = 'genkit-test-index';
  // Cypher Label for the node, quoted for safety
  const INDEX_LABEL = `\`${indexId}\``;
  const INDEXER_REF = neo4jIndexerRef({ indexId });
  const RETRIEVER_REF = neo4jRetrieverRef({ indexId });
  const FIND_NODE_QUERY = `MATCH (n:${INDEX_LABEL} {uniqueId: $uniqueId}) RETURN n`;

  // Initialize the before / after / beforeAll / afterAll
  const setupCtx = setupNeo4jTestEnvironment('5.26.16', indexId);


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
    await setupCtx.ai.index({ indexer: INDEXER_REF, documents: [newDocument] });

    // 3. Neo4j Verification: ensure the node was created
    const result = await setupCtx.session.run(
      FIND_NODE_QUERY,
      { uniqueId },
    );

    expect(result.records).toHaveLength(1);
    expect(result.records[0].get('n').properties.uniqueId).toBe(uniqueId);
    // Verifies that the content was stored correctly
    expect(result.records[0].get('n').properties.text).toBe(initialText);

    // 4. Action: Retrieve the indexed document
    // Uses the predefined retriever reference (RETRIEVER_REF)
    const docs = await setupCtx.ai.retrieve({
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

  test('should successfully index a document with a custom retrieval query and verify node creation', async () => {
    // 1. Data Setup
    const uniqueId = `test-doc-${Date.now()}`;
    const initialText = 'This is a test document for indexing and retrieval.';
    const newDocument = new Document({
      content: [{ text: initialText }],
      metadata: { uniqueId },
    });
    const query = 'This is a test document to be indexed.';
    setupCtx.ai = genkit({
      plugins: [
        googleAI(),
        neo4j([
          {
            indexId,
            embedder: mockEmbedder,
            clientParams: setupCtx.clientParams,
            retrievalQuery: "RETURN node.text AS text, {mockProp: '1'} AS metadata"
          },
        ]),
      ],
    });

    // 2. Action: Index the document
    await setupCtx.ai.index({ indexer: INDEXER_REF, documents: [newDocument] });

    // 3. Neo4j Verification: ensure the node was created
    const result = await setupCtx.session.run(
      FIND_NODE_QUERY,
      { uniqueId },
    );

    // Verifies that the content was stored correctly
    expect(result.records).toHaveLength(1);
    expect(result.records[0].get('n').properties.uniqueId).not.toBeNull();
    expect(result.records[0].get('n').properties.text).toBe(initialText);

    // 4. Action: Retrieve the indexed document
    const docs = await setupCtx.ai.retrieve({
      retriever: RETRIEVER_REF,
      query: query,
      options: {
        k: 10,
        filter: { uniqueId },
      },
    });

    // 5. Retrieval Verification
    expect(docs).toHaveLength(1);
    console.log('docs[0]', docs[0]);
    expect(docs[0].content[0].text).toContain('indexing and retrieval');

    expect(docs[0].metadata?.mockProp).toBe('1');
  });

  test('should document and retrieve it with custom label and hybrid search', async () => {
    const customLabel = 'customLabel'
    const customLabelIdx = 'customLabelIdx'
    setupCtx.ai = genkit({
      plugins: [
        googleAI(),
        neo4j([
          {
            indexId: customLabelIdx,
            embedder: mockEmbedder,
            clientParams: setupCtx.clientParams,
            label: customLabel,
            fullTextQuery: 'document',
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
    await setupCtx.ai.index({ indexer: indexerRef, documents: [newDocument] });

    const docs = await setupCtx.ai.retrieve({
      retriever: retrieverRef,
      query: 'This is a test document to be indexed.',
      options: {
        k: 10
      },
    });

    expect(docs).toHaveLength(1);
    expect(docs[0].content[0].text).toContain('indexing and retrieval');
    
    
    const verificationQuery = `MATCH (n:${customLabel}) RETURN n`;
    const result = await setupCtx.session.run(verificationQuery);

    expect(result.records).toHaveLength(1);
    const allCustomLabels = result.records.every(r => r.get('n').labels[0] == customLabel);
    expect(allCustomLabels).toBeTruthy();
  });

  test('should throws error with filter and hybrid search', async () => {
    const customLabel = 'customLabel'
    const customLabelIdx = 'customLabelIdx'
    setupCtx.ai = genkit({
      plugins: [
        googleAI(),
        neo4j([
          {
            indexId: customLabelIdx, 
            embedder: mockEmbedder,
            clientParams: setupCtx.clientParams,
            label: customLabel,
            fullTextQuery: 'document',
            searchType: 'hybrid',
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
    await setupCtx.ai.index({ indexer: indexerRef, documents: [newDocument] });

    try {
      const docs = await setupCtx.ai.retrieve({
        retriever: retrieverRef,
        query: 'This is a test document to be indexed.',
        options: {
          k: 10,
          filter: { uniqueId },
        },
      });
      fail("Expected error was not thrown");
    } catch (e) {
      console.log("Caught error as expected");
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).toBe("Metadata filtering can't be use in combination with a hybrid search approach."); 
    }
  })

  test('should document and retrieve it with custom label and hybrid search without fullTextQuery', async () => {
    const customLabel = 'customLabel'
    const customLabelIdx = 'customLabelIdx'
    setupCtx.ai = genkit({
      plugins: [
        googleAI(),
        neo4j([
          {
            indexId: customLabelIdx,
            embedder: mockEmbedder,
            clientParams: setupCtx.clientParams,
            label: customLabel,
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
    await setupCtx.ai.index({ indexer: indexerRef, documents: [newDocument] });

    const docs = await setupCtx.ai.retrieve({
      retriever: retrieverRef,
      query: 'This is a test document to be indexed.',
      options: {
        k: 10,
      },
    });

    expect(docs).toHaveLength(1);
    expect(docs[0].content[0].text).toContain('indexing and retrieval');    
    
    const verificationQuery = `MATCH (n:${customLabel}) RETURN n`;
    const result = await setupCtx.session.run(verificationQuery);
    expect(result.records).toHaveLength(1);
    const allCustomLabels = result.records.every(r => r.get('n').labels[0] == customLabel);
    expect(allCustomLabels).toBeTruthy();
  });

  test('should document and retrieve it with custom label, properties and filter and hybrid search', async () => {
    const customLabel = 'customLabelEntities'
    const customEntitiesIdx = 'customEntitiesIdx'
    const customTextProperty = 'customTextProperty'
    const customEmbeddingProperty = 'customEmbeddingProperty'
    const customIdProperty = 'customIdProperty'
    setupCtx.ai = genkit({
      plugins: [
        googleAI(),
        neo4j([
          {
            indexId: customEntitiesIdx,
            embedder: mockEmbedder,
            clientParams: setupCtx.clientParams,
            label: customLabel,
            textProperty: customTextProperty,
            embeddingProperty: customEmbeddingProperty,
            idProperty: customIdProperty,
            fullTextQuery: 'document',
            searchType: 'hybrid',
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
    await setupCtx.ai.index({ indexer: indexerRef, documents: [newDocument] });

    const docs = await setupCtx.ai.retrieve({
      retriever: retrieverRef,
      query: 'This is a test document to be indexed.',
      options: {
        k: 10,
      },
    });

    expect(docs).toHaveLength(1);
    expect(docs[0].content[0].text).toContain('indexing and retrieval');
    
    
    const verificationQuery = `MATCH (n:${customLabel}) RETURN n`;
    const result = await setupCtx.session.run(verificationQuery);

    expect(result.records).toHaveLength(1);
    const allCustomLabels = result.records.every(r => r.get('n').labels[0] == customLabel);
    expect(allCustomLabels).toBeTruthy();

    const props = result.records.map(r => Object.keys(r.get('n').properties))[0];
    expect(props).toContain(customIdProperty)
    expect(props).toContain(customTextProperty)
    expect(props).toContain(customEmbeddingProperty)
    expect(props).toContain('uniqueId')
  });


  test('should document and retrieve it with custom label, properties and filter and hybrid search with custom fullTextIndexName', async () => {
    const customLabel = 'customLabelEntities1'
    const customEntitiesIdx = 'customEntitiesIdx1'
    const customTextProperty = 'customTextProperty1'
    const customEmbeddingProperty = 'customEmbeddingProperty1'
    const customIdProperty = 'customIdProperty1'
    setupCtx.ai = genkit({
      plugins: [
        googleAI(),
        neo4j([
          {
            indexId: customEntitiesIdx,
            embedder: mockEmbedder,
            clientParams: setupCtx.clientParams,
            label: customLabel,
            textProperty: customTextProperty,
            embeddingProperty: customEmbeddingProperty,
            idProperty: customIdProperty,
            fullTextQuery: 'document',
            searchType: 'hybrid',
            fullTextIndexName: 'customFullTextIndexName', 
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
    await setupCtx.ai.index({ indexer: indexerRef, documents: [newDocument] });

    const docs = await setupCtx.ai.retrieve({
      retriever: retrieverRef,
      query: 'This is a test document to be indexed.',
      options: {
        k: 10,
      },
    });

    expect(docs).toHaveLength(1);
    expect(docs[0].content[0].text).toContain('indexing and retrieval');
    
    
    const verificationQuery = `MATCH (n:${customLabel}) RETURN n`;
    const result = await setupCtx.session.run(verificationQuery);

    expect(result.records).toHaveLength(1);
    const allCustomLabels = result.records.every(r => r.get('n').labels[0] == customLabel);
    expect(allCustomLabels).toBeTruthy();

    const props = result.records.map(r => Object.keys(r.get('n').properties))[0];
    expect(props).toContain(customIdProperty)
    expect(props).toContain(customTextProperty)
    expect(props).toContain(customEmbeddingProperty)
    expect(props).toContain('uniqueId')
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
    await setupCtx.ai.index({ indexer: INDEXER_REF, documents: docsToInsert });

    // 3. Neo4j Verification: ensure all 3 nodes with commonId were created
    const verificationQuery = `MATCH (n:${INDEX_LABEL} {commonId: $commonId}) RETURN n`;
    const result = await setupCtx.session.run(verificationQuery, { commonId });

    expect(result.records).toHaveLength(3);
    const animals = result.records.map(r => r.get('n').properties.animal);
    expect(animals).toEqual(expect.arrayContaining([CAT_ANIMAL, CAT_ANIMAL, DOG_ANIMAL]));

    // 4. Action: Retrieve using a metadata filter
    const query = 'What animal information is available?';
    const filter = { animal: CAT_ANIMAL, commonId };

    const retrievedDocs = await setupCtx.ai.retrieve({
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
    await setupCtx.ai.index({ indexer: INDEXER_REF, documents: [newDocument] });

    // 3. Neo4j Verification
    const createdResult = await setupCtx.session.run(
      FIND_NODE_QUERY,
      { uniqueId },
    );
    expect(createdResult.records).toHaveLength(1);

    // 4. Action: Retrieve using a non-matching filter
    const docs = await setupCtx.ai.retrieve({
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
