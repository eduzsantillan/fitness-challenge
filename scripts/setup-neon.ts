// Explicit operator-only provisioning. Never imported by Vercel or called at application startup.
import { readFile, writeFile, chmod, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
import { readConfig, readMigrationConfig, createPool } from '../backend/src/config.js';
import { migrate } from '../backend/src/migrate.js';
import { grantRuntimeAccess, sqlIdentifier } from '../backend/src/database-access.js';

const database = 'fitness_challenge', appRole = 'fitness_challenge_app', migrationRole = 'fitness_challenge_migrator';
const marker = 'Ritmo fitness-challenge; provisioned by fitness-challenge repository';
let stage = 'arguments';
const clients: pg.Client[] = [];
const pools: pg.Pool[] = [];
const sourceIndex = process.argv.indexOf('--source-env'), source = sourceIndex >= 0 ? process.argv[sourceIndex + 1] : undefined;
const quote = sqlIdentifier;
function connection(base: URL, db: string, user?: string, password?: string) {
  const url = new URL(base); url.pathname = `/${db}`; url.searchParams.set('sslmode', 'verify-full');
  if (user !== undefined) url.username = user; if (password !== undefined) url.password = password;
  return url;
}
async function clientFor(url: URL) {
  const client = new pg.Client({ connectionString: url.toString(), connectionTimeoutMillis: 15000, statement_timeout: 15000, application_name: 'ritmo_neon_setup' });
  clients.push(client); await client.connect(); return client;
}
async function otherDatabaseSnapshot(base: URL, name: string) {
  const client = await clientFor(connection(base, name));
  try {
    await client.query('BEGIN READ ONLY');
    const result = await client.query(`SELECT n.nspname, n.nspacl::text, c.relname, c.relkind, c.relacl::text, a.attname, a.atttypid, a.attnum
      FROM pg_namespace n LEFT JOIN pg_class c ON c.relnamespace=n.oid AND c.relkind IN ('r','v','m','S')
      LEFT JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
      WHERE n.nspname='public' ORDER BY c.relname, a.attnum`);
    await client.query('ROLLBACK');
    return createHash('sha256').update(JSON.stringify(result.rows)).digest('hex');
  } finally { await client.end(); clients.splice(clients.indexOf(client), 1); }
}
try {
  if (!source || !process.argv.includes('--apply')) throw new Error('Use --source-env PATH --apply only after approving the target database.');
  stage = 'read-source';
  const sourceContent = await readFile(source, 'utf8'), sourceDigest = createHash('sha256').update(sourceContent).digest('hex');
  const sourceEnv = parseEnv(sourceContent);
  if (!sourceEnv.DATABASE_URL) throw new Error('Missing source connection.');
  const adminURL = new URL(sourceEnv.DATABASE_URL);
  if (!adminURL.hostname.endsWith('.neon.tech')) throw new Error('Source is not Neon.');
  adminURL.searchParams.set('sslmode', 'verify-full');
  const admin = await clientFor(adminURL);
  const existing = (await admin.query('SELECT datname, shobj_description(oid, \'pg_database\') AS marker FROM pg_database WHERE datname=$1', [database])).rows[0];
  const roles = (await admin.query('SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolreplication FROM pg_roles WHERE rolname=ANY($1::text[])', [[appRole, migrationRole]])).rows;
  const envExisted = existsSync('.env');
  if (!envExisted && (existing || roles.length)) throw new Error('Target names already exist without matching local credentials; refusing to overwrite.');
  if (existing && existing.marker !== marker) throw new Error('Target database is not marked as managed by this repository.');
  for (const role of roles) if (role.rolsuper || role.rolcreatedb || role.rolcreaterole || role.rolbypassrls || role.rolreplication) throw new Error('Existing target role has unexpected elevated permissions.');

  stage = 'baseline';
  const baseline = { noemi: await otherDatabaseSnapshot(adminURL, 'noemi'), calle: await otherDatabaseSnapshot(adminURL, 'calle') };
  let env: NodeJS.ProcessEnv;
  if (envExisted) env = parseEnv(await readFile('.env', 'utf8'));
  else {
    const appURL = connection(adminURL, database, appRole, randomBytes(48).toString('base64url'));
    const migrationURL = connection(adminURL, database, migrationRole, randomBytes(48).toString('base64url'));
    env = { DATABASE_URL: appURL.toString(), MIGRATION_DATABASE_URL: migrationURL.toString(), APP_ORIGIN: 'http://127.0.0.1:5173', BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'), PG_POOL_MAX: '3', PORT: '3001' };
    // Save generated secrets before remote DDL, so a partial operation can be resumed without rotating roles.
    await writeFile('.env', '# Private Ritmo credentials. Do not commit, print, or upload MIGRATION_DATABASE_URL to Vercel.\n' + Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
  }
  await chmod('.env', 0o600);
  const appConfig = readConfig(env), migrationConfig = readMigrationConfig(env);
  const appURL = new URL(appConfig.databaseURL), migrationURL = new URL(migrationConfig.databaseURL);
  if (appURL.hostname !== adminURL.hostname || appURL.pathname !== `/${database}` || decodeURIComponent(appURL.username) !== appRole || decodeURIComponent(migrationURL.username) !== migrationRole) throw new Error('Local target configuration does not match the approved database/roles.');

  stage = 'create-roles';
  for (const [name, url] of [[appRole, appURL], [migrationRole, migrationURL]] as const) {
    if (!roles.some(r => r.rolname === name)) {
      const password = decodeURIComponent(url.password);
      if (!/^[A-Za-z0-9_-]{64}$/.test(password)) throw new Error('Unexpected generated credential format.');
      // Values are generated base64url, not interpolated user input; never log this statement.
      await admin.query(`CREATE ROLE ${quote(name)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);
      console.log(`Rol creado: ${name} (sin privilegios administrativos).`);
    }
    await admin.query(`ALTER ROLE ${quote(name)} SET statement_timeout='15s'`);
    await admin.query(`ALTER ROLE ${quote(name)} SET idle_in_transaction_session_timeout='30s'`);
    await admin.query(`ALTER ROLE ${quote(name)} SET search_path=public`);
  }
  stage = 'create-database';
  if (!existing) {
    await admin.query(`CREATE DATABASE ${quote(database)}`);
    await admin.query(`COMMENT ON DATABASE ${quote(database)} IS '${marker}'`);
    console.log('Base fitness_challenge creada en el entorno Neon existente.');
  }
  await admin.query(`REVOKE ALL ON DATABASE ${quote(database)} FROM PUBLIC`);
  await admin.query(`GRANT CONNECT ON DATABASE ${quote(database)} TO ${quote(appRole)}, ${quote(migrationRole)}`);
  const targetAdmin = await clientFor(connection(adminURL, database));
  if ((await targetAdmin.query('SELECT current_database() AS db')).rows[0]?.db !== database) throw new Error('Wrong target database.');
  await targetAdmin.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
  await targetAdmin.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${quote(migrationRole)}`);
  await targetAdmin.query(`GRANT USAGE ON SCHEMA public TO ${quote(appRole)}`);
  stage = 'migrate';
  const migrationPool = createPool(migrationConfig); pools.push(migrationPool);
  await migrate(migrationPool); await grantRuntimeAccess(migrationPool, appRole);
  const appPool = createPool(appConfig); pools.push(appPool);
  const permissions = (await appPool.query(`SELECT current_database() AS database, has_schema_privilege(current_user,'public','CREATE') AS can_create_tables,
    has_table_privilege(current_user,'auth_user','SELECT,INSERT,UPDATE,DELETE') AS can_use_app,
    has_table_privilege(current_user,'ritmo_migrations','UPDATE') AS can_edit_migrations`)).rows[0];
  if (permissions.can_create_tables || permissions.can_edit_migrations || !permissions.can_use_app) throw new Error('Unexpected runtime privileges.');

  stage = 'verify-other-databases';
  for (const name of ['noemi', 'calle']) {
    const limited = await clientFor(connection(appURL, name));
    await limited.query('BEGIN READ ONLY');
    const grants = await limited.query(`SELECT count(*)::int AS accessible FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','v','m','S') AND has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')`);
    const canCreate = (await limited.query("SELECT has_schema_privilege(current_user,'public','CREATE') AS allowed")).rows[0]?.allowed;
    await limited.query('ROLLBACK');
    if (grants.rows[0]?.accessible || canCreate) throw new Error('The runtime role inherits unexpected public access in another database.');
    await limited.end(); clients.splice(clients.indexOf(limited), 1);
  }
  const unchanged = baseline.noemi === await otherDatabaseSnapshot(adminURL, 'noemi') && baseline.calle === await otherDatabaseSnapshot(adminURL, 'calle');
  if (!unchanged || createHash('sha256').update(await readFile(source, 'utf8')).digest('hex') !== sourceDigest) throw new Error('Source schema/configuration changed during provisioning; review before continuing.');
  console.log(JSON.stringify({ provisioned: true, database, roles: { runtime: appRole, migration: migrationRole }, runtimeCanCreateTables: false, runtimeCanEditMigrations: false, accessToNoemiOrCalleTables: false, otherSchemasUnchanged: true, sourceFileUnchanged: true, privateEnvMode: ((await stat('.env')).mode & 0o777).toString(8) }));
} catch (error) {
  // Do not print SQL, URLs, error messages containing credentials, or the original error object.
  console.error(JSON.stringify({ provisioned: false, stage, code: typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : 'SETUP_CHECK_FAILED', note: 'Se detuvo sin borrar recursos. Las credenciales privadas permiten revisar/reanudar la operación.' })); process.exitCode = 1;
} finally { await Promise.all(pools.map(p => p.end().catch(() => {}))); await Promise.all(clients.map(c => c.end().catch(() => {}))); }
