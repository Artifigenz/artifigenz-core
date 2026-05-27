/**
 * One-shot wipe of every conversation (and via FK-cascade, every message)
 * for a user identified by email.
 *
 *   tsx src/scripts/wipe-conversations.ts <email>
 */
import "dotenv/config";
import { db, users, conversations } from "@artifigenz/db";
import { eq } from "drizzle-orm";

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("Usage: tsx src/scripts/wipe-conversations.ts <email>");
    process.exit(1);
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!user) {
    console.error(`No user found with email: ${email}`);
    process.exit(1);
  }

  const removed = await db
    .delete(conversations)
    .where(eq(conversations.userId, user.id))
    .returning({ id: conversations.id });

  console.log(
    `✓ Wiped ${removed.length} conversation${removed.length === 1 ? "" : "s"} for ${user.email} (${user.id})`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
