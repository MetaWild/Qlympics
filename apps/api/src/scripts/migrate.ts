import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { config } from '../config.js';

function resolveMigrationsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // Runtime image layout:
  // - script: /app/dist/scripts/migrate.js
  // - migrations: /app/db/migrations
  return path.resolve(here, '..', '..', 'db', 'migrations');
}

async function main() {
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: Math.max(1, config.databasePoolMax),
    idleTimeoutMillis: config.databasePoolIdleTimeoutMs,
    connectionTimeoutMillis: config.databasePoolConnectionTimeoutMs
  });

  const migrationsDir = resolveMigrationsDir();
  const files = (await fs.readdir(migrationsDir))
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));

  if (!files.length) {
    throw new Error(`No migrations found in ${migrationsDir}`);
  }

  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    for (const file of files) {
      const already = await client.query<{ exists: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = $1) AS exists`,
        [file]
      );
      if (already.rows[0]?.exists) {
        // eslint-disable-next-line no-console
        console.log(`Skipping ${file} (already applied)`);
        continue;
      }

      const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
      // eslint-disable-next-line no-console
      console.log(`Applying ${file}`);
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations(version) VALUES($1)`, [file]);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Migration failed:', error);
  process.exit(1);
});
