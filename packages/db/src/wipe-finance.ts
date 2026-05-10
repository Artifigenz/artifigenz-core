import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = postgres(url, { max: 1 });

const tables = [
  "finance_transactions",
  "finance_accounts",
  "finance_briefs",
  "finance_insights",
  "file_uploads",
  "merchant_clusters",
];

async function main() {
  console.log("Pre-wipe row counts:");
  for (const t of tables) {
    const [{ count }] = await sql.unsafe(`SELECT COUNT(*)::int AS count FROM ${t}`);
    console.log(`  ${t}: ${count}`);
  }

  console.log("\nTruncating finance tables...");
  await sql.unsafe(`TRUNCATE TABLE ${tables.join(", ")} RESTART IDENTITY CASCADE`);

  console.log("Deleting platform insights for finance agents...");
  const delIns = await sql`
    DELETE FROM insights
    WHERE agent_instance_id IN (SELECT id FROM agent_instances WHERE agent_type_id = 'finance')
  `;
  console.log(`  removed ${delIns.count} platform insights`);

  console.log("Deleting data source connections for finance agents...");
  const delConns = await sql`
    DELETE FROM data_source_connections
    WHERE agent_instance_id IN (SELECT id FROM agent_instances WHERE agent_type_id = 'finance')
  `;
  console.log(`  removed ${delConns.count} connections`);

  console.log("Clearing agent_instance_skills state for finance agents...");
  const updSkills = await sql`
    UPDATE agent_instance_skills
    SET state = '{}'::jsonb, last_run_at = NULL
    WHERE agent_instance_id IN (SELECT id FROM agent_instances WHERE agent_type_id = 'finance')
  `;
  console.log(`  reset ${updSkills.count} skill row(s)`);

  console.log("Deleting finance agent_instances...");
  const delInst = await sql`
    DELETE FROM agent_instances WHERE agent_type_id = 'finance'
  `;
  console.log(`  removed ${delInst.count} agent_instance(s)`);

  console.log("\nDone.\n");

  console.log("Post-wipe row counts:");
  for (const t of tables) {
    const [{ count }] = await sql.unsafe(`SELECT COUNT(*)::int AS count FROM ${t}`);
    console.log(`  ${t}: ${count}`);
  }

  await sql.end();
}

main().catch((err) => {
  console.error("Wipe failed:", err);
  process.exit(1);
});
