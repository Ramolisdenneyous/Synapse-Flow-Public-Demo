import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MAX_INDEX_BYTES = 4 * 1024 * 1024 * 1024;

function vectorFromBlob(blob) {
  const bytes = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

function cosineSimilarity(left, right, leftNorm, rightNorm) {
  if (left.length !== right.length || !leftNorm || !rightNorm) return 0;
  let dot = 0;
  for (let index = 0; index < left.length; index += 1) dot += left[index] * right[index];
  return dot / (leftNorm * rightNorm);
}

function vectorNorm(vector) {
  let sum = 0;
  for (const value of vector) sum += value * value;
  return Math.sqrt(sum);
}

export function inspectLocalRagIndex(indexPath) {
  const resolvedPath = path.resolve(String(indexPath || ''));
  if (!indexPath || !existsSync(resolvedPath)) {
    throw new Error('Local RAG index file was not found.');
  }
  const stats = statSync(resolvedPath);
  if (!stats.isFile()) throw new Error('Local RAG index path must point to a file.');
  if (stats.size > MAX_INDEX_BYTES) throw new Error('Local RAG index exceeds the 4 GB safety limit.');
  const database = new DatabaseSync(resolvedPath, { readOnly: true });
  try {
    const metadata = Object.fromEntries(
      database.prepare('SELECT key, value FROM metadata').all().map((row) => [row.key, row.value]),
    );
    if (metadata.format !== 'synapse-flow/local-rag-v1' || metadata.status !== 'ready') {
      throw new Error('Local RAG index is incomplete or uses an unsupported format.');
    }
    return {
      path: resolvedPath,
      bytes: stats.size,
      metadata,
      documents: database.prepare(
        'SELECT name, page_count AS pageCount, chunk_count AS chunkCount, sha256 FROM documents ORDER BY name',
      ).all(),
      chunkCount: Number(database.prepare('SELECT COUNT(*) AS count FROM chunks').get().count),
    };
  } finally {
    database.close();
  }
}

export function searchLocalRagIndex({ indexPath, queryEmbedding, limit = 5 }) {
  const inspection = inspectLocalRagIndex(indexPath);
  const queryVector = Float32Array.from(queryEmbedding || []);
  const expectedDimensions = Number(inspection.metadata.embedding_dimensions);
  if (!queryVector.length || queryVector.length !== expectedDimensions) {
    throw new Error(`Local RAG query embedding must contain ${expectedDimensions} dimensions.`);
  }
  const queryNorm = vectorNorm(queryVector);
  const resultLimit = Math.max(1, Math.min(Number(limit) || 5, 10));
  const database = new DatabaseSync(inspection.path, { readOnly: true });
  try {
    const rows = database.prepare(`
      SELECT
        chunks.id,
        chunks.page_number AS pageNumber,
        chunks.chunk_index AS chunkIndex,
        chunks.text,
        chunks.embedding,
        chunks.embedding_norm AS embeddingNorm,
        documents.name AS documentName
      FROM chunks
      JOIN documents ON documents.id = chunks.document_id
      WHERE chunks.embedding IS NOT NULL
    `).iterate();
    const best = [];
    for (const row of rows) {
      const score = cosineSimilarity(
        queryVector,
        vectorFromBlob(row.embedding),
        queryNorm,
        Number(row.embeddingNorm),
      );
      const result = {
        title: `${row.documentName} - page ${row.pageNumber}`,
        document: row.documentName,
        page: row.pageNumber,
        chunk: row.chunkIndex,
        score: Number(score.toFixed(6)),
        snippet: row.text,
      };
      if (best.length < resultLimit) {
        best.push(result);
        best.sort((left, right) => right.score - left.score);
      } else if (score > best[best.length - 1].score) {
        best[best.length - 1] = result;
        best.sort((left, right) => right.score - left.score);
      }
    }
    return { inspection, results: best };
  } finally {
    database.close();
  }
}
