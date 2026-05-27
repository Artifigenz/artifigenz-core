import "dotenv/config";
import { db, users, conversations } from "@artifigenz/db";
import { eq, sql } from "drizzle-orm";

(async () => {
  const rows = await db
    .select({
      email: users.email,
      name: users.name,
      count: sql<number>`COUNT(${conversations.id})::int`,
    })
    .from(users)
    .leftJoin(conversations, eq(conversations.userId, users.id))
    .groupBy(users.id, users.email, users.name)
    .orderBy(sql`COUNT(${conversations.id}) DESC`);
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
})();
