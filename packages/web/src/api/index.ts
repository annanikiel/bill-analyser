import { MockApiClient } from './mock.js';
import { HttpApiClient } from './http.js';
import { readBackendConfig } from '../auth/config.js';
import type { ApiClient } from './types.js';

export * from './types.js';
export { MockApiClient } from './mock.js';
export { HttpApiClient } from './http.js';

/** Null when the app was built without backend configuration, i.e. demo mode. */
export const backendConfig = readBackendConfig();
export const isMockBackend = backendConfig === null;

/**
 * Chooses the backend. With no configuration compiled in - a local `npm run dev`, or
 * a build that has not been pointed at AWS - the app runs entirely in the browser
 * against mock data, so it is always runnable.
 */
export function createApiClient(onSignedOut: () => void): ApiClient {
  if (!backendConfig) return new MockApiClient();
  return new HttpApiClient(backendConfig, onSignedOut);
}
