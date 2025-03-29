# genkitx-neo4j - Neo4j plugin for Genkit

This is a Genkit Plugin for Neo4j.

## Installing the plugin

```bash
npm i --save genkitx-neo4j
```

## Environment variable

Define Neo4j credentials using:

```
NEO4J_URI=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=password
```

## Using the plugin

```ts
import { genkit } from 'genkit';
import {
  neo4j,
  neo4jRetrieverRef,
  neo4jIndexerRef,
} from 'genkitx-neo4j';

const ai = genkit({
  plugins: [
    neo4j([
      {
        indexId: 'bob-facts',
        embedder: textEmbedding004,
      },
    ]),
  ],
});

export const bobFactsIndexer = neo4jIndexerRef({
  indexId: 'bob-facts',
});
await ai.index({ indexer: bobFactsIndexer, documents });

// To specify an index:
export const bobFactsRetriever = neo4jRetrieverRef({
  indexId: 'bob-facts',
});

// To use the index you configured when you loaded the plugin:
let docs = await ai.retrieve({ retriever: bobFactsRetriever, query });
```

Usage information and reference details can be found in [Genkit documentation](https://firebase.google.com/docs/genkit).
