import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

/**
 * Applies db/migrations/*.sql (not *.down.sql) in lexical order, each in its own
 * transaction, recording filenames in schema_migrations. Idempotent.
 * Usage: DATABASE_URL=... tsx db/migrate.ts [up|down]
 */
export async function runMigrations(databaseUrl: string, direction: "up" | "down" = "up"): Promise<string[]> {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "migrations");
  const client = new pg.Client({ connectionString: databaseUrl });
  const applied: string[] = [];
  await client.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    if (direction === "up") {
      const files = readdirSync(dir).filter((f) => f.endsWith(".sql") && !f.endsWith(".down.sql")).sort();
      for (const file of files) {
        const done = await client.query("SELECT 1 FROM schema_migrations WHERE name = $1", [file]);
        if (done.rowCount) continue;
        const sql = readFileSync(join(dir, file), "utf8");
        await client.query("BEGIN");
        try {
          await client.query(sql);
          await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
          await client.query("COMMIT");
          applied.push(file);
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        }
      }
    } else {
      const down = readdirSync(dir).filter((f) => f.endsWith(".down.sql")).sort().reverse();
      for (const file of down) {
        const base = file.replace(".down.sql", ".sql");
        const done = await client.query("SELECT 1 FROM schema_migrations WHERE name = $1", [base]);
        if (!done.rowCount) continue;
        const sql = readFileSync(join(dir, file), "utf8");
        await client.query("BEGIN");
        try {
          await client.query(sql);
          await client.query("DELETE FROM schema_migrations WHERE name = $1", [base]);
          await client.query("COMMIT");
          applied.push(`down:${base}`);
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        }
      }
    }
  } finally {
    await client.end();
  }
  return applied;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const direction = process.argv[2] === "down" ? "down" : "up";
  runMigrations(url, direction)
    .then((files) => console.log(JSON.stringify({ direction, files })))
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : "migration failed");
      process.exit(1);
    });
}
