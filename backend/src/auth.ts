import { betterAuth } from 'better-auth';
import type { Pool } from 'pg';
import type { Config } from './config.js';
import { RateLimiter } from './rate-limit.js';
export function createAuth(pool: Pool, config: Config, limiter: RateLimiter) {
  return betterAuth({
    appName: 'Ritmo', baseURL: config.origin, basePath: '/api/auth', secret: config.secret,
    database: pool, trustedOrigins: [config.origin],
    emailAndPassword: { enabled: true, minPasswordLength: 12, maxPasswordLength: 128, requireEmailVerification: false },
    user: { modelName: 'auth_user' }, account: { modelName: 'auth_account' }, verification: { modelName: 'auth_verification' },
    session: { modelName: 'auth_session', expiresIn: 7 * 86400, disableSessionRefresh: true, cookieCache: { enabled: false } },
    advanced: { useSecureCookies: config.origin.startsWith('https:'), defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
      ipAddress: { ipAddressHeaders: ['x-real-ip'] } },
    databaseHooks: { session: { create: { before: async session => ({ data: { ...session, ipAddress: null, userAgent: null } }) } } },
    rateLimit: { enabled: true, window: 60, max: 60, customStorage: { consume: (key, rule) => limiter.consume(`auth:${key}`, rule) },
      customRules: { '/sign-in/email': { window: 60, max: 10 }, '/sign-up/email': { window: 60, max: 5 } } },
    logger: { disabled: true },
  });
}
export type Auth = ReturnType<typeof createAuth>;
