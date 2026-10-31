import { handleRequest } from '../backend/src/runtime.js';
// vercel.json explicitly routes every /api/* depth here; Vite does not provide
// Next.js-style multi-segment catch-all semantics for a [...path].ts filename.
export const maxDuration = 30;
export default { fetch: handleRequest };
