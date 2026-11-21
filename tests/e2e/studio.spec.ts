import { expect, type Page, test } from "@playwright/test";

const STORY = `Chapter 1: The Rooftop

Rain hammered the city as Woo Jin climbed onto the rooftop. Woo Jin pulled his jacket tighter.
Footsteps echoed from the stairwell. "Who's there?" Woo Jin asked.
Kim Do-yun stepped out of the shadows. Kim Do-yun smiled.
"You shouldn't have come alone," Kim Do-yun said. The door slammed shut with a BANG.`;

const id = Date.now().toString(36);
const user = { username: `e2e_${id}`, email: `e2e_${id}@example.com`, password: "e2e-password-123" };

/** Collect uncaught page errors and app console errors (ignores third-party injections such as CDN beacons). */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    const t = m.text();
    if (
      m.type() === "error" &&
      !/Failed to load resource|EventSource|net::ERR|Content Security Policy|cloudflareinsights/.test(t)
    )
      errors.push(`console: ${t}`);
  });
  return errors;
}

test("full studio flow in the browser (mock AI)", async ({ page }) => {
  const errors = watchErrors(page);

  await test.step("register", async () => {
    await page.goto("/app/register");
    await page.getByLabel("用户名").fill(user.username);
    await page.getByLabel("邮箱").fill(user.email);
    await page.getByLabel("密码（至少 10 个字符）").fill(user.password);
    await page.getByLabel("确认密码").fill(user.password);
    await page.getByRole("button", { name: "创建账号" }).click();
    await expect(page.getByRole("heading", { name: "项目", exact: true })).toBeVisible();
  });

  await test.step("logout and login with username", async () => {
    await page.getByRole("button", { name: "退出登录" }).click();
    await expect(page.getByRole("heading", { name: "登录" })).toBeVisible();
    await page.getByLabel("用户名或邮箱").fill(user.username);
    await page.getByLabel("密码", { exact: true }).fill(user.password);
    await page.getByRole("button", { name: "登录" }).click();
    await expect(page.getByRole("heading", { name: "项目", exact: true })).toBeVisible();
  });

  await test.step("wizard: create project, analyze, review, apply", async () => {
    await page.getByRole("link", { name: "新建项目" }).click();
    await page.getByLabel("标题").fill(`E2E ${id}`);
    await page.getByRole("button", { name: "下一步" }).click();
    await page.getByLabel(/粘贴故事/).fill(STORY);
    await page.getByRole("button", { name: /创建并分析/ }).click();
    await page.getByRole("button", { name: "审核" }).click({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: /角色（/ })).toBeVisible();
    await page.getByRole("button", { name: /应用到项目/ }).click();
    await expect(page.getByRole("heading", { name: "制作流程" })).toBeVisible({ timeout: 30_000 });
  });

  const projectUrl = page.url().replace(/\/$/, "");

  await test.step("cast: generate a full-resolution reference and approve it", async () => {
    await page.goto(`${projectUrl}/cast`);
    await page.getByText("Woo Jin", { exact: true }).first().click();
    await expect(page.getByText("Appearance v1")).toBeVisible();
    await page.getByRole("button", { name: "Generate", exact: true }).click();
    const approve = page.getByRole("button", { name: "Approve", exact: true }).last();
    await expect(async () => {
      await expect(page.getByRole("img", { name: /portrait|reference/i }).first()).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 60_000 });
    await approve.click();
    await expect(page.getByText(/prompt ref/i).first()).toBeVisible({ timeout: 15_000 });
  });

  await test.step("chapters: plan the chapter", async () => {
    await page.goto(`${projectUrl}/chapters`);
    await page.getByRole("button", { name: "Plan chapter" }).first().click();
    await expect(async () => {
      await page.goto(`${projectUrl}/pages`);
      await expect(page.getByRole("link", { name: "Open page 1 in editor" })).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 60_000 });
  });

  await test.step("page editor: select panel, generate, versions, add bubble", async () => {
    await page.getByRole("link", { name: "Open page 1 in editor" }).click();
    await expect(page.getByLabel("Page canvas")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("tab", { name: "Panel" }).click();
    await page.locator("aside button, [role=tabpanel] button").filter({ hasText: /^1/ }).first().click();
    await page.getByRole("tab", { name: "Prompt" }).click();
    await page
      .getByRole("button", { name: /^(Generate|Regenerate)$/ })
      .first()
      .click();
    await page.getByRole("tab", { name: "Versions" }).click();
    await expect(
      page
        .getByRole("img")
        .filter({ hasNot: page.locator("canvas") })
        .first(),
    ).toBeVisible({ timeout: 60_000 });
    await page.getByRole("tab", { name: "Lettering" }).click();
    await page.getByLabel("New bubble text").fill("Who's there?");
    await page
      .getByRole("button", { name: /Add bubble/ })
      .first()
      .click();
    await expect(page.getByText("Who's there?").first()).toBeVisible();
  });

  await test.step("every screen renders without crashing", async () => {
    for (const path of [
      "",
      "/story",
      "/cast",
      "/world",
      "/chapters",
      "/pages",
      "/generation",
      "/narration",
      "/assets",
      "/exports",
      "/usage",
      "/settings",
    ]) {
      await page.goto(`${projectUrl}${path}`);
      await expect(page.locator("main")).toBeVisible();
      await page.waitForTimeout(800);
      await expect(page.getByText("发生错误")).toHaveCount(0);
    }
    for (const path of ["/app/usage", "/app/account", "/app/admin", "/app/"]) {
      await page.goto(path);
      await page.waitForTimeout(500);
    }
  });

  await test.step("generation inspector shows compiled prompt", async () => {
    await page.goto(`${projectUrl}/generation`);
    await page.getByRole("link", { name: "画格", exact: true }).first().click();
    await expect(page.getByText("STRICT EXCLUSIONS:").first()).toBeVisible();
  });

  await test.step("exports: queue a page export and see it complete", async () => {
    await page.goto(`${projectUrl}/exports`);
    await page.getByRole("button", { name: "Export", exact: true }).click();
    // Only one panel was generated earlier, so the readiness check blocks and asks to confirm.
    // Auto-waits for the dialog rather than probing before the request has come back.
    await page
      .getByRole("button", { name: "Export anyway" })
      .click({ timeout: 15_000 })
      .catch(() => {});
    await expect(page.getByText("已完成").first()).toBeVisible({ timeout: 60_000 });
  });

  await test.step("exports: run a print preflight and read its report with the soft proof", async () => {
    await page.goto(`${projectUrl}/exports`);
    await page
      .getByRole("combobox", { name: /^Format/ })
      .first()
      .selectOption("print_preflight");
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await page
      .getByRole("button", { name: "Export anyway" })
      .click({ timeout: 15_000 })
      .catch(() => {});
    const report = page.getByTestId("preflight-report");
    await expect(report).toBeVisible({ timeout: 90_000 });
    await expect(report.getByText(/Lowest \d+ DPI/)).toBeVisible();
    await expect(report.getByAltText("Page soft-proofed for print")).toBeVisible();
  });

  await test.step("exports: queue a layered PSD export and see its file", async () => {
    await page.goto(`${projectUrl}/exports`);
    await page
      .getByRole("combobox", { name: /^Format/ })
      .first()
      .selectOption("psd_pages");
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await page
      .getByRole("button", { name: "Export anyway" })
      .click({ timeout: 15_000 })
      .catch(() => {});
    await expect(page.getByRole("link", { name: /(\.psd|_psd\.zip)/ }).first()).toBeVisible({ timeout: 90_000 });
  });

  expect(errors, errors.join("\n")).toEqual([]);
});
