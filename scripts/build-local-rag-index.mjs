import 'dotenv/config';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import OpenAI from 'openai';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const DEFAULT_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
const DEFAULT_DIMENSIONS = Number(process.env.OPENAI_EMBEDDING_DIMENSIONS || 768);
const CHUNK_CHARACTERS = 4200;
const CHUNK_OVERLAP = 600;
const EMBEDDING_BATCH_SIZE = 32;

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) continue;
    const key = argument.slice(2);
    const next = argv[index + 1];
    values[key] = next && !next.startsWith('--') ? argv[++index] : true;
  }
  if (!values.input || !values.output) {
    throw new Error('Usage: npm run rag:index -- --input <PDF directory> --output <index.sqlite>');
  }
  return values;
}

function normalizePageText(items) {
  let text = '';
  for (const item of items) {
    const value = String(item.str || '').trim();
    if (!value) continue;
    text += value;
    text += item.hasEOL ? '\n' : ' ';
  }
  return text
    .replace(/-\s*\n\s*(?=[a-z])/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function chooseChunkEnd(text, start) {
  const hardEnd = Math.min(text.length, start + CHUNK_CHARACTERS);
  if (hardEnd === text.length) return hardEnd;
  const floor = start + Math.floor(CHUNK_CHARACTERS * 0.62);
  const candidates = [
    text.lastIndexOf('\n\n', hardEnd),
    text.lastIndexOf('. ', hardEnd),
    text.lastIndexOf('; ', hardEnd),
    text.lastIndexOf(' ', hardEnd),
  ].filter((position) => position >= floor);
  return candidates.length ? Math.max(...candidates) + 1 : hardEnd;
}

function chunkPage(text) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = chooseChunkEnd(text, start);
    const chunk = text.slice(start, end).trim();
    if (chunk.length >= 80) chunks.push(chunk);
    if (end >= text.length) break;
    start = Math.max(start + 1, end - CHUNK_OVERLAP);
    while (start < end && /\S/.test(text[start - 1] || '') && /\S/.test(text[start] || '')) start += 1;
  }
  return chunks;
}

function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function vectorBlob(vector) {
  return Buffer.from(Float32Array.from(vector).buffer);
}

function vectorNorm(vector) {
  let sum = 0;
  for (const value of vector) sum += value * value;
  return Math.sqrt(sum);
}

function configureDatabase(database, metadata) {
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE documents (
      id INTEGER PRIMARY KEY,
      path TEXT NOT NULL,
      name TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      modified_at TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      page_count INTEGER NOT NULL,
      chunk_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE chunks (
      id INTEGER PRIMARY KEY,
      document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      page_number INTEGER NOT NULL,
      chunk_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      embedding BLOB,
      embedding_norm REAL
    );
    CREATE INDEX chunks_document_page ON chunks(document_id, page_number);
  `);
  const insert = database.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(metadata)) insert.run(key, String(value));
}

async function extractPdf(database, filePath, fileNumber, fileTotal) {
  const stats = statSync(filePath);
  const digest = await sha256(filePath);
  const loadingTask = getDocument({ url: pathToFileURL(filePath).href, useSystemFonts: true });
  const pdf = await loadingTask.promise;
  const documentResult = database.prepare(`
    INSERT INTO documents (path, name, bytes, modified_at, sha256, page_count)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(filePath, path.basename(filePath), stats.size, stats.mtime.toISOString(), digest, pdf.numPages);
  const documentId = Number(documentResult.lastInsertRowid);
  const insertChunk = database.prepare(`
    INSERT INTO chunks (document_id, page_number, chunk_index, text)
    VALUES (?, ?, ?, ?)
  `);
  let chunkCount = 0;
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = normalizePageText(content.items);
    for (const [chunkIndex, chunk] of chunkPage(text).entries()) {
      insertChunk.run(documentId, pageNumber, chunkIndex + 1, chunk);
      chunkCount += 1;
    }
    page.cleanup();
    if (pageNumber % 20 === 0 || pageNumber === pdf.numPages) {
      console.log(JSON.stringify({ phase: 'extract', file: path.basename(filePath), fileNumber, fileTotal, pageNumber, pages: pdf.numPages, chunkCount }));
    }
  }
  database.prepare('UPDATE documents SET chunk_count = ? WHERE id = ?').run(chunkCount, documentId);
  await loadingTask.destroy();
  return { name: path.basename(filePath), pages: pdf.numPages, chunks: chunkCount, sha256: digest };
}

