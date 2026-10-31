import type { Pool } from 'pg';
export const APP_TABLES = ['auth_user', 'auth_session', 'auth_account', 'auth_verification', 'profiles', 'challenges', 'memberships', 'daily_activity', 'invitations', 'shortcut_connections', 'request_limits', 'personal_steps', 'legacy_step_archive', 'personal_step_history'] as const;
export function sqlIdentifier(value: string) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value)) throw new Error('Identificador de base o rol no válido.');
  return `"${value}"`;
}
// Run as the migration role (table owner), never as the runtime role.
export async function grantRuntimeAccess(pool: Pool, roleName: string) {
  const role = sqlIdentifier(roleName), client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${APP_TABLES.map(t => `public.${sqlIdentifier(t)}`).join(', ')} TO ${role}`);
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${role}`);
    await client.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC');
    await client.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC');
    await client.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC');
    // The application must never edit migration history or acquire DDL rights.
    await client.query(`REVOKE ALL ON TABLE public.ritmo_migrations FROM ${role}`);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
