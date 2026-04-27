# Passaggi effettuati

```bash
# Build del client TypeScript del plugin Neo4j
npx tsx ../agent-memory-tck/clients/typescript/src/client.ts

# Test del plugin Neo4j con client ufficiale (Python) e genkit-agent-memory-tck
npx tsx test-standalone.ts 
```

```bash
uv run --python 3.12 --with fastapi --with uvicorn --with "neo4j-agent-memory[sentence-transformers]" uvicorn server:app --port 8000


$ npx tsx test-integration.ts
giuseppevillani@gvillani genkitx-neo4j % npx tsx test-integration.ts
1. Inizializzo Genkit con il TUO plugin neo4j...
2. Recupero i Tool dal registro interno di Genkit...
✅ Tool registrati con successo in Genkit!
3. Eseguo il Tool 'addMemoryEntity'...
✅ Risultato del Tool (Add): Entity TestGenkitVettore saved successfully to memory.
⏳ Attendo 2 secondi per permettere a Neo4j di indicizzare il vettore...
4. Eseguo il Tool 'searchMemoryEntities'...
✅ Risultato del Tool (Search): [
  {
    id: undefined,
    name: 'TestGenkitVettore',
    type: undefined,
    subtype: undefined,
    description: 'Creato con Genkit e con embedding locale',
    embedding: undefined,
    canonicalName: undefined,
    createdAt: undefined
  }
]

```

# TODO
- TESTARE `npx tsx test-agent.ts` e vedere se funziona


- https://gemini.google.com/app/e88135ecadde58e1?hl=it
- dice di installare `npm install @neo4j-labs/agent-memory`, però sarebbe meglio non installarlo sempre, ma fare come `llm-chunk`, se voglio usare long term lo uso, altrimenti può funzionare anche senza

- we should sync the model with Neo4j agent-memory tck for compatibility
  riguardo `messageLabel`


### nota bene: non ancora disponibile pubblicamente ---

#### Vai nella cartella della libreria TCK
cd ../agent-memory-tck/clients/typescript

#### Installa le dipendenze interne e compila il codice in JS
npm install
npm run build

#### Torna al tuo progetto
cd ../../../genkitx-neo4j

### ---

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