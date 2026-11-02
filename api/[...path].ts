import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleApi } from '../server/dist/serverless/api.js';
import { storeFromEnv } from '../server/dist/store.js';

/**
 * Every `/api/*` request lands here. The game engine has no process to live
 * in on this platform, so each call rebuilds the room from the store, winds
 * its clock forward to now, acts on it, and writes it back.
 *
 * Needs a Redis database (`KV_REST_API_URL` and `KV_REST_API_TOKEN`, which is
 * what Vercel's marketplace sets). Without one the store falls back to
 * memory, and on serverless that means every request sees an empty world.
 */
const store = storeFromEnv();

export default async function handler(request: VercelRequest, response: VercelResponse) {
  // The client is served from this same origin, but a split deploy is allowed.
  response.setHeader('Access-Control-Allow-Origin', process.env.CLIENT_ORIGIN ?? '*');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (request.method === 'OPTIONS') {
    response.status(204).end();
    return;
  }

  // The catch-all segment arrives as an array, a string, or not at all
  // depending on how the request was routed, so fall back to the raw URL.
  const segments = request.query.path;
  let path = Array.isArray(segments) ? segments.join('/') : (segments ?? '');
  if (!path && request.url) {
    path = new URL(request.url, 'http://localhost').pathname;
  }

  const query: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(request.query)) {
    if (key !== 'path') query[key] = Array.isArray(value) ? value[0] : value;
  }

  try {
    const result = await handleApi(
      { method: request.method ?? 'GET', path, query, body: request.body },
      store,
    );
    // Polling must never be served from a cache.
    response.setHeader('Cache-Control', 'no-store');
    response.status(result.status).json(result.body);
  } catch (error) {
    console.error('api error', error);
    response.status(500).json({ error: 'server-error' });
  }
}
