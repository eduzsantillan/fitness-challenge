import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
beforeEach(() => { vi.resetModules(); vi.stubGlobal('window', { location: { origin: 'https://ritmo.example' } }); vi.stubGlobal('sessionStorage', { removeItem: vi.fn(), setItem: vi.fn() }); });
afterEach(() => vi.unstubAllGlobals());
const response = (data: unknown, status = 200) => Response.json(data, { status });
describe('same-origin cookie sessions', () => {
  it('loads a real session without persisting any bearer tokens', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ configured: true })).mockResolvedValueOnce(response({ user: { id: 'alice', name: 'Alice', email: 'alice@example.test' } })); vi.stubGlobal('fetch', fetch);
    const auth = await import('../src/auth'); await auth.initialize();
    expect(auth.session()?.id).toBe('alice'); expect(auth.configured).toBe(true); expect(auth.endpoint).toBe('https://ritmo.example/api/shortcuts');
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
    const options = fetch.mock.calls[1]![1] as RequestInit; expect(options.credentials).toBe('same-origin'); expect(options.cache).toBe('no-store'); expect(options.headers).not.toHaveProperty('Authorization');
  });
  it('does not manufacture a cloud session when backend is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ configured: false }, 503)));
    const auth = await import('../src/auth'); await auth.initialize(); expect(auth.session()).toBeUndefined(); expect(auth.configured).toBe(false);
  });
  it('registers with a name, then confirms the server cookie session', async () => {
    const user = { id: 'alice', name: 'Alice', email: 'alice@example.test' };
    const fetch = vi.fn().mockResolvedValueOnce(response({ configured: true })).mockResolvedValueOnce(response({ user: null })).mockResolvedValueOnce(response({ user })).mockResolvedValueOnce(response({ user })); vi.stubGlobal('fetch', fetch);
    const auth = await import('../src/auth'); await auth.initialize(); await auth.login(user.email, 'a-secure-password', user.name);
    expect(fetch.mock.calls[2]![0]).toBe('/api/auth/sign-up/email'); expect(auth.session()?.id).toBe('alice'); expect(sessionStorage.setItem).not.toHaveBeenCalled();
  });
  it('clears a rejected session instead of showing fabricated cloud activity', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ configured: true })).mockResolvedValueOnce(response({ user: { id: 'alice' } })).mockResolvedValueOnce(response({ message: 'Inicia sesión.' }, 401)); vi.stubGlobal('fetch', fetch);
    const auth = await import('../src/auth'); await auth.initialize(); await expect(auth.cloudClient.request('/me')).rejects.toThrow('Inicia sesión'); expect(auth.session()).toBeUndefined();
  });
});
