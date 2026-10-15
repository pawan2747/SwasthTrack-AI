"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface AdminData<T> {
  data: T | null;
  /** First load in flight (nothing to show yet). */
  loading: boolean;
  /** A reload in flight (the previous data stays on screen). */
  refreshing: boolean;
  error: string | null;
  /** When `data` last arrived. */
  updatedAt: Date | null;
  reload: () => void;
}

/**
 * GET a JSON endpoint of the admin API and keep it fresh.
 * - `refreshMs` > 0 reloads on that interval, but only while the tab is visible (a hidden
 *   monitor does not hammer the server) and straight away when the tab comes back.
 * - a failed reload keeps the last good data and only sets `error`.
 * - a 401/403 is reported in plain words; the page decides what to show.
 * `url` is expected to stay the same for the life of the component (remount with a `key` to change it).
 */
export function useAdminData<T>(url: string | null, refreshMs = 0): AdminData<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(url));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [tick, setTick] = useState(0);
  const first = useRef(true);

  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    let alive = true;

    const run = async () => {
      // State is only touched after an await, never synchronously in the effect body.
      await Promise.resolve();
      if (!alive) return;
      if (!first.current) setRefreshing(true);
      try {
        const res = await fetch(url, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        if (!alive) return;
        if (res.status === 401) throw new Error("Your session ended. Please sign in again.");
        if (res.status === 403) throw new Error("This account is not an administrator.");
        if (!res.ok) throw new Error(`The server answered ${res.status}.`);
        const body = (await res.json()) as T;
        if (!alive) return;
        setData(body);
        setError(null);
        setUpdatedAt(new Date());
      } catch (err) {
        if (!alive || (err instanceof DOMException && err.name === "AbortError")) return;
        setError(err instanceof Error ? err.message : "Could not load.");
      } finally {
        if (alive) {
          first.current = false;
          setLoading(false);
          setRefreshing(false);
        }
      }
    };
    void run();

    let timer: ReturnType<typeof setInterval> | null = null;
    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
    };
    if (refreshMs > 0) {
      timer = setInterval(() => {
        if (document.visibilityState === "visible") void run();
      }, refreshMs);
      document.addEventListener("visibilitychange", onVisible);
    }
    return () => {
      alive = false;
      controller.abort();
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [url, refreshMs, tick]);

  return { data, loading, refreshing, error, updatedAt, reload };
}
