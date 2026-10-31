import { HttpError, requiredString } from './model.js';
import { ChallengeService, tokenHash } from './service.js';
export type SessionUser = { id: string; name: string; email: string };
export type HandlerOptions = {
  origin: string;
  user: (request: Request) => Promise<SessionUser | null>;
  auth: (request: Request) => Promise<Response>;
  limit?: (key: string, rule: { window: number; max: number }) => Promise<{ allowed: boolean; retryAfter: number | null }>;
};
export function json(value: unknown, status = 200, extra?: HeadersInit) {
  return Response.json(value, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...Object.fromEntries(new Headers(extra)) } });
}
async function readBody(request: Request) {
  if (!request.body) return '';
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const next = await reader.read(); if (next.done) break;
    size += next.value.byteLength;
    if (size > 24000) { await reader.cancel(); throw new HttpError(413, 'Solicitud demasiado grande.'); }
    chunks.push(next.value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
export function createHandler(service: ChallengeService, options: HandlerOptions) {
  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url), path = url.pathname.replace(/^\/api(?=\/|$)/, '') || '/';
      if (!url.pathname.startsWith('/api/')) throw new HttpError(404, 'Ruta no encontrada.');
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
      if (path === '/status' && request.method === 'GET') return json({ configured: true, emailVerification: false, passwordRecovery: false });
      const isIngest = path === '/shortcuts' && request.method === 'POST';
      const write = !['GET', 'HEAD'].includes(request.method);
      if (!isIngest && (request.headers.get('sec-fetch-site') === 'cross-site' || (write && request.headers.get('origin') !== options.origin))) throw new HttpError(403, 'Abre la app desde su dominio para continuar.');
      const limited = await options.limit?.(`ip:${request.headers.get('x-real-ip') ?? 'unknown'}`, { window: 60, max: 180 });
      if (limited && !limited.allowed) return json({ message: 'Demasiadas solicitudes. Espera un momento.' }, 429, { 'retry-after': String(limited.retryAfter ?? 60) });
      let body: Record<string, unknown> = {};
      if (write) {
        if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') throw new HttpError(415, 'Envía los datos como JSON.');
        const raw = await readBody(request);
        if (raw) {
          try { const parsed: unknown = JSON.parse(raw); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(); body = parsed as Record<string, unknown>; }
          catch { throw new HttpError(400, 'JSON no válido.'); }
        }
      }
      if (path.startsWith('/auth/')) {
        if (!['/auth/sign-up/email', '/auth/sign-in/email', '/auth/sign-out'].includes(path) || request.method !== 'POST') throw new HttpError(404, 'Ruta no encontrada.');
        if (path === '/auth/sign-up/email') body.name = requiredString(body.name, 'Nombre', 40);
        const response = await options.auth(new Request(request, { body: JSON.stringify(body) }));
        const headers = new Headers(response.headers); headers.set('cache-control', 'no-store'); headers.delete('content-length');
        // Keep credentials inside HttpOnly cookies, not JSON returned to browser JavaScript.
        if (response.ok) {
          const data = await response.json() as { user?: SessionUser };
          return new Response(JSON.stringify(data.user ? { user: publicUser(data.user) } : { success: true }), { status: response.status, headers });
        }
        return new Response(response.body, { status: response.status, headers });
      }
      if (isIngest) {
        const token = /^Bearer (\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
        if (!token) throw new HttpError(401, 'Falta la clave de Atajos.');
        const limit = await options.limit?.(`shortcut:${tokenHash(token)}`, { window: 60, max: 12 });
        if (limit && !limit.allowed) return json({ message: 'Espera antes de volver a enviar.' }, 429, { 'retry-after': String(limit.retryAfter ?? 60) });
        return json(await service.ingest(token, body));
      }
      const user = await options.user(request);
      if (path === '/session' && request.method === 'GET') return json({ user: user ? publicUser(user) : null });
      if (!user) throw new HttpError(401, 'Inicia sesión.');
      return json(await service.handle(user.id, request.method, path, body));
    } catch (error) {
      if (!(error instanceof HttpError)) console.error('request_failed');
      return json({ message: error instanceof HttpError ? error.message : 'No se pudo completar la solicitud.' }, error instanceof HttpError ? error.status : 500);
    }
  };
}
const publicUser = (user: SessionUser) => ({ id: user.id, name: user.name, email: user.email });
