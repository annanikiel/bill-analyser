import { MockApiClient } from './mock.js';
import type { ApiClient } from './types.js';

export * from './types.js';
export { MockApiClient } from './mock.js';

/**
 * Chooses the backend. With no VITE_API_BASE_URL set - which is the case for a
 * local `npm run dev` and for any build that has not been pointed at AWS - the app
 * runs entirely in the browser against mock data.
 */
export function createApiClient(): ApiClient {
  const baseUrl = import.meta.env.VITE_API_BASE_URL;
  if (!baseUrl) return new MockApiClient();

  // The HTTP client lands here in phase 2, talking to API Gateway with a Cognito
  // token. It implements the same interface, so nothing above this line changes.
  throw new Error(
    'VITE_API_BASE_URL is set but the HTTP client is not built yet. Unset it to use mock data.',
  );
}

export const isMockBackend = !import.meta.env.VITE_API_BASE_URL;
