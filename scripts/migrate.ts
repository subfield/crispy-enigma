/**
 * Applies the SQL files in ./drizzle in filename order.
 *
 * Scoped to smink_* only. Never run drizzle-kit generate against this schema.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env" });

const connectionString =
  process.env.CONNECTION_MODE === "local"
    ? process.env.DATABASE_URL_LOCAL
    : process.env.DATABASE_URL_NEON;

if (!connectionString) {
  console.error("No database URL found. Set DATABASE_URL_LOCAL or DATABASE_URL_NEON in .env");
  process.exit(1);
}

const sql = postgres(connectionString, { max: 1 });

async function main() {
  const dir = join(process.cwd(), "drizzle");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    process.stdout.write(`Applying ${file} … `);
    await sql.unsafe(await readFile(join(dir, file), "utf8"));
    console.log("ok");
  }

  await sql.end();
}

main().catch(async (error) => {
  console.error(error);
  await sql.end();
  process.exit(1);
});
