/**
 * Backend configuration, compiled in at build time.
 *
 * Every value here is a public identifier, not a credential: a user pool id, a client
 * id, two URLs. They are visible in the shipped JavaScript by design, the same way a
 * front door number is not a key. What protects the data is the login and the
 * per-user partitioning behind it, never the obscurity of these strings.
 *
 * With none of them set, the app runs against in-browser demo data.
 */

export interface BackendConfig {
  apiBaseUrl: string;
  userPoolId: string;
  clientId: string;
  /** Cognito hosted UI domain, e.g. https://bill-analyser-123.auth.eu-west-2.amazoncognito.com */
  cognitoDomain: string;
  /** Where Cognito sends you back to. Must exactly match a callback URL on the pool. */
  redirectUri: string;
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function readBackendConfig(): BackendConfig | null {
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;
  const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID;
  const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID;
  const cognitoDomain = import.meta.env.VITE_COGNITO_DOMAIN;

  if (!apiBaseUrl || !userPoolId || !clientId || !cognitoDomain) return null;

  return {
    apiBaseUrl: trimSlash(apiBaseUrl),
    userPoolId,
    clientId,
    cognitoDomain: trimSlash(cognitoDomain),
    // BASE_URL is the path Vite built for ("/bill-analyser/" or "/"), so this
    // reproduces the callback URL the stack registered even if the user arrived
    // on a deep link.
    redirectUri: `${window.location.origin}${import.meta.env.BASE_URL}`,
  };
}
