'use client';

import { useState, useEffect, useCallback } from 'react';

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
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Request failed');
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    if (options?.autoFetch !== false) {
      fetchData();
    }
  }, [fetchData, options?.autoFetch]);

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
        headers: { 'Content-Type': 'application/json' },
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
