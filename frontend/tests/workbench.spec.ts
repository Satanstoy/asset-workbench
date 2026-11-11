import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { mockApi, png, task } from "./api-mock";

const image = (name = "photo.png") => ({ name, mimeType: "image/png", buffer: png });
const slot = (page: Page, number: number) => page.getByLabel(`素材 ${number}`, { exact: true });
const card = (page: Page, id: string) => page.getByRole("article", { name: `任务 ${id}` });
const start = (page: Page) => page.getByRole("button", { name: "开始制作" });
const enter = async (page: Page, identity: "A" | "B") => {
  await page.getByRole("button", { name: "账户设置" }).click();
  const dialog = page.getByRole("dialog", { name: "账户设置" });
  await dialog.getByRole("button", { name: `演示用户 ${identity}` }).click();
  await expect(dialog).toContainText(`当前：演示用户 ${identity}`);
  await dialog.getByRole("button", { name: "关闭账户设置" }).click();
};

test("分类写入 URL，刷新、返回详情及错误状态均可恢复", async ({ page, context }) => {
  const mock = await mockApi(context);
  mock.templatesStatus = 503;
  await page.goto("/");
  await expect(page.getByText("模板加载失败")).toBeVisible();
  mock.templatesStatus = 200;
  await page.getByRole("button", { name: "重试" }).click();
  await page.getByRole("link", { name: "创意图片", exact: true }).click();
  await expect(page).toHaveURL(/category=/);
  await expect(page.getByRole("link", { name: /旅行明信片/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /双图拼贴/ })).toHaveCount(0);
  await page.reload();
  await page.getByRole("link", { name: /旅行明信片/ }).click();
  await expect(page.getByRole("heading", { name: "旅行明信片" })).toBeVisible();
  await expect(page.getByText(/2500 万像素/)).toBeVisible();
  await page.getByRole("link", { name: "返回模板列表" }).click();
  await expect(page).toHaveURL(/category=/);
  await page.goto("/?category=empty");
  await expect(page.getByText("暂无符合条件的模板")).toBeVisible();
  await page.goto("/templates/missing");
  await expect(page.getByText("找不到制作模板")).toBeVisible();
});

test("各上传位独立，替换失败保留新图并禁止提交，移除和重试有效", async ({ page, context }) => {
  const mock = await mockApi(context);
  await page.goto("/templates/collage");
  await expect(page.getByText("选择演示身份后可以上传素材")).toBeVisible();
  await enter(page, "A");
  await expect(slot(page, 1)).toBeVisible();
  await expect(slot(page, 2)).toBeVisible();
  await slot(page, 1).setInputFiles(image("甲.png"));
  await slot(page, 2).setInputFiles(image("第二张.png"));
  await expect(start(page)).toBeEnabled();

  mock.onUpload = async (route) => {
    await route.fulfill({ status: 400, json: { error: { message: "图片超过像素限制" } } });
    return true;
  };
  await slot(page, 1).setInputFiles(image("乙.png"));
  await expect(page.getByText("乙.png")).toBeVisible();
  await expect(page.getByText("图片超过像素限制")).toBeVisible();
  await expect(page.getByText("第二张.png")).toBeVisible();
  await expect(start(page)).toBeDisabled();
  mock.onUpload = undefined;
  await page.getByRole("button", { name: "重试上传素材 1" }).click();
  await expect(start(page)).toBeEnabled();
  await page.getByRole("button", { name: "移除素材 2" }).click();
  await expect(start(page)).toBeDisabled();

  const uploads = mock.uploadCount;
  await slot(page, 2).setInputFiles({ name: "wrong.txt", mimeType: "text/plain", buffer: Buffer.from("no") });
  await expect(page.getByText("请选择符合模板格式要求的图片")).toBeVisible();
  await slot(page, 2).setInputFiles({
    name: "big.png", mimeType: "image/png", buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
  });
  await expect(page.getByText("图片超过文件大小限制")).toBeVisible();
  expect(mock.uploadCount).toBe(uploads);
});

