import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspectLocalRagIndex, searchLocalRagIndex } from '../server/localRag.js';
import { runSearch } from '../server/searchProviders.js';

const temporaryDirectories = [];

function vectorBlob(values) {
  return Buffer.from(Float32Array.from(values).buffer);
}

function createIndex() {
  const directory = mkdtempSync(path.join(tmpdir(), 'synapse-rag-'));
  temporaryDirectories.push(directory);
  const indexPath = path.join(directory, 'test.sqlite');
  const database = new DatabaseSync(indexPath);
  database.exec(`
    CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE documents (
      id INTEGER PRIMARY KEY, path TEXT, name TEXT, bytes INTEGER,
      modified_at TEXT, sha256 TEXT, page_count INTEGER, chunk_count INTEGER
    );
    CREATE TABLE chunks (
      id INTEGER PRIMARY KEY, document_id INTEGER, page_number INTEGER,
      chunk_index INTEGER, text TEXT, embedding BLOB, embedding_norm REAL
    );
  `);
  const metadata = database.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries({
    format: 'synapse-flow/local-rag-v1',
    status: 'ready',
    name: 'Test Rules',
    embedding_model: 'test-embedding',
    embedding_dimensions: '2',
  })) metadata.run(key, value);
  database.prepare(`
    INSERT INTO documents (id, path, name, bytes, modified_at, sha256, page_count, chunk_count)
    VALUES (1, 'rules.pdf', 'rules.pdf', 100, 'now', 'abc', 2, 2)
  `).run();
  const insert = database.prepare(`
    INSERT INTO chunks (document_id, page_number, chunk_index, text, embedding, embedding_norm)
    VALUES (1, ?, 1, ?, ?, 1)
  `);
  insert.run(1, 'Correspondence permits perception across distance.', vectorBlob([1, 0]));
  insert.run(2, 'Forces describes physical energy.', vectorBlob([0, 1]));
  database.close();
  return indexPath;
}

afterEach(() => {
  while (temporaryDirectories.length) rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
});

describe('Local RAG', () => {
  it('inspects and retrieves the nearest local chunk', () => {
    const indexPath = createIndex();

    expect(inspectLocalRagIndex(indexPath).chunkCount).toBe(2);
    const result = searchLocalRagIndex({ indexPath, queryEmbedding: [1, 0], limit: 1 });

    expect(result.results[0]).toMatchObject({ document: 'rules.pdf', page: 1, score: 1 });
  });

  it('uses the index embedding contract for raw Search-node retrieval', async () => {
    const indexPath = createIndex();
    const createEmbedding = vi.fn().mockResolvedValue({ data: [{ embedding: [1, 0] }] });

    const result = await runSearch({
      provider: 'localrag',
      searchMode: 'raw',
      localIndexPath: indexPath,
      query: 'How can a mage perceive at a distance?',
      limit: 1,
    }, {
      client: { embeddings: { create: createEmbedding } },
    });

    expect(createEmbedding).toHaveBeenCalledWith(expect.objectContaining({
      model: 'test-embedding',
      dimensions: 2,
    }));
    expect(result.provider).toBe('Local RAG');
    expect(result.results[0].page).toBe(1);
  });
});
