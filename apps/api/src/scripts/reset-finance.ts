import "dotenv/config";
import { db, users, agentInstances } from "@artifigenz/db";
import { eq } from "drizzle-orm";

async function main() {
  const allUsers = await db.select().from(users);
  for (const u of allUsers) {
    const instances = await db
      .select()
      .from(agentInstances)
      .where(eq(agentInstances.userId, u.id));
    console.log(`User: ${u.name} (${u.email}) → ${instances.length} agents`);
    for (const inst of instances) {
      if (inst.agentTypeId === "finance") {
        await db.delete(agentInstances).where(eq(agentInstances.id, inst.id));
        console.log(`  ✓ Deleted finance agent instance ${inst.id}`);
      } else {
        console.log(`  - ${inst.agentTypeId} ${inst.status}`);
      }
    }
  }
  console.log("\nDone. Finance agent instances cleared.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
