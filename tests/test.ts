import { genkit, Document } from "genkit";
import { neo4j, neo4jIndexerRef, neo4jRetrieverRef } from "./src/index";
import { textEmbedding004, googleAI } from "@genkit-ai/googleai";
import * as dotenv from "dotenv";
dotenv.config();

const ai = genkit({
  plugins: [
    googleAI(),
    neo4j([
      {
        indexId: "model",
        embedder: textEmbedding004,
      },
    ]),
  ],
});

export const bobFactsIndexer = neo4jIndexerRef({
  indexId: "model",
});

const indexy = async () => {
  await ai.index({ indexer: bobFactsIndexer, documents, options: {} });
};

const documents = [
  Document.fromText("Tomaz je kralj", { wtf: "wtf" }),
  Document.fromText("Kralj je Tomaz", { wtf: "wtf" }),
];
indexy();

// To specify an index:
export const bobFactsRetriever = neo4jRetrieverRef({
  indexId: "model",
});

const query = "Who is Bob";
const queryy = async () => {
  const data = await ai.retrieve({
    retriever: bobFactsRetriever,
    query,
    options: {
      k: 10, // Required number of results to return
    },
  });
  return data;
};

// To use the index you configured when you loaded the plugin:
const out = async () => {
  let docs = await queryy();
  console.log(docs);
};

out();
