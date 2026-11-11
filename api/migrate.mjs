// Creates or updates the tables from api/schema.sql on the linked Neon branch.
// Run: node api/migrate.mjs   (reads DATABASE_URL_UNPOOLED from .env.local, which `neon link` wrote)
import { readFileSync } from 'node:fs';
import pg from 'pg';

process.loadEnvFile(new URL('../.env.local', import.meta.url));
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) throw new Error('No DATABASE_URL in .env.local. Run `neon link` first.');

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const { rows } = await client.query(
    "select table_name from information_schema.tables where table_schema = 'public' order by 1");
  console.log('Tables:', rows.map((r) => r.table_name).join(', '));
} finally {
  await client.end();
}
