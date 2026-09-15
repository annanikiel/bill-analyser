import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Category, CategoryRule, Receipt } from '@bill/shared';
import { createApiClient, type ApiClient } from '../api/index.js';
import { clearLocalSession } from '../auth/cognito.js';

/**
 * One load of everything, held in memory.
 *
 * A personal receipt history is small - a few thousand line items a year - so the
 * app fetches it once and does every summary, filter and re-slice locally. That
 * keeps range changes instant and means the numbers on screen always come from one
 * consistent snapshot rather than several independent queries.
 */

interface AppData {
  categories: Category[];
  receipts: Receipt[];
  rules: CategoryRule[];
  loading: boolean;
  error: string | null;
  api: ApiClient;
  refresh: () => Promise<void>;
  /** Apply a server result to local state without a full refetch. */
  upsertReceipt: (receipt: Receipt) => void;
  removeReceipt: (id: string) => void;
  setCategories: (categories: Category[]) => void;
  setRules: (rules: CategoryRule[]) => void;
}

const AppDataContext = createContext<AppData | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  // A session that ends mid-use drops the stored tokens and reloads, which puts the
  // AuthGate back in front of the app rather than leaving failing requests on screen.
  const api = useMemo(
    () =>
      createApiClient(() => {
        clearLocalSession();
        window.location.reload();
      }),
    [],
  );
  const [categories, setCategories] = useState<Category[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [rules, setRules] = useState<CategoryRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [nextCategories, nextReceipts, nextRules] = await Promise.all([
        api.listCategories(),
        api.listReceipts(),
        api.listRules(),
      ]);
      setCategories(nextCategories);
      setReceipts(nextReceipts);
      setRules(nextRules);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load your data');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const upsertReceipt = useCallback((receipt: Receipt) => {
    setReceipts((current) => {
      const index = current.findIndex((entry) => entry.id === receipt.id);
      if (index === -1) return [receipt, ...current];
      const next = [...current];
      next[index] = receipt;
      return next;
    });
  }, []);

  const removeReceipt = useCallback((id: string) => {
    setReceipts((current) => current.filter((receipt) => receipt.id !== id));
  }, []);

  const value = useMemo<AppData>(
    () => ({
      categories,
      receipts,
      rules,
      loading,
      error,
      api,
      refresh,
      upsertReceipt,
      removeReceipt,
      setCategories,
      setRules,
    }),
    [categories, receipts, rules, loading, error, api, refresh, upsertReceipt, removeReceipt],
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData(): AppData {
  const value = useContext(AppDataContext);
  if (!value) throw new Error('useAppData must be used inside AppDataProvider');
  return value;
}

/** Categories still offered for new assignments, in the user's order. */
export function useActiveCategories(): Category[] {
  const { categories } = useAppData();
  return useMemo(
    () => categories.filter((category) => !category.archived).sort((a, b) => a.sortOrder - b.sortOrder),
    [categories],
  );
}

/** Lookup from category id to the category, including archived ones. */
export function useCategoryLookup(): Map<string, Category> {
  const { categories } = useAppData();
  return useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
}