test("上传请求晚到时无法恢复已经移除的素材", async ({ page, context }) => {
  const mock = await mockApi(context);
  let finish: (() => void) | undefined;
  mock.onUpload = async (route) => {
    await new Promise<void>((resolve) => { finish = resolve; });
    await route.fulfill({ status: 201, json: { id: "old", mimeType: "image/png", sizeBytes: 10 } }).catch(() => {});
    return true;
  };
  await page.goto("/templates/postcard");
  await enter(page, "A");
  await slot(page, 1).setInputFiles(image());
  await expect.poll(() => Boolean(finish)).toBe(true);
  await page.getByRole("button", { name: "移除素材 1" }).click();
  finish?.();
  await expect(page.getByText("photo.png")).toHaveCount(0);
  await expect(start(page)).toBeDisabled();
});

test("提交返回 202 后留在详情并保留素材，两项任务独立更新且终态停查", async ({ page, context }) => {
  await page.clock.install();
  const mock = await mockApi(context);
  await page.goto("/templates/postcard");
  await enter(page, "A");
  await slot(page, 1).setInputFiles(image());
  await start(page).click();
  await expect(card(page, "1")).toContainText("等待处理");
  await expect(start(page)).toBeEnabled();
  await start(page).click();
  await expect(card(page, "2")).toContainText("等待处理");
  expect(mock.submissions.map(({ assetIds }) => assetIds)).toEqual([["asset-1"], ["asset-1"]]);
  await expect(page).toHaveURL(/templates\/postcard/);

  mock.onTask = async (route, id) => {
    if (id !== "1") return false;
    await route.fulfill({ status: 503, json: { error: { message: "不可用" } } });
    return true;
  };
  mock.tasks.set("2", { owner: "demo-a", task: task("2", { status: "SUCCEEDED", stage: "FINALIZE", resultUrl: "/api/demo-images/result.png" }) });
  await page.clock.runFor(2100);
  await expect(card(page, "1")).toContainText("暂时无法更新进度");
  await expect(card(page, "1")).toContainText("等待处理");
  await expect(card(page, "2")).toContainText("成功");
  const finishedReads = mock.taskReads.get("2");

  mock.onTask = undefined;
  mock.tasks.set("1", { owner: "demo-a", task: task("1", { status: "FAILED", stage: "GENERATE", failure: { code: "SIM", message: "模拟失败" } }) });
  await card(page, "1").getByRole("button", { name: "立即重试" }).click();
  await expect(card(page, "1")).toContainText("模拟生成");
  await expect(card(page, "1")).toContainText("模拟失败");
  await expect(card(page, "1")).not.toContainText("暂时无法更新进度");
  expect(mock.taskReads.get("2")).toBe(finishedReads);
  const completed = new Map(mock.taskReads);
  await page.clock.runFor(4500);
  expect(mock.taskReads).toEqual(completed);
});

test("受理结果未知时保留当前选图，个人历史在新标签页打开", async ({ page, context }) => {
  const mock = await mockApi(context);
  mock.onSubmit = async (route) => {
    await route.fulfill({ status: 503, json: { error: { message: "服务不可用" } } });
    return true;
  };
  await page.goto("/templates/postcard");
  await enter(page, "A");
  await slot(page, 1).setInputFiles(image());
  await start(page).click();
  await expect(page.getByText(/无法确认是否受理/)).toBeVisible();
  const popup = context.waitForEvent("page");
  await page.getByRole("link", { name: "查看个人历史（新标签页）" }).click();
  const history = await popup;
  await expect(history.getByRole("heading", { name: "个人历史" })).toBeVisible();
  await expect(page.getByText("photo.png")).toBeVisible();
  expect(mock.submissions).toHaveLength(1);
});

test("刷新恢复任务，切换演示身份时忽略旧响应", async ({ page, context }) => {
  const mock = await mockApi(context);
  mock.tasks.set("old", { owner: "demo-a", task: task("old") });
  mock.tasks.set("new", { owner: "demo-b", task: task("new") });
  await page.goto("/templates/postcard");
  await enter(page, "A");
  await slot(page, 1).setInputFiles(image());
  await expect(card(page, "old")).toBeVisible();
  await page.reload();
  await expect(card(page, "old")).toBeVisible();
  await expect(page.getByText("photo.png")).toHaveCount(0);

  let finish: (() => void) | undefined;
  mock.onTask = async (route, id) => {
    if (id !== "old") return false;
    await new Promise<void>((resolve) => { finish = resolve; });
    await route.fulfill({ status: 401, json: { error: { message: "会话过期" } } }).catch(() => {});
    return true;
  };
  await expect.poll(() => Boolean(finish), { timeout: 7000 }).toBe(true);
  await enter(page, "B");
  await expect(card(page, "new")).toBeVisible();
  finish?.();
  await expect(card(page, "old")).toHaveCount(0);
  await expect(card(page, "new")).toBeVisible();
});

