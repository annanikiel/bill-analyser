import { useEffect, useState } from 'react';
import { AppDataProvider, useAppData } from './lib/store.js';
import { hrefFor, useRoute, type Route } from './lib/router.js';
import { applyThemeChoice, readThemeChoice, type ThemeChoice } from './lib/theme-toggle.js';
import { isMockBackend, MockApiClient } from './api/index.js';
import { AuthGate } from './auth/AuthGate.js';
import { signedInEmail } from './auth/cognito.js';
import { SummaryScreen } from './screens/Summary.js';
import { CaptureScreen } from './screens/Capture.js';
import { ReviewScreen } from './screens/Review.js';
import { ReceiptsScreen } from './screens/Receipts.js';
import { CategoriesScreen } from './screens/Categories.js';

const NAV: { route: Route; label: string; icon: string }[] = [
  { route: { name: 'summary' }, label: 'Summary', icon: '◧' },
  { route: { name: 'scan' }, label: 'Scan', icon: '⬚' },
  { route: { name: 'receipts' }, label: 'Receipts', icon: '☰' },
  { route: { name: 'categories' }, label: 'Categories', icon: '◑' },
];

function Shell({ onSignOut }: { onSignOut: () => void }) {
  const [route, navigate] = useRoute();
  const [theme, setTheme] = useState<ThemeChoice>(() => readThemeChoice());
  const { receipts, refresh } = useAppData();

  useEffect(() => {
    applyThemeChoice(theme);
  }, [theme]);

  const pendingCount = receipts.filter((receipt) => receipt.status === 'needs_review').length;

  return (
    <div className="app">
      <header className="app-header">
        <a className="app-title" href={hrefFor({ name: 'summary' })}>
          Bill Analyser
        </a>
        <div className="app-header-actions">
          {isMockBackend && <span className="demo-badge">Demo data</span>}
          {!isMockBackend && (
            <button type="button" className="signout-button" onClick={onSignOut}>
              <span className="signout-email">{signedInEmail() ?? 'Signed in'}</span>
              <span>Sign out</span>
            </button>
          )}
          <select
            className="theme-select"
            aria-label="Colour theme"
            value={theme}
            onChange={(event) => setTheme(event.target.value as ThemeChoice)}
          >
            <option value="system">Auto</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
      </header>

      <nav className="app-nav" aria-label="Sections">
        {NAV.map((entry) => {
          const active =
            entry.route.name === route.name ||
            (entry.route.name === 'receipts' && route.name === 'receipt');
          return (
            <a
              key={entry.route.name}
              href={hrefFor(entry.route)}
              className={active ? 'nav-link is-active' : 'nav-link'}
              aria-current={active ? 'page' : undefined}
            >
              <span className="nav-icon" aria-hidden="true">
                {entry.icon}
              </span>
              <span className="nav-label">{entry.label}</span>
              {entry.route.name === 'receipts' && pendingCount > 0 && (
                <span className="nav-badge" aria-label={`${pendingCount} to review`}>
                  {pendingCount}
                </span>
              )}
            </a>
          );
        })}
      </nav>

      <main className="app-main">
        {route.name === 'summary' && <SummaryScreen />}
        {route.name === 'scan' && <CaptureScreen navigate={navigate} />}
        {route.name === 'receipts' && <ReceiptsScreen />}
        {route.name === 'receipt' && <ReviewScreen id={route.id} navigate={navigate} />}
        {route.name === 'categories' && <CategoriesScreen />}
      </main>

      {isMockBackend && (
        <footer className="app-footer">
          <p>
            Running on sample data held in this browser. Nothing is uploaded and nothing is shared.
          </p>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              if (!window.confirm('Reset the demo data back to its starting state?')) return;
              new MockApiClient().reset();
              void refresh();
            }}
          >
            Reset demo data
          </button>
        </footer>
      )}
    </div>
  );
}

export function App() {
  return (
    <AuthGate>
      {(onSignOut) => (
        <AppDataProvider>
          <Shell onSignOut={onSignOut} />
        </AppDataProvider>
      )}
    </AuthGate>
  );
}
