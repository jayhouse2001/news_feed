// Node entry point for the collector: runs the shared logic and writes the
// result to site/data/news.json. The collection itself lives in
// shared/collect-news.js so the Cloudflare Worker can run the same code.

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectNews } from '../shared/collect-news.js';

async function main() {
  const { data, okCount, total } = await collectNews();
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const outDir = path.join(root, 'site', 'data');
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'news.json'), JSON.stringify(data, null, 1), 'utf8');
  console.log(`done: ${okCount}/${total} categories`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
