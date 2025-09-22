import {
  __async,
  __spreadValues,
  init_esm_shims
} from "./chunk-ZCOIUWAI.mjs";
init_esm_shims();
import * as neo4j_driver from "neo4j-driver";
import { z } from "genkit";
import { genkitPlugin } from "genkit/plugin";
import {
  CommonRetrieverOptionsSchema,
  Document,
  indexerRef,
  retrieverRef
} from "genkit/retriever";
const Neo4jRetrieverOptionsSchema = CommonRetrieverOptionsSchema.extend({
  k: z.number().max(1e3)
  // filter: z.record(z.string(), z.any()).optional(), later for metadata filtering
});
const Neo4jIndexerOptionsSchema = z.object({
  namespace: z.string().optional()
});
const neo4jRetrieverRef = (params) => {
  var _a;
  return retrieverRef({
    name: `neo4j/${params.indexId}`,
    info: {
      label: (_a = params.displayName) != null ? _a : `Neo4j - ${params.indexId}`
    },
    configSchema: Neo4jRetrieverOptionsSchema
  });
};
const neo4jIndexerRef = (params) => {
  var _a;
  return indexerRef({
    name: `neo4j/${params.indexId}`,
    info: {
      label: (_a = params.displayName) != null ? _a : `Neo4j - ${params.indexId}`
    }
    //configSchema: Neo4jIndexerOptionsSchema.optional(),
  });
};
function neo4j(params) {
  return genkitPlugin("neo4j", (ai) => __async(null, null, function* () {
    params.map((i) => configureNeo4jRetriever(ai, i));
    params.map((i) => configureNeo4jIndexer(ai, i));
  }));
}
var index_default = neo4j;
function configureNeo4jRetriever(ai, params) {
  var _a;
  const { indexId, embedder, embedderOptions } = __spreadValues({}, params);
  const neo4jConfig = (_a = params.clientParams) != null ? _a : getDefaultConfig();
  const neo4j_instance = neo4j_driver.driver(
    neo4jConfig.url,
    // URL (protocol://host:port)
    neo4j_driver.auth.basic(neo4jConfig.username, neo4jConfig.password)
    // Authentication
  );
  return ai.defineRetriever(
    {
      name: `neo4j/${params.indexId}`,
      configSchema: Neo4jRetrieverOptionsSchema
    },
    (content, options) => __async(null, null, function* () {
      const queryEmbeddings = yield ai.embed({
        embedder,
        content,
        options: embedderOptions
      });
      const retriever_query = `
        CALL db.index.vector.queryNodes($index, $k, $embedding) YIELD node, score
        RETURN node.text AS text, node {.*, text: Null,
        embedding: Null, id: Null } AS metadata
        `;
      const response = yield neo4j_instance.executeQuery(
        retriever_query,
        {
          k: options.k,
          embedding: queryEmbeddings[0].embedding,
          index: indexId
        },
        {
          database: neo4jConfig.database
        }
      );
      const documents = response.records.map((el) => {
        return Document.fromText(
          el.get("text"),
          Object.fromEntries(
            Object.entries(el.get("metadata")).filter(
              ([_, value]) => value !== null
            )
          )
        );
      });
      neo4j_instance.close();
      return { documents };
    })
  );
}
function configureNeo4jIndexer(ai, params) {
  var _a;
  const { indexId, embedder, embedderOptions } = __spreadValues({}, params);
  const neo4jConfig = (_a = params.clientParams) != null ? _a : getDefaultConfig();
  const neo4j_instance = neo4j_driver.driver(
    neo4jConfig.url,
    // URL (protocol://host:port)
    neo4j_driver.auth.basic(neo4jConfig.username, neo4jConfig.password)
    // Authentication
  );
  return ai.defineIndexer(
    {
      name: `neo4j/${params.indexId}`
      //configSchema: neo4jIndexerOptionsSchema.optional(),
    },
    (docs, options) => __async(null, null, function* () {
      const embeddings = yield Promise.all(
        docs.map(
          (doc) => ai.embed({
            embedder,
            content: doc,
            options: embedderOptions
          })
        )
      );
      const BATCH_SIZE = 1e3;
      for (let i = 0; i < docs.length; i += BATCH_SIZE) {
        const batchDocs = docs.slice(i, i + BATCH_SIZE);
        const batchEmbeddings = embeddings.slice(i, i + BATCH_SIZE);
        const batchParams = batchDocs.map((el, j) => {
          var _a2;
          return {
            text: el.content[0]["text"],
            metadata: (_a2 = el.metadata) != null ? _a2 : {},
            embedding: batchEmbeddings[j][0]["embedding"]
          };
        });
        yield neo4j_instance.executeQuery(
          `
          UNWIND $data AS row
          CREATE (t:\`${indexId}\`)
          SET t.text = row.text,
              t += row.metadata
          WITH t, row.embedding AS embedding
          CALL db.create.setNodeVectorProperty(t, 'embedding', embedding)
          `,
          { data: batchParams },
          { database: neo4jConfig.database }
        );
      }
      yield neo4j_instance.executeQuery(
        `
        CREATE VECTOR INDEX $indexName IF NOT EXISTS
        FOR (n:\`${indexId}\`) ON n.embedding
        `,
        { indexName: indexId },
        { database: neo4jConfig.database }
      );
      neo4j_instance.close();
    })
  );
}
function getDefaultConfig() {
  const {
    NEO4J_URI: url,
    NEO4J_USERNAME: username,
    NEO4J_PASSWORD: password,
    NEO4J_DATABASE: database
  } = process.env;
  if (!url || !username || !password) {
    throw new Error(
      "Please provide Neo4j connection details through environment variables: NEO4J_URI, NEO4J_USERNAME, and NEO4J_PASSWORD are required.\nFor more details see https://neo4j.com/docs/api/javascript-driver/current/"
    );
  }
  return __spreadValues({
    url,
    username,
    password
  }, database && { database });
}
export {
  configureNeo4jIndexer,
  configureNeo4jRetriever,
  index_default as default,
  neo4j,
  neo4jIndexerRef,
  neo4jRetrieverRef
};
//# sourceMappingURL=index.mjs.map