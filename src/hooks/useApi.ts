'use client';

import { useState, useEffect, useCallback } from 'react';

/** Shared headers for all API requests — includes auth key */
function apiHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Add API key if configured (NEXT_PUBLIC_ so it's available in browser)
  const apiKey = process.env.NEXT_PUBLIC_ADPILOT_API_KEY;
  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }

  return { ...headers, ...extra };
}

/**
 * Generic hook for fetching data from API routes.
 */
export function useApiData<T>(
  url: string | null,
  options?: { autoFetch?: boolean; refreshInterval?: number }
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!url) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(url, { headers: apiHeaders() });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Request failed');
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [url]);

  /* eslint-disable react-hooks/set-state-in-effect -- fetchData is async, setState happens in callback not synchronously */
  useEffect(() => {
    if (options?.autoFetch !== false) {
      fetchData();
    }
  }, [fetchData, options?.autoFetch]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Optional polling
  useEffect(() => {
    if (!options?.refreshInterval || !url) return;
    const interval = setInterval(fetchData, options.refreshInterval);
    return () => clearInterval(interval);
  }, [fetchData, options?.refreshInterval, url]);

  return { data, loading, error, refetch: fetchData };
}

/**
 * Hook for POST requests (sync, save, etc.)
 */
export function useApiAction<TResponse, TBody = unknown>(url: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(async (body?: TBody): Promise<TResponse | null> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: apiHeaders(),
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Request failed');
      return json as TResponse;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setLoading(false);
    }
  }, [url]);

  return { execute, loading, error };
}

/**
 * Hook to fetch configured Facebook ad accounts for multi-account filtering
 */
export function useAdAccounts() {
  const { data, loading, error } = useApiData<{ connections: { facebook: { accounts: { id: string; name?: string; adAccountId: string }[] } } }>('/api/settings/connections');
  const accounts = data?.connections?.facebook?.accounts || [];
  return { accounts, loading, error };
}

/** Export for use in direct fetch() calls across the app */
export { apiHeaders };
