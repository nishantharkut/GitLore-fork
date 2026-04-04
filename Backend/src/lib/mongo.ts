import { MongoClient, Db, ObjectId } from "mongodb";

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectDB(): Promise<Db> {
  if (db) {
    return db;
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI environment variable is not set");
  }

  client = new MongoClient(uri);
  await client.connect();
  db = client.db("gitlore");

  // Create indexes
  await createIndexes(db);

  console.log("Connected to MongoDB");
  return db;
}

async function createIndexes(database: Db) {
  try {
    // Users collection index
    await database
      .collection("users")
      .createIndex({ github_id: 1 }, { unique: true });

    // Comment patterns collection indexes
    await database
      .collection("comment_patterns")
      .createIndex({ trigger_keywords: 1 });

    // Cache collections indexes
    await database.collection("commit_cache").createIndex({ repo: 1, sha: 1 });
    await database
      .collection("explanations_cache")
      .createIndex({ repo: 1, file_path: 1, line: 1 });

    // Knowledge graph collections indexes
    await database
      .collection("knowledge_nodes")
      .createIndex({ repo: 1, pr_number: 1 }, { unique: true });

    // Text search index for chat queries
    await database
      .collection("knowledge_nodes")
      .createIndex(
        {
          title: "text",
          summary: "text",
          problem: "text",
          decision: "text",
          full_narrative: "text",
          topics: "text",
          pr_author: "text",
        },
        { name: "knowledge_text_search" }
      )
      .catch((err) => {
        const msg = err?.message || String(err);
        if (!msg.includes("already exists")) {
          console.warn(
            "knowledge_text_search index:",
            msg,
            "(If keys changed, dropIndex knowledge_text_search in Atlas/Shell and restart.)"
          );
        }
      });

    // Index for sorting by merged_at
    await database
      .collection("knowledge_nodes")
      .createIndex({ repo: 1, merged_at: -1 });

    // Index for type-based filtering
    await database
      .collection("knowledge_nodes")
      .createIndex({ repo: 1, type: 1 });

    // Ingestion progress tracking
    await database
      .collection("knowledge_progress")
      .createIndex({ repo: 1 }, { unique: true });

    console.log("Database indexes created");
  } catch (error) {
    console.error("Error creating indexes:", error);
    throw error;
  }
}

export function getDB(): Db {
  if (!db) {
    throw new Error("Database not connected. Call connectDB() first.");
  }
  return db;
}

export async function disconnectDB(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
    console.log("Disconnected from MongoDB");
  }
}

export { ObjectId };