test("任务 404 核对列表后移除，当前会话 401 提示重选，结果图可独立重试", async ({ page, context }) => {
  const mock = await mockApi(context);
  mock.tasks.set("missing", { owner: "demo-a", task: task("missing") });
  mock.tasks.set("result", { owner: "demo-a", task: task("result", {
    status: "SUCCEEDED", stage: "FINALIZE", resultUrl: "/api/demo-images/result.png",
  }) });
  mock.previewFailures = 1;
  await page.goto("/history");
  await enter(page, "A");
  await expect(card(page, "missing")).toBeVisible();
  await expect(card(page, "result")).toContainText("预览暂不可用");
  await expect(card(page, "result")).toContainText("成功");
  await card(page, "result").getByRole("button", { name: "重试预览" }).click();
  await expect(card(page, "result").getByRole("img", { name: "制作结果" })).toBeVisible();
  const lists = mock.taskLists;
  mock.tasks.delete("missing");
  await expect(card(page, "missing")).toHaveCount(0, { timeout: 7000 });
  expect(mock.taskLists).toBeGreaterThan(lists);
  expect(mock.taskReads.get("missing")).toBe(1);

  mock.tasks.set("expired", { owner: "demo-a", task: task("expired") });
  await page.reload();
  await expect(card(page, "expired")).toBeVisible();
  mock.identity = null;
  await expect(page.getByText("请选择演示身份后查看个人历史")).toBeVisible({ timeout: 7000 });
  await expect(card(page, "expired")).toHaveCount(0);
});

test("小屏和键盘能够访问身份、模板及上传控件", async ({ page, context }) => {
  await mockApi(context);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/templates/collage");
  const settings = page.getByRole("button", { name: "账户设置" });
  const dialog = page.getByRole("dialog", { name: "账户设置" });
  await settings.focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(settings).toBeFocused();
  await enter(page, "A");
  await expect(slot(page, 1)).toBeVisible();
  await expect(slot(page, 2)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("个人历史加载失败可重试，离开页面后停止跟踪", async ({ page, context }) => {
  await page.clock.install();
  const mock = await mockApi(context);
  mock.historyStatus = 503;
  await page.goto("/history");
  await enter(page, "A");
  await expect(page.getByText("个人历史加载失败")).toBeVisible();
  mock.historyStatus = 200;
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.getByText("暂无制作任务")).toBeVisible();

  mock.tasks.set("active", { owner: "demo-a", task: task("active") });
  await page.reload();
  await expect(card(page, "active")).toBeVisible();
  await page.clock.runFor(2100);
  await expect.poll(() => mock.taskReads.get("active")).toBeGreaterThan(0);
  await page.getByRole("link", { name: "模板列表", exact: true }).click();
  await expect(page.getByRole("heading", { name: "模板列表" })).toBeVisible();
  const reads = mock.taskReads.get("active");
  await page.clock.runFor(4500);
  expect(mock.taskReads.get("active")).toBe(reads);
});

test("桌面制作区和任务区并排，小屏按操作顺序排列", async ({ page, context }) => {
  await mockApi(context);
  await page.goto("/templates/collage");
  await enter(page, "A");
  const upload = page.getByRole("form", { name: "上传素材" });
  const tasks = page.getByRole("region", { name: "制作任务" });
  await expect(upload).toBeVisible();
  await expect(tasks).toBeVisible();
  const desktopUpload = (await upload.boundingBox())!;
  const desktopTasks = (await tasks.boundingBox())!;
  expect(desktopTasks.x).toBeGreaterThanOrEqual(desktopUpload.x + desktopUpload.width);
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileUpload = (await upload.boundingBox())!;
  const mobileTasks = (await tasks.boundingBox())!;
  expect(mobileTasks.y).toBeGreaterThanOrEqual(mobileUpload.y + mobileUpload.height);
});
