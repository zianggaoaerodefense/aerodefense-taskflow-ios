import { MongoClient, Db } from 'mongodb';

let cachedClient: MongoClient | null = null;
let cachedDb: Db | null = null;

const DB_NAME = 'taskflow';

/**
 * Returns a cached MongoDB Db instance, creating and connecting a new
 * MongoClient only on the first call. Subsequent Lambda invocations that
 * share the same execution environment will reuse the existing connection,
 * which avoids the cost of a new TLS handshake on every request.
 *
 * The MongoDB URI is read exclusively from the MONGODB_URI environment
 * variable — it is never hardcoded here or anywhere else in the codebase.
 */
export async function getDb(): Promise<Db> {
  if (cachedDb) return cachedDb;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI environment variable is not set');
  }

  cachedClient = new MongoClient(uri, {
    connectTimeoutMS: 10_000,
    serverSelectionTimeoutMS: 10_000,
  });

  await cachedClient.connect();
  cachedDb = cachedClient.db(DB_NAME);
  return cachedDb;
}

/**
 * Closes the cached connection and clears the module-level cache.
 * Intended for use in tests or graceful-shutdown scenarios; not normally
 * called in production Lambda invocations.
 */
export async function closeDb(): Promise<void> {
  if (cachedClient) {
    await cachedClient.close();
    cachedClient = null;
    cachedDb = null;
  }
}
