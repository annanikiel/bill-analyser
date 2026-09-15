import type { BackendConfig } from './config.js';

/**
 * Sign-in against the Cognito hosted UI, using authorization code flow with PKCE.
 *
 * A browser app cannot keep a client secret, so there isn't one. PKCE is what stops
 * an intercepted authorization code being redeemed by anyone else: the app invents a
 * random verifier, sends only its SHA-256 hash when starting the login, and proves it
 * holds the original when exchanging the code.
 */

const VERIFIER_KEY = 'bill-analyser:pkce-verifier';
const STATE_KEY = 'bill-analyser:oauth-state';
const TOKENS_KEY = 'bill-analyser:tokens';

/** Refresh this long before expiry, so a request never races the clock. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export interface StoredTokens {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

interface TokenResponse {
  id_token: string;
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

/* ------------------------------------------------------------------ storage */

function readTokens(): StoredTokens | null {
  try {
    const raw = localStorage.getItem(TOKENS_KEY);
    return raw ? (JSON.parse(raw) as StoredTokens) : null;
  } catch {
    return null;
  }
}

function writeTokens(tokens: StoredTokens | null): void {
  try {
    if (tokens) localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
    else localStorage.removeItem(TOKENS_KEY);
  } catch {
    // Private browsing or blocked site data. The session still works; it just will
    // not survive a reload.
  }
}

/* --------------------------------------------------------------------- PKCE */

function base64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(digest);
}

/* --------------------------------------------------------------------- flow */

/** Send the browser to the hosted login page. Does not return. */
export async function beginSignIn(config: BackendConfig): Promise<void> {
  const verifier = randomString();
  const state = randomString();

  // sessionStorage, not localStorage: these are single-use and belong to this tab.
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: 'openid email profile',
    state,
    code_challenge: await challengeFor(verifier),
    code_challenge_method: 'S256',
  });

  window.location.assign(`${config.cognitoDomain}/oauth2/authorize?${params}`);
}

/**
 * Complete a login if this page load is a redirect back from Cognito.
 *
 * Returns the tokens on success, or null when this is an ordinary page load.
 */
export async function completeSignIn(config: BackendConfig): Promise<StoredTokens | null> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    cleanUrl();
    throw new Error(url.searchParams.get('error_description') ?? `Sign-in failed: ${error}`);
  }
  if (!code) return null;

  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  const expectedState = sessionStorage.getItem(STATE_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
  cleanUrl();

  // Without this check, a third party could hand you a URL carrying their own code
  // and log your browser into their account.
  if (!returnedState || returnedState !== expectedState) {
    throw new Error('Sign-in could not be verified. Please try again.');
  }
  if (!verifier) {
    throw new Error('Sign-in was started in a different tab. Please try again.');
  }

  const tokens = await exchange(config, {
    grant_type: 'authorization_code',
    client_id: config.clientId,
    code,
    redirect_uri: config.redirectUri,
    code_verifier: verifier,
  });

  writeTokens(tokens);
  return tokens;
}

/** Strip the OAuth parameters so a refresh does not try to redeem a spent code. */
function cleanUrl(): void {
  const url = new URL(window.location.href);
  for (const key of ['code', 'state', 'error', 'error_description']) url.searchParams.delete(key);
  window.history.replaceState({}, '', url.toString());
}

async function exchange(
  config: BackendConfig,
  body: Record<string, string>,
): Promise<StoredTokens> {
  const response = await fetch(`${config.cognitoDomain}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });

  if (!response.ok) {
    throw new Error('Could not complete sign-in. Please try again.');
  }

  const payload = (await response.json()) as TokenResponse;
  return {
    idToken: payload.id_token,
    accessToken: payload.access_token,
    // A refresh exchange does not return a new refresh token; keep the existing one.
    refreshToken: payload.refresh_token ?? readTokens()?.refreshToken ?? '',
    expiresAt: Date.now() + payload.expires_in * 1000,
  };
}

/**
 * A token good for at least the next few minutes, refreshing if needed.
 *
 * Returns null when there is no usable session, which the caller should treat as
 * "signed out" rather than as an error.
 */
export async function currentIdToken(config: BackendConfig): Promise<string | null> {
  const tokens = readTokens();
  if (!tokens) return null;

  if (Date.now() < tokens.expiresAt - REFRESH_MARGIN_MS) return tokens.idToken;

  if (!tokens.refreshToken) {
    writeTokens(null);
    return null;
  }

  try {
    const refreshed = await exchange(config, {
      grant_type: 'refresh_token',
      client_id: config.clientId,
      refresh_token: tokens.refreshToken,
    });
    writeTokens(refreshed);
    return refreshed.idToken;
  } catch {
    // The refresh token has expired or been revoked: a normal end of session.
    writeTokens(null);
    return null;
  }
}

export function isSignedIn(): boolean {
  return readTokens() !== null;
}

/** Best-effort display name from the id token, for the header. */
export function signedInEmail(): string | null {
  const tokens = readTokens();
  if (!tokens) return null;
  try {
    const payload = JSON.parse(atob(tokens.idToken.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.email === 'string' ? payload.email : null;
  } catch {
    return null;
  }
}

export function signOut(config: BackendConfig): void {
  writeTokens(null);
  const params = new URLSearchParams({
    client_id: config.clientId,
    logout_uri: config.redirectUri,
  });
  // Clears the Cognito session cookie too, so the next sign-in really asks.
  window.location.assign(`${config.cognitoDomain}/logout?${params}`);
}

export function clearLocalSession(): void {
  writeTokens(null);
}
