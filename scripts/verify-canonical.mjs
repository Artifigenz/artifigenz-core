import postgres from 'postgres';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
config({ path: join(here, '..', 'apps', 'api', '.env') });

const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' });
try {
  const cols = await sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'finance_transactions'
      AND column_name IN (
        'user_id', 'institution_id', 'source_transaction_id',
        'posted_date', 'authorized_date', 'direction',
        'normalized_description', 'account_type', 'account_mask',
        'currency', 'confidence', 'categorization_source',
        'reasoning', 'needs_review'
      )
    ORDER BY column_name
  `;
  console.log('New canonical columns present:', cols.length);
  for (const c of cols) console.log(' ', c.column_name, '·', c.data_type);

  const counts = await sql`
    SELECT
      COUNT(*) AS total,
      COUNT(user_id) AS with_user_id,
      COUNT(direction) AS with_direction,
      COUNT(account_type) AS with_account_type,
      COUNT(normalized_description) AS with_norm_desc,
      COUNT(*) FILTER (WHERE source = 'statement') AS source_statement,
      COUNT(*) FILTER (WHERE source = 'plaid') AS source_plaid,
      COUNT(*) FILTER (WHERE source = 'upload') AS source_upload_remaining
    FROM finance_transactions
  `;
  console.log('\nBackfill check:');
  console.table(counts);
} catch (e) {
  console.error('error:', e.message);
}
await sql.end();
