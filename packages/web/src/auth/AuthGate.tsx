import { useEffect, useState, type ReactNode } from 'react';
import { backendConfig } from '../api/index.js';
import { beginSignIn, completeSignIn, isSignedIn, signOut } from './cognito.js';
import { Banner, Button } from '../components/ui.js';

/**
 * Stands in front of the app when a backend is configured.
 *
 * In demo mode there is no backend and nothing to sign in to, so this renders its
 * children unchanged - which is what keeps the app runnable with no AWS account.
 */

type State =
  | { status: 'checking' }
  | { status: 'signed-out'; error?: string }
  | { status: 'signed-in' };

export function AuthGate({ children }: { children: (signOutFn: () => void) => ReactNode }) {
  const [state, setState] = useState<State>(() =>
    backendConfig ? { status: 'checking' } : { status: 'signed-in' },
  );

  useEffect(() => {
    if (!backendConfig) return;

    let cancelled = false;
    (async () => {
      try {
        // Does nothing unless this page load is a redirect back from Cognito.
        await completeSignIn(backendConfig);
        if (!cancelled) setState(isSignedIn() ? { status: 'signed-in' } : { status: 'signed-out' });
      } catch (cause) {
        if (!cancelled) {
          setState({
            status: 'signed-out',
            error: cause instanceof Error ? cause.message : 'Sign-in failed.',
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === 'checking') {
    return (
      <div className="signin">
        <p className="signin-checking">Checking your session…</p>
      </div>
    );
  }

  if (state.status === 'signed-out') {
    return (
      <div className="signin">
        <div className="signin-card">
          <h1 className="signin-title">Bill Analyser</h1>
          <p className="signin-body">
            Your receipts and spending are private to your account. Sign in to see them.
          </p>
          {state.error && <Banner tone="critical">{state.error}</Banner>}
          <Button
            variant="primary"
            onClick={() => {
              void beginSignIn(backendConfig!);
            }}
          >
            Sign in
          </Button>
        </div>
      </div>
    );
  }

  return <>{children(() => (backendConfig ? signOut(backendConfig) : undefined))}</>;
}
