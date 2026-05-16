/**
 * dbHelper.ts — Placeholder for real MongoDB integration test helpers.
 *
 * Current tests use Jest mocks at the collection/repo layer to avoid a
 * runtime mongod dependency. If a mongod binary becomes available, swap the
 * mock-based tests for integration tests using MongoMemoryServer:
 *
 *   import { MongoMemoryServer } from 'mongodb-memory-server';
 *   import { MongoClient, Db } from 'mongodb';
 *
 *   let mongod: MongoMemoryServer;
 *   let client: MongoClient;
 *   let db: Db;
 *
 *   export async function startDb(): Promise<Db> {
 *     mongod = await MongoMemoryServer.create();
 *     client = new MongoClient(mongod.getUri());
 *     await client.connect();
 *     db = client.db('taskflow-test');
 *     return db;
 *   }
 *
 *   export async function stopDb(): Promise<void> { ... }
 *   export async function clearDb(): Promise<void> { ... }
 *
 * The `mongodb-memory-server` package is already in devDependencies.
 * Set MONGOMS_DOWNLOAD_URL or MONGOMS_SYSTEM_BINARY to point at a local
 * mongod binary if the CDN is unreachable.
 */

export {};
