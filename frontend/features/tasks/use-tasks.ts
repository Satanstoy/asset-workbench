"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useIdentity } from "@/features/identity/session";
import { api, ApiError } from "@/lib/api";
import type { Task } from "@/lib/api";

export type TaskEntry = { task: Task; queryError?: boolean; unavailable?: boolean };
type ListState = "loading" | "ready" | "error";

function listPath(templateId?: string) {
  return templateId ? "/api/tasks?" + new URLSearchParams({ templateId }) : "/api/tasks";
}

export function useTasks(templateId?: string) {
  const { user, epoch, expire, verify } = useIdentity();
  const userId = user!.id;
  const [entries, setEntries] = useState<TaskEntry[]>([]);
  const [listState, setListState] = useState<ListState>("loading");
  const currentScope = useRef<AbortController | null>(null);
  const inFlight = useRef(new Set<string>());

  const load = useCallback(async (scope: AbortController) => {
    try {
      const { tasks } = await api<{ tasks: Task[] }>(listPath(templateId), { signal: scope.signal });
      if (scope.signal.aborted) return;
      setEntries((current) => {
        const combined = new Map(current.map((entry) => [entry.task.id, entry]));
        for (const task of tasks) {
          if (!combined.has(task.id)) combined.set(task.id, { task });
        }
        return [...combined.values()];
      });
      setListState("ready");
    } catch (error) {
      if (scope.signal.aborted) return;
      if (error instanceof ApiError && error.status === 401) expire(epoch);
      else setListState("error");
    }
  }, [epoch, expire, templateId]);

  useEffect(() => {
    const scope = new AbortController();
    const pending = inFlight.current;
    currentScope.current = scope;
    queueMicrotask(() => {
      if (!scope.signal.aborted) void load(scope);
    });
    return () => {
      scope.abort();
      pending.clear();
      currentScope.current = null;
    };
  }, [load]);

  const reconcile = useCallback(async (id: string, scope: AbortController) => {
    try {
      if (!await verify(epoch, userId, scope.signal)) return;
      const { tasks } = await api<{ tasks: Task[] }>(listPath(templateId), { signal: scope.signal });
      if (scope.signal.aborted) return;
      const task = tasks.find((item) => item.id === id);
      setEntries((current) => current.flatMap((entry) => {
        if (entry.task.id !== id) return [entry];
        if (!task) return [];
        return [{ task, unavailable: task.status === "PENDING" || task.status === "PROCESSING" }];
      }));
    } catch (error) {
      if (!scope.signal.aborted && error instanceof ApiError && error.status === 401) expire(epoch);
    }
  }, [epoch, expire, templateId, userId, verify]);

  const query = useCallback(async (id: string) => {
    const scope = currentScope.current;
    if (!scope || scope.signal.aborted || inFlight.current.has(id)) return;
    inFlight.current.add(id);
    try {
      const task = await api<Task>("/api/tasks/" + encodeURIComponent(id), { signal: scope.signal });
      if (scope.signal.aborted) return;
      setEntries((current) => current.map((entry) => entry.task.id === id ? { task } : entry));
    } catch (error) {
      if (scope.signal.aborted) return;
      if (error instanceof ApiError && error.status === 401) {
        expire(epoch);
      } else if (error instanceof ApiError && error.status === 404) {
        setEntries((current) => current.map((entry) => entry.task.id === id ? { task: entry.task, unavailable: true } : entry));
        await reconcile(id, scope);
      } else {
        setEntries((current) => current.map((entry) => entry.task.id === id ? { ...entry, queryError: true } : entry));
      }
    } finally {
      if (currentScope.current === scope) inFlight.current.delete(id);
    }
  }, [epoch, expire, reconcile]);

  const tracked = JSON.stringify(entries.filter(({ task, unavailable }) =>
    !unavailable && (task.status === "PENDING" || task.status === "PROCESSING"),
  ).map(({ task }) => task.id));

  useEffect(() => {
    const ids = JSON.parse(tracked) as string[];
    if (ids.length === 0) return;
    const timer = setInterval(() => { for (const id of ids) void query(id); }, 2000);
    return () => clearInterval(timer);
  }, [query, tracked]);

  return {
    entries,
    listState,
    add: (task: Task) => setEntries((current) => [{ task }, ...current.filter((entry) => entry.task.id !== task.id)]),
    retry: query,
    reload: () => {
      if (!currentScope.current) return;
      setListState("loading");
      void load(currentScope.current);
    },
    reconcile: (id: string) => {
      if (currentScope.current) void reconcile(id, currentScope.current);
    },
  };
}
