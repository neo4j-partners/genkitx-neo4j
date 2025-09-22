import { googleAI } from '@genkit-ai/googleai';
import { DocumentData, Document, genkit, z } from 'genkit';
import { chroma, chromaRetrieverRef } from 'genkitx-chromadb';
// import { chroma } from 'genkitx-neo4j';

import { neo4j, neo4jIndexerRef, neo4jRetrieverRef } from './index.js';
/* NEO4J PART */
const ai = genkit({
  plugins: [
    googleAI(),
    neo4j([
      {
          // You must specify a Neo4j index ID and the embedding model you want to use.
          indexId: 'bob-facts2',
          embedder: googleAI.embedder('gemini-embedding-001'),

          // Optional: You can also specify the client parameters to connect to your Neo4j instance.
          // If not provided, we can use environment variables or default values.
          /*
              NEO4J_URI=bolt://localhost:7687  # Neo4j's binary protocol
              NEO4J_USERNAME=neo4j
              NEO4J_PASSWORD=password
              NEO4J_DATABASE=neo4j  # Optional: specify database name
          */
          // leverage "neo4j-driver": "^5.26.0",
          clientParams: {
              url: 'bolt://localhost:7687',
              username: 'neo4j',
              password: 'apoc12345',
              database: 'neo4j'
          }
      }
    ]),
    chroma([
      {
        collectionName: 'bob_collection',
        embedder: googleAI.embedder('gemini-embedding-001'),
      },
    ])
  ],
});


const chromaFun = async () => {

    // To use the index you configured when you loaded the plugin:
    let docs = await ai.retrieve({ retriever: chromaRetrieverRef, query: 'a' });

    // To specify an index:
    const bobFactsRetriever = chromaRetrieverRef({
    collectionName: 'bob-facts',
    });
    docs = await ai.retrieve({ retriever: bobFactsRetriever, query: 'a', 
        options: {
            where: {a: 1},
            k: 10,
        } 
    });
}

// Run the flow
async function main() {

  // Insert and retrieve documents using Neo4j retriever
  const newDocument = new Document({
    content: [
      {
        text: 'Bob is a software engineer who loves hiking and photography.',
      },
    ],
    metadata: {
      source: Math.random(),
      personName: Math.random(),
    },
  });
  // // TODO - Example of adding and retrieving documents using Neo4j plugin
  // const newDocument: DocumentData = {
  //   text: 'Bob is a software engineer who loves hiking and photography.',
  //   metadata: {
  //     source: 'input.source',
  //     personName: 'input.personName',
  //   },
  // };
  
  const bobFactsIndexer = neo4jIndexerRef({
    indexId: 'bob-facts2',
    displayName: 'Bob Facts Indexer',
  });
  await ai.index({ indexer: bobFactsIndexer, documents: [newDocument] });

  // // To specify an index:
  const bobFactsRetriever = neo4jRetrieverRef({
    indexId: 'bob-facts2',
    displayName: 'Bob Facts Retriever',
  });

  // // To use the index you configured when you loaded the plugin:
  const docs = await ai.retrieve({
    retriever: bobFactsRetriever,
    query: 'What do you know about Bob?',
    options: {
        k: 10,
        filter: {
          "name": "test"
        }
    }
  });
  console.log('docs', docs);



  // const recipe = await recipeGeneratorFlow({
  //   ingredient: 'avocado',
  //   dietaryRestrictions: 'vegetarian'
  // });

  // console.log(recipe);


  console.log('done');
}

main().catch(console.error);