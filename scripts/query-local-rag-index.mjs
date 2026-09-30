import 'dotenv/config';
import path from 'node:path';
import OpenAI from 'openai';
import { inspectLocalRagIndex, searchLocalRagIndex } from '../server/localRag.js';

const [indexArgument, ...queryParts] = process.argv.slice(2);
const query = queryParts.join(' ').trim();
if (!indexArgument || !query) {
  console.error('Usage: npm run rag:query -- <index.sqlite> <query>');
  process.exit(1);
}
if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required.');
const indexPath = path.resolve(indexArgument);
const inspection = inspectLocalRagIndex(indexPath);
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const response = await client.embeddings.create({
  model: inspection.metadata.embedding_model,
  dimensions: Number(inspection.metadata.embedding_dimensions),
  encoding_format: 'float',
  input: query,
});
const result = searchLocalRagIndex({
  indexPath,
  queryEmbedding: response.data[0].embedding,
  limit: 5,
});
console.log(JSON.stringify({ query, index: inspection.metadata.name, results: result.results }, null, 2));
