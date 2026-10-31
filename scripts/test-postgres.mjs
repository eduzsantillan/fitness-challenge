// A disposable cluster, never DATABASE_URL from a user's .env or an existing Neon database.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
const directory = mkdtempSync('/tmp/ritmo-pg-'), data = `${directory}/data`;
const binary = name => process.env.PG_BIN ? `${process.env.PG_BIN}/${name}` : name;
let started = false;
let activeChild, interrupted = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { interrupted = true; activeChild?.kill(signal); });
async function run(args, env) {
  await new Promise((resolve, reject) => { const child = spawn(process.execPath, args, { env, stdio: 'inherit' }); activeChild = child; child.once('error', reject); child.once('exit', code => { activeChild = undefined; code === 0 || interrupted ? resolve() : reject(new Error(`Check exited with ${code}`)); }); });
}
try {
  const port = await new Promise(resolve => { const server = createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); });
  execFileSync(binary('initdb'), ['-D', data, '-U', 'ritmo_test', '--auth=trust', '--no-locale', '--encoding=UTF8'], { stdio: 'pipe' });
  execFileSync(binary('pg_ctl'), ['-D', data, '-l', `${directory}/postgres.log`, '-o', `-F -h 127.0.0.1 -p ${port} -k ${directory}`, '-w', 'start'], { stdio: 'pipe' }); started = true;
  const env = { ...process.env, DATABASE_URL: `postgresql://ritmo_test@127.0.0.1:${port}/postgres`, APP_ORIGIN: 'http://127.0.0.1:5173', BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'), PG_POOL_MAX: '5' };
  // Never inherit a privileged remote migration URL from the user's environment.
  env.MIGRATION_DATABASE_URL = ''; // Keep .env loading from reintroducing the real migration credential.
  env.TEST_DATABASE_URL = env.DATABASE_URL;
  await run(['--import', 'tsx', 'scripts/db-migrate.ts'], env);
  if (process.argv.includes('--preview')) {
    console.log('Vista de prueba con base temporal: los datos se eliminan al detenerla. No es Neon ni producción.');
    await run(['scripts/dev.mjs'], env);
  } else {
    if (!process.argv.includes('--http-only')) await run(['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.integration.config.ts'], env);
    await run(['scripts/smoke-api.mjs'], env);
  }
} catch (error) { console.error('PostgreSQL checks failed. Requires local initdb/pg_ctl (or PG_BIN).', error.message); process.exitCode = 1; }
finally { if (started) execFileSync(binary('pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' }); rmSync(directory, { recursive: true, force: true }); }
