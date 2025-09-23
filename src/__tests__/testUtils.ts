import { test, beforeAll, afterAll, afterEach } from '@jest/globals';
import { Driver, auth, driver as neo4jDriver, Session } from 'neo4j-driver';

// This function encapsulates the entire setup and cleanup logic.
export const setupNeo4jTestEnv = (beforeEachCallback?: () => Promise<void>) : any => {
  const requiredVars = ['NEO4J_URI', 'NEO4J_USERNAME', 'NEO4J_PASSWORD', 'GEMINI_API_KEY'];
  const missingVars = requiredVars.filter(env => !process.env[env]);
  const canRunTest = missingVars.length === 0;

  // Conditionally skips tests if required environment variables are missing.
  const runTest = canRunTest ? test : test.skip;

  let driver: Driver | undefined;
  let session: Session | undefined;

  const indexId = 'genkit-test-index';

  // Establishes a single Neo4j driver connection for the entire test suite.
  beforeAll(async () => {
    if (!canRunTest) return;

    driver = neo4jDriver(
      process.env.NEO4J_URI as string,
      auth.basic(process.env.NEO4J_USERNAME as string, process.env.NEO4J_PASSWORD as string),
    );
  });

  beforeEach(async () => {
    if (!canRunTest || !driver) return;

    session = driver.session();

    // Executes callback if exists
    if (beforeEachCallback) {
      await beforeEachCallback();
    }
  });

  // Cleans up nodes and closes the session after each test.
  afterEach(async () => {
    if (!canRunTest || !driver || !session) return;
    
    try {
      await session.run(`MATCH (n:\`${indexId}\`) DETACH DELETE n`);
    } finally {
      await session.close();
    }
  });

  // Closes the Neo4j driver connection once all tests are complete.
  afterAll(async () => {
    if (!canRunTest || !driver) return;
    await driver.close();
  });

  // Returns variables and hooks needed in the test file.
  return {
    runTest,
    indexId,
    canRunTest,
    getDriver: () => driver as Driver,
    getSession: () => session as Session,
  };
};