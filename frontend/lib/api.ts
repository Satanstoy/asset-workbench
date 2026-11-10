export type User = { id: string; displayName: string };
export type Session = { user: User | null };

export type Template = {
  id: string;
  title: string;
  category: string;
  coverUrl: string;
  description: string;
  requiredImageCount: number;
  acceptedMimeTypes: string[];
  maxFileSizeBytes: number;
  maxImagePixels: number;
};

export type TemplateList = { categories: string[]; templates: Template[] };
export type Asset = { id: string; mimeType: string; sizeBytes: number };
export type Task = {
  id: string;
  templateId: string;
  templateTitle: string;
  createdAt: string;
  status: "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED";
  stage: "CHECK_ASSETS" | "GENERATE" | "FINALIZE" | null;
  resultUrl: string | null;
  failure: { code: string; message: string } | null;
};

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const caller = options.signal;
  const cancel = () => controller.abort();
  if (caller?.aborted) cancel();
  caller?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(cancel, 10_000);
  try {
    const response = await fetch(path, { ...options, cache: "no-store", signal: controller.signal });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new ApiError(response.status, body?.error?.message ?? "请求失败，请稍后再试");
    }
    return await response.json() as T;
  } finally {
    clearTimeout(timer);
    caller?.removeEventListener("abort", cancel);
  }
}

export function jsonPost(body: unknown, signal?: AbortSignal): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal };
}

export function errorMessage(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}
