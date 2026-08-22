import { describe, expect, test } from "@jest/globals";
import { Neo4jSessionStore, Neo4jSessionStoreConfig } from "../session";
import { setupNeo4jTestEnvironment } from "../test-utils";

describe("Neo4jSessionStore", () => {
  let store: Neo4jSessionStore;
  const config: Neo4jSessionStoreConfig = {
    url: process.env.NEO4J_URI as string,
    username: process.env.NEO4J_USERNAME as string,
    password: process.env.NEO4J_PASSWORD as string,
    sessionLabel: "GenkitSessionTest",
  };

  const setupCtx = setupNeo4jTestEnvironment(
    "5.26.16",
    "genkit-test-index",
    (ctx) => {
      config.url = ctx.neo4jContainer.getBoltUri();
      config.username = ctx.neo4jContainer.getUsername();
      config.password = ctx.neo4jContainer.getPassword();
    },
    (_) => {
      store = new Neo4jSessionStore(config);
    },
  );

  test("should save a new snapshot and retrieve it by snapshotId", async () => {
    const sessionId = "test-session-1";

    const snapshotId = await store.saveSnapshot(undefined, (_current) => ({
      sessionId,
      createdAt: new Date().toISOString(),
      state: { messages: [], custom: { user: "Bob" } },
    }));

    expect(snapshotId).toBeTruthy();

    const retrieved = await store.getSnapshot({ snapshotId: snapshotId! });
    expect(retrieved).toBeDefined();
    expect(retrieved!.snapshotId).toBe(snapshotId);
    expect(retrieved!.sessionId).toBe(sessionId);
    expect(retrieved!.state?.custom).toEqual({ user: "Bob" });
  }, 30000);

  test("should retrieve a snapshot by sessionId (latest)", async () => {
    const sessionId = "test-session-latest";

    await store.saveSnapshot(undefined, (_) => ({
      sessionId,
      createdAt: new Date(Date.now() - 100).toISOString(),
      state: { messages: [], custom: { turn: 1 } },
    }));

    await store.saveSnapshot(undefined, (_) => ({
      sessionId,
      createdAt: new Date().toISOString(),
      state: { messages: [], custom: { turn: 2 } },
    }));

    const latest = await store.getSnapshot({ sessionId });
    expect(latest).toBeDefined();
    expect(latest!.state?.custom).toEqual({ turn: 2 });
  }, 30000);

  test("should update an existing snapshot via mutator", async () => {
    const sessionId = "test-session-update";

    const snapshotId = await store.saveSnapshot(undefined, (_) => ({
      sessionId,
      createdAt: new Date().toISOString(),
      state: { messages: [], custom: { step: "initial" } },
    }));

    const updatedId = await store.saveSnapshot(snapshotId!, (current) => ({
      ...current,
      sessionId,
      createdAt: current?.createdAt ?? new Date().toISOString(),
      state: { messages: [], custom: { step: "updated" } },
    }));

    expect(updatedId).toBe(snapshotId);

    const retrieved = await store.getSnapshot({ snapshotId: snapshotId! });
    expect(retrieved!.state?.custom).toEqual({ step: "updated" });
  }, 30000);

  test("should return null when mutator returns null (no-op)", async () => {
    const result = await store.saveSnapshot(undefined, (_) => null);
    expect(result).toBeNull();
  }, 30000);

  test("should return undefined for a non-existent snapshotId", async () => {
    const retrieved = await store.getSnapshot({
      snapshotId: "non-existent-snap-id",
    });
    expect(retrieved).toBeUndefined();
  }, 30000);

  test("should verify snapshot node is persisted in Neo4j graph", async () => {
    const sessionId = "test-session-graph";
    const snapshotId = await store.saveSnapshot(undefined, (_) => ({
      sessionId,
      createdAt: new Date().toISOString(),
      state: { messages: [], custom: { verified: true } },
    }));

    const result = await setupCtx.session.run(
      `MATCH (s:\`${config.sessionLabel}\` {snapshotId: $snapshotId}) RETURN s`,
      { snapshotId },
    );

    expect(result.records).toHaveLength(1);
    const props = result.records[0].get("s").properties;
    expect(props.snapshotId).toBe(snapshotId);
    expect(props.sessionId).toBe(sessionId);
  }, 30000);

  test("should work with custom sessionLabel config", async () => {
    const customConfig: Neo4jSessionStoreConfig = {
      ...config,
      sessionLabel: "CustomSessionLabel",
    };
    const customStore = new Neo4jSessionStore(customConfig);
    const sessionId = "custom-label-session";

    const snapshotId = await customStore.saveSnapshot(undefined, (_) => ({
      sessionId,
      createdAt: new Date().toISOString(),
      state: { messages: [], custom: { label: "custom" } },
    }));

    const result = await setupCtx.session.run(
      `MATCH (s:CustomSessionLabel {snapshotId: $snapshotId}) RETURN s`,
      { snapshotId },
    );
    expect(result.records).toHaveLength(1);
    await customStore.close();
  }, 30000);
});
