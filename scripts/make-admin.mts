/**
 * Grant (or revoke) admin rights for an existing account.
 *   npm run user:make-admin -- you@example.com
 *   npm run user:make-admin -- you@example.com --revoke
 */
import { adminClient } from "./lib.mts";

const email = process.argv[2]?.toLowerCase();
if (!email || !email.includes("@")) {
  console.error("Usage: npm run user:make-admin -- <email> [--revoke]");
  process.exit(1);
}
const db = adminClient();
let found: { id: string } | undefined;
for (let page = 1; !found; page++) {
  const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
  if (error) throw error;
  found = data.users.find((u) => u.email?.toLowerCase() === email);
  if (data.users.length < 200) break;
}
if (!found) {
  console.error(`No account for ${email}. Sign up first.`);
  process.exit(1);
}
const isAdmin = !process.argv.includes("--revoke");
const { error } = await db.from("profiles").update({ is_admin: isAdmin }).eq("id", found.id);
if (error) throw error;
console.log(`${email} is ${isAdmin ? "now" : "no longer"} an admin.`);
