import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { createPool, readMigrationConfig } from '../backend/src/config.js';
import { grantRuntimeAccess } from '../backend/src/database-access.js';
import { migrate } from '../backend/src/migrate.js';
if (existsSync('.env')) loadEnvFile('.env');
const pool = createPool(readMigrationConfig());
try {
  await migrate(pool);
  if (process.env.MIGRATION_DATABASE_URL && process.env.DATABASE_URL) {
    const runtimeRole = decodeURIComponent(new URL(process.env.DATABASE_URL).username);
    const migrationRole = decodeURIComponent(new URL(process.env.MIGRATION_DATABASE_URL).username);
    if (runtimeRole !== migrationRole) await grantRuntimeAccess(pool, runtimeRole);
  }
  console.log('Base de Ritmo preparada.');
}
catch { console.error('No se pudo migrar. Revisa conexión, permisos y que sea una base dedicada; no se imprimen credenciales.'); process.exitCode = 1; }
finally { await pool.end(); }
