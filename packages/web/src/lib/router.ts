import { useCallback, useEffect, useState } from 'react';

/**
 * Hash routing, deliberately.
 *
 * GitHub Pages serves static files only: with path-based routes, refreshing on
 * /receipts returns a 404 because no such file exists. Hashes keep every route
 * on index.html, which is what a static host can actually serve.
 */

export type Route =
  | { name: 'summary' }
  | { name: 'scan' }
  | { name: 'receipts' }
  | { name: 'receipt'; id: string }
  | { name: 'categories' };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, '').split('?')[0] ?? '';
  const segments = path.split('/').filter(Boolean);

  if (segments.length === 0) return { name: 'summary' };
  if (segments[0] === 'scan') return { name: 'scan' };
  if (segments[0] === 'categories') return { name: 'categories' };
  if (segments[0] === 'receipts') {
    return segments[1] ? { name: 'receipt', id: segments[1] } : { name: 'receipts' };
  }
  return { name: 'summary' };
}

export function hrefFor(route: Route): string {
  switch (route.name) {
    case 'summary':
      return '#/';
    case 'scan':
      return '#/scan';
    case 'receipts':
      return '#/receipts';
    case 'receipt':
      return `#/receipts/${route.id}`;
    case 'categories':
      return '#/categories';
  }
}

export function useRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));

  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = useCallback((next: Route) => {
    window.location.hash = hrefFor(next);
    // Route changes are page changes; start at the top like a real navigation.
    window.scrollTo({ top: 0 });
  }, []);

  return [route, navigate];
}
