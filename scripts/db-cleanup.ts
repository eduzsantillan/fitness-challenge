import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { createPool, readConfig } from '../backend/src/config.js';
if (existsSync('.env')) loadEnvFile('.env');
const pool = createPool(readConfig());
try {
  await pool.query(`DELETE FROM auth_session WHERE "expiresAt" < now(); DELETE FROM auth_verification WHERE "expiresAt" < now();
    DELETE FROM invitations WHERE expires_at < extract(epoch FROM now()); DELETE FROM shortcut_connections WHERE expires_at < extract(epoch FROM now());
    DELETE FROM request_limits WHERE window_start < extract(epoch FROM now())*1000 - 86400000;`);
  console.log('Registros caducados eliminados; no se borró actividad vigente.');
} finally { await pool.end(); }
