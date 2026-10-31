type User = { id: string; name: string; email: string };
let currentUser: User | undefined;
export let configured = false;
export const endpoint = `${window.location.origin}/api/steps`;
export const legacyEndpoint = `${window.location.origin}/api/shortcuts`;
export const session = () => currentUser;
export function clearSession() { currentUser = undefined; }
class APIError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
function failureLocation(path: string, error: unknown) {
  return `${path}${error instanceof APIError ? ` (HTTP ${error.status})` : ' (sin respuesta válida)'}`;
}
async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, { method, credentials: 'same-origin', headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(20000) });
  let result: T & { message?: string; code?: string };
  try { result = await response.json() as typeof result; } catch { throw new APIError('El servidor no devolvió una respuesta JSON válida. Revisa las funciones de Vercel.', response.status); }
  if (!response.ok) {
    if (response.status === 401) clearSession();
    const messages: Record<string, string> = {
      INVALID_EMAIL_OR_PASSWORD: 'Email o contraseña incorrectos.', USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'Ya existe una cuenta con ese email. Intenta entrar.',
      PASSWORD_TOO_SHORT: 'Usa una contraseña de al menos 12 caracteres.', PASSWORD_TOO_LONG: 'La contraseña es demasiado larga.', INVALID_EMAIL: 'Revisa tu email.',
    };
    throw new APIError(response.status === 429 ? 'Demasiados intentos. Espera un minuto.' : messages[result.code ?? ''] ?? result.message ?? 'No se pudo completar la solicitud.', response.status);
  }
  return result;
}
export async function initialize() {
  // Remove credentials from the former Cognito implementation, never reuse them.
  sessionStorage.removeItem('ritmo:session'); sessionStorage.removeItem('ritmo:oauth');
  configured = false; currentUser = undefined;
  try {
    const status = await request<{ configured: boolean }>('/status');
    if (status?.configured !== true) throw new Error('Configuración no confirmada.');
    configured = true;
  } catch (error) {
    return `No se pudo confirmar la configuración del servidor: ${failureLocation('/api/status', error)}. Revisa las variables de Production y el despliegue de la API. Esto no significa que tu base de datos no exista.`;
  }
  try {
    const result = await request<{ user: User | null }>('/session');
    if (!result || !Object.hasOwn(result, 'user')) throw new Error('Sesión no válida.');
    currentUser = result.user ?? undefined;
  } catch (error) {
    return `El servidor está configurado, pero no se pudo comprobar la sesión: ${failureLocation('/api/session', error)}. Revisa la conexión con Neon y los registros de la función en Vercel.`;
  }
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
