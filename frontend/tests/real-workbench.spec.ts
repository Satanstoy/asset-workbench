import { expect, test } from "@playwright/test";

test.skip(process.env.PLAYWRIGHT_REAL_API !== "1", "需要可访问的 Java + MySQL，且启用模拟控制");

test("同源接口完成真实上传、制作、刷新恢复、失败展示和身份隔离", async ({ page }) => {
  const selectIdentity = async (letter: "A" | "B", trigger = "账户设置") => {
    await page.getByRole("button", { name: trigger }).click();
    const dialog = page.getByRole("dialog", { name: "账户设置" });
    await dialog.getByRole("button", { name: `演示用户 ${letter}` }).click();
    await expect(dialog).toContainText(`当前：演示用户 ${letter}`);
    const session = await page.request.get("/api/session");
    expect(await session.json()).toMatchObject({ user: { id: `demo-${letter.toLowerCase()}` } });
    await dialog.getByRole("button", { name: "关闭账户设置" }).click();
  };
  const sample = await page.request.get("/api/demo-images/postcard-cover.png");
  expect(sample.ok()).toBe(true);
  const buffer = await sample.body();
  await page.goto("/");
  await page.getByRole("link", { name: "创意图片", exact: true }).click();
  await page.getByRole("link", { name: /旅行明信片/ }).click();
  await expect(page.getByText("选择演示身份后可以上传素材")).toBeVisible();
  expect((await page.request.get("/api/tasks")).status()).toBe(401);
  await selectIdentity("A", "选择演示身份");

  const uploaded = page.waitForResponse((response) =>
    response.url().endsWith("/api/assets") && response.request().method() === "POST");
  await page.getByLabel("素材 1", { exact: true }).setInputFiles({
    name: "postcard-sample.png", mimeType: "image/png", buffer,
  });
  const uploadResponse = await uploaded;
  expect(uploadResponse.status()).toBe(201);
  const asset = await uploadResponse.json();

  const submitted = page.waitForResponse((response) =>
    response.url().endsWith("/api/tasks") && response.request().method() === "POST");
  await page.getByRole("button", { name: "开始制作" }).click();
  const submission = await submitted;
  expect(submission.status()).toBe(202);
  const first = await submission.json();
  const firstCard = page.getByRole("article", { name: `任务 ${first.id}` });
  await expect(firstCard).toBeVisible();
  await page.reload();
  await expect(firstCard).toBeVisible();
  await expect(page.getByText("postcard-sample.png")).toHaveCount(0);
  await page.getByRole("link", { name: "查看个人历史", exact: true }).click();
  await expect(firstCard).toContainText("成功", { timeout: 15_000 });
  const preview = firstCard.getByRole("img", { name: "制作结果" });
  await expect.poll(() => preview.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

  const failedSubmission = await page.request.post("/api/tasks", {
    data: {
      templateId: "postcard", assetIds: [asset.id],
      simulation: { stageDelayMs: 0, failAtStage: "GENERATE" },
    },
  });
  expect(failedSubmission.status()).toBe(202);
  const failed = await failedSubmission.json();
  const failedCard = page.getByRole("article", { name: `任务 ${failed.id}` });
  await page.reload();
  await expect(failedCard).toContainText("此制作阶段模拟失败");
  await expect(failedCard).toContainText("模拟生成");

  await selectIdentity("B");
  await expect(page.getByRole("button", { name: "账户设置" })).toContainText("演示用户 B");
  await expect(firstCard).toHaveCount(0);
  await expect(failedCard).toHaveCount(0);
  expect((await page.request.get(`/api/tasks/${first.id}`)).status()).toBe(404);
  await selectIdentity("A");
  await expect(firstCard).toBeVisible();
  await expect(failedCard).toBeVisible();

  await page.goto("/templates/postcard");
  const tasks = page.getByRole("region", { name: "制作任务" });
  await expect(tasks.getByRole("article", { name: `任务 ${first.id}` })).toContainText("示例结果");
  await expect(tasks.getByRole("article", { name: `任务 ${failed.id}` })).toContainText("此制作阶段模拟失败");
});

test("双图成品使用两张上传图，且只能由所属账户预览", async ({ page }) => {
  await page.goto("/templates/collage");
  await page.getByRole("button", { name: "选择演示身份", exact: true }).click();
  const account = page.getByRole("dialog", { name: "账户设置" });
  await account.getByRole("button", { name: "演示用户 A" }).click();
  await expect(account).toContainText("当前：演示用户 A");
  await account.getByRole("button", { name: "关闭账户设置" }).click();

  for (const [index, color] of ["#ff0000", "#0000ff"].entries()) {
    const encoded = await page.evaluate((fill) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 32;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, 32, 32);
      return canvas.toDataURL("image/png").split(",")[1];
    }, color);
    await page.getByLabel(`素材 ${index + 1}`, { exact: true }).setInputFiles({
      name: `slot-${index + 1}.png`, mimeType: "image/png", buffer: Buffer.from(encoded, "base64"),
    });
  }

  const submitted = page.waitForResponse((response) =>
    response.url().endsWith("/api/tasks") && response.request().method() === "POST");
  await page.getByRole("button", { name: "开始制作" }).click();
  const submission = await submitted;
  expect(submission.status()).toBe(202);
  const { id } = await submission.json();
  const card = page.getByRole("article", { name: `任务 ${id}` });
  await expect(card).toContainText("成功", { timeout: 15_000 });
  const preview = card.getByRole("img", { name: "制作结果" });
  await expect.poll(() => preview.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  const pixels = await preview.evaluate((img: HTMLImageElement) => {
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    return [0.25, 0.75].map((x) => [...ctx.getImageData(canvas.width * x, canvas.height / 2, 1, 1).data]);
  });
  expect(pixels).toEqual([[255, 0, 0, 255], [0, 0, 255, 255]]);
  const url = await preview.evaluate((img: HTMLImageElement) => img.src);
  expect(new URL(url).origin).toBe(new URL(page.url()).origin);
  expect(new URL(url).pathname).toBe(`/api/tasks/${id}/result`);
  await page.reload();
  await expect(card.getByRole("img", { name: "制作结果" })).toBeVisible();
  const settings = page.getByRole("button", { name: "账户设置" });
  await expect(settings).toContainText("账户设置");
  await settings.click();
  await expect(account).toContainText("demo-a");
  await account.getByRole("button", { name: "演示用户 B" }).click();
  await expect(account).toContainText("当前：演示用户 B");
  await account.getByRole("button", { name: "关闭账户设置" }).click();
  await expect(card).toHaveCount(0);
  expect((await page.request.get(url)).status()).toBe(404);
});
