# Steps TCK

- **Short-term**: Current conversation context; handles immediate flow but vanishes when the session ends.

- **Long-term**: Persistent database, remembers user facts and history across different sessions.

- **Reasoning**: Internal scratchpad, tracks logical steps and intermediate thoughts to solve complex problems.


NB: see TCK.md for more details

DOING: --> server-without-llm.py
```bash
uv run --python 3.12 --with fastapi --with uvicorn --with "neo4j-agent-memory[sentence-transformers]" uvicorn server-without-llm:app --port 8000 
```

```bash
# Build the TypeScript client for the Neo4j plugin
npx tsx ../agent-memory-tck/clients/typescript/src/client.ts

# Test the Neo4j plugin with the official client (Python) and genkit-agent-memory-tck
npx tsx test-standalone.ts 
```

```bash
uv run --python 3.12 --with fastapi --with uvicorn --with "neo4j-agent-memory[sentence-transformers]" uvicorn server:app --port 8000


$ npx tsx test-integration.ts
giuseppevillani@gvillani genkitx-neo4j % npx tsx test-integration.ts
1. Initializing Genkit with YOUR neo4j plugin...
2. Retrieving Tools from the internal Genkit registry...
✅ Tools successfully registered in Genkit!
3. Executing Tool 'addMemoryEntity'...
✅ Tool Result (Add): Entity TestGenkitVettore saved successfully to memory.
⏳ Waiting 2 seconds to allow Neo4j to index the vector...
4. Executing Tool 'searchMemoryEntities'...
✅ Tool Result (Search): [
  {
    id: undefined,
    name: 'TestGenkitVettore',
    type: undefined,
    subtype: undefined,
    description: 'Created with Genkit and local embedding',
    embedding: undefined,
    canonicalName: undefined,
    createdAt: undefined
  }
]
```

# TODO
- Test `npx tsx test-agent.ts` and see if it works


- [https://gemini.google.com/app/e88135ecadde58e1?hl=it](https://gemini.google.com/app/e88135ecadde58e1?hl=it)
- It says to install `npm install @neo4j-labs/agent-memory`, but it would be better not to install it every time. We should do it like `llm-chunk`: if I want to use long-term memory I use it, otherwise it should work without it as well.

- We should sync the model with Neo4j agent-memory tck for compatibility regarding `messageLabel`.


### Please note: not yet publicly available ---

#### Go to the TCK library folder
cd ../agent-memory-tck/clients/typescript

#### Install internal dependencies and compile code to JS
npm install
npm run build

#### Return to your project
cd ../../../genkitx-neo4j

### ---

# genkitx-neo4j - Neo4j plugin for Genkit

This is a Genkit Plugin for Neo4j.

## Installing the plugin

```bash
npm i --save genkitx-neo4j
```

## Environment variables

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