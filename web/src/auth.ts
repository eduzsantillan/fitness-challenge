type User = { id: string; name: string; email: string };
let currentUser: User | undefined;
export let configured = false;
export const endpoint = `${window.location.origin}/api/shortcuts`;
export const session = () => currentUser;
export function clearSession() { currentUser = undefined; }
async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, { method, credentials: 'same-origin', headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(20000) });
  let result: T & { message?: string; code?: string };
  try { result = await response.json() as typeof result; } catch { throw new Error('El servidor no está disponible. Revisa la configuración de Vercel y Neon.'); }
  if (!response.ok) {
    if (response.status === 401) clearSession();
    const messages: Record<string, string> = {
      INVALID_EMAIL_OR_PASSWORD: 'Email o contraseña incorrectos.', USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'Ya existe una cuenta con ese email. Intenta entrar.',
      PASSWORD_TOO_SHORT: 'Usa una contraseña de al menos 12 caracteres.', PASSWORD_TOO_LONG: 'La contraseña es demasiado larga.', INVALID_EMAIL: 'Revisa tu email.',
    };
    throw new Error(response.status === 429 ? 'Demasiados intentos. Espera un minuto.' : messages[result.code ?? ''] ?? result.message ?? 'No se pudo completar la solicitud.');
  }
  return result;
}
export async function initialize() {
  // Remove credentials from the former Cognito implementation, never reuse them.
  sessionStorage.removeItem('ritmo:session'); sessionStorage.removeItem('ritmo:oauth');
  try {
    const status = await request<{ configured: boolean }>('/status'); configured = status.configured;
    currentUser = (await request<{ user: User | null }>('/session')).user ?? undefined;
  } catch { configured = false; currentUser = undefined; }
}
export async function login(email: string, password: string, name?: string) {
  if (!configured) throw new Error('Primero configura Vercel y Neon. Los pasos están en el README.');
  await request(name === undefined ? '/auth/sign-in/email' : '/auth/sign-up/email', 'POST', { email, password, ...(name === undefined ? {} : { name }), rememberMe: true });
  const result = await request<{ user: User | null }>('/session');
  if (!result.user) throw new Error('No se pudo confirmar tu sesión. Vuelve a entrar.');
  currentUser = result.user;
}
export const cloudClient = { request };
export async function logout() { await request('/auth/sign-out', 'POST', {}); clearSession(); }