async function embedChunks(database, client, model, dimensions) {
  const pending = database.prepare(`
    SELECT chunks.id, chunks.text, chunks.page_number AS pageNumber, documents.name AS documentName
    FROM chunks JOIN documents ON documents.id = chunks.document_id
    WHERE chunks.embedding IS NULL ORDER BY chunks.id LIMIT ?
  `);
  const update = database.prepare('UPDATE chunks SET embedding = ?, embedding_norm = ? WHERE id = ?');
  const total = Number(database.prepare('SELECT COUNT(*) AS count FROM chunks').get().count);
  let completed = total - Number(database.prepare('SELECT COUNT(*) AS count FROM chunks WHERE embedding IS NULL').get().count);
  while (completed < total) {
    const rows = pending.all(EMBEDDING_BATCH_SIZE);
    const response = await client.embeddings.create({
      model,
      dimensions,
      encoding_format: 'float',
      input: rows.map((row) => `Document: ${row.documentName}\nPage: ${row.pageNumber}\n${row.text}`),
    });
    database.exec('BEGIN');
    try {
      for (const [index, row] of rows.entries()) {
        const vector = response.data[index].embedding;
        update.run(vectorBlob(vector), vectorNorm(vector), row.id);
      }
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
    completed += rows.length;
    console.log(JSON.stringify({ phase: 'embed', completed, total, percent: Number(((completed / total) * 100).toFixed(1)) }));
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required to build embeddings.');
  const inputPath = path.resolve(options.input);
  const outputPath = path.resolve(options.output);
  const partialPath = `${outputPath}.partial`;
  const model = String(options.model || DEFAULT_MODEL);
  const dimensions = Math.max(256, Math.min(Number(options.dimensions) || DEFAULT_DIMENSIONS, 1536));
  const entries = await readdir(inputPath, { withFileTypes: true });
  const pdfFiles = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.pdf'))
    .map((entry) => path.join(inputPath, entry.name))
    .sort((left, right) => left.localeCompare(right));
  if (!pdfFiles.length) throw new Error('No PDF files were found in the input directory.');
  mkdirSync(path.dirname(outputPath), { recursive: true });
  if (existsSync(outputPath) && !options.rebuild) throw new Error('Output index already exists. Pass --rebuild to replace it.');
  if (existsSync(outputPath)) rmSync(outputPath, { force: true });
  if (existsSync(partialPath)) rmSync(partialPath, { force: true });
  const database = new DatabaseSync(partialPath);
  const startedAt = new Date().toISOString();
  try {
    configureDatabase(database, {
      format: 'synapse-flow/local-rag-v1',
      status: 'indexing',
      name: options.name || path.basename(outputPath, path.extname(outputPath)),
      created_at: startedAt,
      embedding_model: model,
      embedding_dimensions: dimensions,
      chunk_characters: CHUNK_CHARACTERS,
      chunk_overlap: CHUNK_OVERLAP,
    });
    const documents = [];
    for (const [index, filePath] of pdfFiles.entries()) {
      documents.push(await extractPdf(database, filePath, index + 1, pdfFiles.length));
    }
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    await embedChunks(database, client, model, dimensions);
    const completedAt = new Date().toISOString();
    database.prepare("UPDATE metadata SET value = 'ready' WHERE key = 'status'").run();
    database.prepare("INSERT INTO metadata (key, value) VALUES ('completed_at', ?)").run(completedAt);
    database.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    database.exec('PRAGMA journal_mode = DELETE;');
    database.close();
    renameSync(partialPath, outputPath);
    const manifest = {
      format: 'synapse-flow/local-rag-manifest-v1',
      name: options.name || path.basename(outputPath, path.extname(outputPath)),
      indexFile: path.basename(outputPath),
      createdAt: startedAt,
      completedAt,
      embeddingModel: model,
      embeddingDimensions: dimensions,
      chunkCharacters: CHUNK_CHARACTERS,
      chunkOverlap: CHUNK_OVERLAP,
      documents,
      totalPages: documents.reduce((sum, document) => sum + document.pages, 0),
      totalChunks: documents.reduce((sum, document) => sum + document.chunks, 0),
    };
    const manifestPath = outputPath.replace(/\.sqlite$/i, '.manifest.json');
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ phase: 'complete', outputPath, manifestPath, ...manifest }));
  } catch (error) {
    try { database.close(); } catch {}
    throw error;
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
