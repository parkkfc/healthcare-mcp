import { eq, sql } from "drizzle-orm";
import { getDb } from "./db/client.js";
import { trainingDocs } from "./db/schema.js";

export const trainingDocTopics = [
  "daily_kcal",
  "workout_course",
] as const;

export type TrainingDocTopic = (typeof trainingDocTopics)[number];

export type TrainingDocHit = {
  docId: string;
  title: string;
  topic: string;
  heading: string;
  excerpt: string;
  chunkIndex: number;
  r2Key: string;
};

function ftsMatch(query: string): string | null {
  const tokens = query
    .trim()
    .replace(/[^\p{L}\p{N}\s.-]/gu, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .slice(0, 8);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t.replace(/"/g, "")}"`).join(" OR ");
}

export async function listTrainingDocs() {
  const db = await getDb();
  return db
    .select({
      id: trainingDocs.id,
      title: trainingDocs.title,
      topic: trainingDocs.topic,
      summary: trainingDocs.summary,
      r2Key: trainingDocs.r2Key,
      sourceFile: trainingDocs.sourceFile,
      updatedAt: trainingDocs.updatedAt,
    })
    .from(trainingDocs)
    .orderBy(trainingDocs.id);
}

export async function searchTrainingDocs(input: {
  query: string;
  topic?: TrainingDocTopic;
  limit?: number;
}): Promise<TrainingDocHit[]> {
  const db = await getDb();
  const limit = Math.min(Math.max(input.limit ?? 6, 1), 12);
  const match = ftsMatch(input.query);
  const topic = input.topic;

  if (match) {
    try {
      const rows = await db.all<{
        docId: string;
        title: string;
        topic: string;
        heading: string;
        body: string;
        chunkIndex: number;
        r2Key: string;
      }>(sql`
        SELECT
          d.id AS docId,
          d.title AS title,
          d.topic AS topic,
          c.heading AS heading,
          c.body AS body,
          c.chunk_index AS chunkIndex,
          d.r2_key AS r2Key
        FROM training_doc_chunks_fts
        JOIN training_doc_chunks c ON c.id = training_doc_chunks_fts.rowid
        JOIN training_docs d ON d.id = c.doc_id
        WHERE training_doc_chunks_fts MATCH ${match}
          ${topic ? sql`AND d.topic = ${topic}` : sql``}
        ORDER BY bm25(training_doc_chunks_fts)
        LIMIT ${limit}
      `);
      if (rows.length > 0) {
        return rows.map((row) => ({
          docId: row.docId,
          title: row.title,
          topic: row.topic,
          heading: row.heading || "",
          excerpt: row.body.slice(0, 1200),
          chunkIndex: row.chunkIndex,
          r2Key: row.r2Key,
        }));
      }
    } catch {
      // Fall through to LIKE search when FTS query is invalid.
    }
  }

  const like = `%${input.query.trim().slice(0, 80)}%`;
  const rows = await db.all<{
    docId: string;
    title: string;
    topic: string;
    heading: string;
    body: string;
    chunkIndex: number;
    r2Key: string;
  }>(sql`
    SELECT
      d.id AS docId,
      d.title AS title,
      d.topic AS topic,
      c.heading AS heading,
      c.body AS body,
      c.chunk_index AS chunkIndex,
      d.r2_key AS r2Key
    FROM training_doc_chunks c
    JOIN training_docs d ON d.id = c.doc_id
    WHERE (c.body LIKE ${like} OR c.heading LIKE ${like} OR d.title LIKE ${like})
      ${topic ? sql`AND d.topic = ${topic}` : sql``}
    ORDER BY c.doc_id, c.chunk_index
    LIMIT ${limit}
  `);

  return rows.map((row) => ({
    docId: row.docId,
    title: row.title,
    topic: row.topic,
    heading: row.heading || "",
    excerpt: row.body.slice(0, 1200),
    chunkIndex: row.chunkIndex,
    r2Key: row.r2Key,
  }));
}

export async function getTrainingDocChunks(docId: string, limit = 20) {
  const db = await getDb();
  const docs = await db
    .select()
    .from(trainingDocs)
    .where(eq(trainingDocs.id, docId))
    .limit(1);
  const doc = docs[0];
  if (!doc) return null;

  const chunks = await db.all<{
    chunkIndex: number;
    heading: string;
    body: string;
  }>(sql`
    SELECT chunk_index AS chunkIndex, heading, body
    FROM training_doc_chunks
    WHERE doc_id = ${docId}
    ORDER BY chunk_index
    LIMIT ${Math.min(Math.max(limit, 1), 40)}
  `);

  return { doc, chunks };
}
