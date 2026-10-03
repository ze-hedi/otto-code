import { MongoClient, Db } from "mongodb";

let client: MongoClient;
let db: Db;

export async function connectDb(uri = "mongodb://localhost:27017", dbName = "otto_web"): Promise<Db> {
  client = new MongoClient(uri);
  await client.connect();
  db = client.db(dbName);
  console.log(`Connected to MongoDB: ${dbName}`);
  return db;
}

export function getDb(): Db {
  if (!db) throw new Error("Database not connected. Call connectDb() first.");
  return db;
}
