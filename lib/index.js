"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};
var index_exports = {};
__export(index_exports, {
  configureNeo4jIndexer: () => configureNeo4jIndexer,
  configureNeo4jRetriever: () => configureNeo4jRetriever,
  default: () => index_default,
  neo4j: () => neo4j,
  neo4jIndexerRef: () => neo4jIndexerRef,
  neo4jRetrieverRef: () => neo4jRetrieverRef
});
module.exports = __toCommonJS(index_exports);
var neo4j_driver = __toESM(require("neo4j-driver"));
var import_genkit = require("genkit");
var import_plugin = require("genkit/plugin");
var import_retriever = require("genkit/retriever");
const Neo4jRetrieverOptionsSchema = import_retriever.CommonRetrieverOptionsSchema.extend({
  k: import_genkit.z.number().max(1e3)
  // filter: z.record(z.string(), z.any()).optional(), later for metadata filtering
});
const Neo4jIndexerOptionsSchema = import_genkit.z.object({
  namespace: import_genkit.z.string().optional()
});
const neo4jRetrieverRef = (params) => {
  var _a;
  return (0, import_retriever.retrieverRef)({
    name: `neo4j/${params.indexId}`,
    info: {
      label: (_a = params.displayName) != null ? _a : `Neo4j - ${params.indexId}`
    },
    configSchema: Neo4jRetrieverOptionsSchema
  });
};
const neo4jIndexerRef = (params) => {
  var _a;
  return (0, import_retriever.indexerRef)({
    name: `neo4j/${params.indexId}`,
    info: {
      label: (_a = params.displayName) != null ? _a : `Neo4j - ${params.indexId}`
    }
    //configSchema: Neo4jIndexerOptionsSchema.optional(),
  });
};
function neo4j(params) {
  return (0, import_plugin.genkitPlugin)("neo4j", (ai) => __async(null, null, function* () {
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
        return import_retriever.Document.fromText(
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  configureNeo4jIndexer,
  configureNeo4jRetriever,
  neo4j,
  neo4jIndexerRef,
  neo4jRetrieverRef
});
//# sourceMappingURL=index.js.map