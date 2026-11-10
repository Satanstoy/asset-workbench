"use client";

import { useEffect, useState } from "react";
import { api } from "./api";

type Resource<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; error: unknown };

export function useResource<T>(url: string) {
  const [resource, setResource] = useState<Resource<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api<T>(url, { signal: controller.signal }).then(
      (data) => { if (!controller.signal.aborted) setResource({ status: "ready", data }); },
      (error) => { if (!controller.signal.aborted) setResource({ status: "error", error }); },
    );
    return () => controller.abort();
  }, [url, attempt]);
  return {
    resource,
    retry: () => {
      setResource({ status: "loading" });
      setAttempt((current) => current + 1);
    },
  };
}
