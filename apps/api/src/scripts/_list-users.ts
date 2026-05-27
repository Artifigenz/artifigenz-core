import "dotenv/config";
import { db, users } from "@artifigenz/db";

(async () => {
  const r = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users);
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
})();
