/**
 * One-off: the drizzle __drizzle_migrations tracker is empty, but the DB
 * actually has all tables 0000–0008 applied (someone ran db push instead of
 * migrate). Backfill the tracker with hashes for 0000–0008, then run 0009
 * (canonical transaction model) for real.
 */
import postgres from 'postgres';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
config({ path: join(here, '..', 'apps', 'api', '.env') });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const migrationsDir = join(here, '..', 'packages', 'db', 'src', 'migrations');
const files = (await readdir(migrationsDir))
  .filter((f) => f.endsWith('.sql'))
  .sort();

const sql = postgres(url, { ssl: 'require' });

try {
  // 1. Ensure the drizzle schema + migrations table exist.
  await sql`CREATE SCHEMA IF NOT EXISTS drizzle`;
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  const existing = await sql`SELECT hash FROM drizzle.__drizzle_migrations`;
  const seen = new Set(existing.map((r) => r.hash));

  let backfilled = 0;
  let applied = 0;

  for (const file of files) {
    const path = join(migrationsDir, file);
    const content = await readFile(path, 'utf8');
    const hash = createHash('sha256').update(content).digest('hex');

    if (seen.has(hash)) {
      console.log(`✓ ${file} already tracked`);
      continue;
    }

    // 0000–0008: backfill the tracker only (assume schema already in DB).
    // 0009: actually execute, then track.
    const isFinal = file.startsWith('0009');
    if (!isFinal) {
      await sql`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${hash}, ${Date.now()})`;
      backfilled++;
      console.log(`↩ ${file} backfilled (not executed)`);
    } else {
      console.log(`▶ ${file} executing…`);
      // drizzle-kit splits on --> statement-breakpoint
      const statements = content
        .split('--> statement-breakpoint')
        .map((s) => s.trim())
        .filter(Boolean);
      for (const stmt of statements) {
        try {
          await sql.unsafe(stmt);
        } catch (err) {
          // Idempotent re-run tolerance: column / constraint may already exist
          // if a prior attempt got partway through. Log and continue.
          if (
            err.code === '42701' || // duplicate_column
            err.code === '42710' || // duplicate_object (constraint)
            err.code === '42P07'    // duplicate_table
          ) {
            console.log(`  ⚠ skipping (${err.code}): ${err.message}`);
            continue;
          }
          throw err;
        }
      }
      await sql`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${hash}, ${Date.now()})`;
      applied++;
      console.log(`✓ ${file} applied`);
    }
  }

  console.log(`\nBackfilled: ${backfilled}, applied: ${applied}`);
} catch (e) {
  console.error('error:', e.message);
  process.exit(1);
}
await sql.end();
