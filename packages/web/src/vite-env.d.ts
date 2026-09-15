/// <reference types="vite/client" />

/**
 * Backend configuration injected at build time. All four are public identifiers,
 * never credentials - see src/auth/config.ts. Unset means demo mode.
 */
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_COGNITO_USER_POOL_ID?: string;
  readonly VITE_COGNITO_CLIENT_ID?: string;
  readonly VITE_COGNITO_DOMAIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
