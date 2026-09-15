/**
 * Theme preference. "system" means no stamp on the root element, leaving the page
 * to prefers-color-scheme; "light"/"dark" stamp data-theme so the choice wins over
 * the OS setting in both directions.
 */

export type ThemeChoice = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'bill-analyser:theme';

export function readThemeChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // Storage unavailable; fall through to the system default.
  }
  return 'system';
}

export function applyThemeChoice(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);

  try {
    localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Preference is cosmetic; losing it is survivable.
  }
}
