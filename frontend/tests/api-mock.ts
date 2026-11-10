import type { BrowserContext, Route } from "@playwright/test";

export const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jpMsAAAAASUVORK5CYII=",
  "base64",
);

const coverUrl = "/api/demo-images/example.png";
const categories = ["创意图片", "拼贴设计"];
export const templates = [
  { id: "postcard", title: "旅行明信片", category: categories[0], requiredImageCount: 1 },
  { id: "collage", title: "双图拼贴", category: categories[1], requiredImageCount: 2 },
].map((template) => ({
  ...template, coverUrl, description: "模拟制作图片",
  acceptedMimeTypes: ["image/jpeg", "image/png"], maxFileSizeBytes: 5242880, maxImagePixels: 25000000,
}));

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

export function task(id: string, changes: Partial<Task> = {}): Task {
  return {
    id, templateId: "postcard", templateTitle: "旅行明信片", createdAt: "2026-11-10T00:00:00Z",
    status: "PENDING", stage: null, resultUrl: null, failure: null, ...changes,
  };
}

export async function mockApi(context: BrowserContext) {
  const state = {
    identity: null as string | null,
    tasks: new Map<string, { owner: string; task: Task }>(),
    taskReads: new Map<string, number>(),
    taskLists: 0,
    historyStatus: 200,
    sessionReads: 0,
    uploadCount: 0,
    submissions: [] as { templateId: string; assetIds: string[] }[],
    templatesStatus: 200,
    previewFailures: 0,
    onTask: undefined as ((route: Route, id: string) => Promise<boolean>) | undefined,
    onUpload: undefined as ((route: Route) => Promise<boolean>) | undefined,
    onSubmit: undefined as ((route: Route) => Promise<boolean>) | undefined,
  };

  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname, searchParams } = new URL(request.url());
    const method = request.method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    const error = (status: number, message: string) => json({ error: { code: "TEST", message } }, status);
    if (pathname === "/api/session") {
      if (method === "POST") {
        state.identity = request.postDataJSON().userId;
      } else {
        state.sessionReads++;
      }
      const user = state.identity && {
        id: state.identity, displayName: state.identity === "demo-a" ? "演示用户 A" : "演示用户 B",
      };
      return json({ user });
    }
    if (pathname === "/api/templates") {
      if (state.templatesStatus !== 200) return error(state.templatesStatus, "模板加载失败");
      const category = searchParams.get("category");
      return json({ categories, templates: templates.filter((item) => !category || category === item.category) });
    }
    if (pathname.startsWith("/api/templates/")) {
      const template = templates.find((item) => pathname.endsWith("/" + item.id));
      return template ? json(template) : error(404, "找不到制作模板");
    }
    if (pathname.startsWith("/api/demo-images/")) {
      if (pathname.includes("result") && state.previewFailures-- > 0) return error(503, "图片暂不可用");
      return route.fulfill({ contentType: "image/png", body: png });
    }
    if (!state.identity) return error(401, "请选择演示身份");
    if (pathname === "/api/assets") {
      state.uploadCount++;
      if (await state.onUpload?.(route)) return;
      return json({ id: "asset-" + state.uploadCount, mimeType: "image/png", sizeBytes: png.length }, 201);
    }
    if (pathname === "/api/tasks" && method === "POST") {
      const body = request.postDataJSON();
      state.submissions.push(body);
      if (await state.onSubmit?.(route)) return;
      const value = task(String(state.submissions.length), {
        templateId: body.templateId,
        templateTitle: templates.find((item) => item.id === body.templateId)?.title ?? "",
      });
      state.tasks.set(value.id, { owner: state.identity, task: value });
      return json(value, 202);
    }
    if (pathname === "/api/tasks") {
      state.taskLists++;
      if (state.historyStatus !== 200) return error(state.historyStatus, "个人历史加载失败");
      const active = searchParams.get("activeOnly") === "true";
      const templateId = searchParams.get("templateId");
      return json({ tasks: [...state.tasks.values()].reverse()
        .filter((entry) => entry.owner === state.identity)
        .map((entry) => entry.task)
        .filter((item) => !templateId || templateId === item.templateId)
        .filter((item) => !active || item.status === "PENDING" || item.status === "PROCESSING") });
    }
    if (pathname.startsWith("/api/tasks/")) {
      const id = pathname.slice("/api/tasks/".length);
      state.taskReads.set(id, (state.taskReads.get(id) ?? 0) + 1);
      if (await state.onTask?.(route, id)) return;
      const entry = state.tasks.get(id);
      return entry?.owner === state.identity ? json(entry.task) : error(404, "找不到制作任务");
    }
    return error(404, "unknown test route");
  });
  return state;
}
