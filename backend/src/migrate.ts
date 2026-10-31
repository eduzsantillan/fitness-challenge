import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
export async function migrate(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Transaction-scoped locking also works through Neon's pooled connection.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('ritmo:migrations', 0))");
    await client.query('CREATE TABLE IF NOT EXISTS ritmo_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const directory = new URL('../../db/', import.meta.url);
    for (const file of (await readdir(directory)).filter(f => /^\d+.*\.sql$/.test(f)).sort()) {
      const sql = await readFile(new URL(file, directory), 'utf8'), checksum = createHash('sha256').update(sql).digest('hex');
      const previous = (await client.query<{ checksum: string }>('SELECT checksum FROM ritmo_migrations WHERE name=$1', [file])).rows[0];
      if (previous) { if (previous.checksum !== checksum) throw new Error(`La migración ${file} cambió después de aplicarse.`); continue; }
      await client.query(sql); await client.query('INSERT INTO ritmo_migrations(name,checksum) VALUES ($1,$2)', [file, checksum]);
      console.log(`Migración aplicada: ${file}`);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
