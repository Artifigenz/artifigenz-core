import postgres from 'postgres';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
config({ path: join(here, '..', 'apps', 'api', '.env') });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}
const sql = postgres(url, { ssl: 'require' });
try {
  const rows = await sql`SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at`;
  console.log('migrations applied:', rows.length);
  for (const r of rows) {
    console.log(' ', r.hash.slice(0, 16), new Date(Number(r.created_at)).toISOString());
  }
} catch (e) {
  console.error('error:', e.message);
}
await sql.end();
