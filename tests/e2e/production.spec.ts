import { expect, type Page, test } from "@playwright/test";
import { api, expectNoErrors, STORY, sharedPage, until } from "./helpers.ts";

// Production runs from the Overview page: a run to the end with the final-output gate and the Health page, Update
// production after a revised story (paused for review, chapters kept as they are), and stopping a run with its jobs.

let page: Page;
let errors: string[];

test.beforeAll(async ({ browser }) => {
  ({ page, errors } = await sharedPage(browser, "prod"));
});
test.afterAll(() => page?.context().close());
test.afterEach(() => expectNoErrors(errors));

type Run = {
  id: string;
  status: string;
  pendingJobs: number;
  steps: { key: string; status: string; jobIds?: string[] }[];
};

async function newProject(title: string) {
  const a = api(page);
  const { project } = await a.post<{ project: { id: string } }>("/projects", {
    title,
    story: { content: STORY, inputKind: "story" },
  });
  // A run spends without asking, so it needs a cap first.
  await a.patch(`/projects/${project.id}`, { settings: { budgetUsd: 50 } });
  return { id: project.id, url: `/app/projects/${project.id}` };
}

const card = () => page.locator(".card", { has: page.getByRole("heading", { name: "制作任务" }) });
/** The run's status line, e.g. "completed with warnings" (capitalised only by CSS). */
const runStatus = (re: RegExp) => card().locator("p > span.font-medium").filter({ hasText: re });

test("produce, the final-output gate, Health, then Update production after a revised story", async () => {
  test.setTimeout(420_000);
  const p = await newProject("E2E production");
  const a = api(page);

  await test.step("produce with review gates and the render off", async () => {
    await page.goto(p.url);
    await card().getByRole("button", { name: "一键制作" }).click();
    const d = page.getByRole("dialog", { name: "一键制作此项目" });
    // Priced before anything starts: the analysis, references and thumbnail still to do, and the budget left.
    const plan = d.getByRole("region", { name: "Cost plan" });
    await expect(plan.getByText(/^About \$\d/)).toBeVisible();
    await expect(plan.getByText(/left of \$50\.00/)).toBeVisible();
    await plan.getByText("By chapter").click();
    await expect(plan.getByRole("cell", { name: "Analysis" })).toBeVisible();
    await d.getByLabel(/暂停，等待审核/).uncheck();
    await d.getByLabel("制作完成后渲染视频").uncheck();
    await d.getByRole("button", { name: "开始" }).click();
    await expect(d).toBeHidden();
    await expect(runStatus(/^运行中$/)).toBeVisible();
  });

  await test.step("the run ends finished, or finished with its unresolved list", async () => {
    await expect(runStatus(/^已完成(，有待处理事项)?$/)).toBeVisible({ timeout: 240_000 });
    const { runs } = await a.get<{ runs: Run[] }>(`/projects/${p.id}/production-runs`);
    expect(["completed", "completed_with_warnings"]).toContain(runs[0]!.status);
    if (runs[0]!.status === "completed_with_warnings")
      await expect(card().getByText(/^制作已结束，仍有 \d+ 项待处理/)).toBeVisible();
    await expect(card().getByText("Draw references")).toBeVisible();
  });

  await test.step("Health shows the verdict", async () => {
    await page.goto(`${p.url}/health`);
    await expect(page.getByRole("heading", { name: "项目检查" })).toBeVisible();
    await expect(page.getByText(/(可发布|有 \d+ 项问题影响发布)$/).first()).toBeVisible();
    await expect(page.getByText(/^已花费 \$/)).toBeVisible();
  });

  await test.step("revise the story: Update production stops at the review", async () => {
    // A new chapter. Its heading lands in chapter 1's text, so chapter 1's plan goes out of date once applied.
    await a.post(`/projects/${p.id}/story/revisions`, {
      content: `${STORY}\n\nChapter 2: Dawn\n\nWoo Jin walked home at dawn. The city was quiet and grey.`,
    });
    await page.goto(p.url);
    await card().getByRole("button", { name: "更新制作" }).click();
    const d = page.getByRole("dialog", { name: "更新制作" });
    // Review gates off: a revised story's analysis still waits for the user.
    await d.getByLabel(/暂停，等待审核/).uncheck();
    await d.getByLabel("制作完成后渲染视频").uncheck();
    await d.getByRole("button", { name: "开始" }).click();
    await expect(d).toBeHidden();
    await expect(runStatus(/^等待中$/)).toBeVisible({ timeout: 60_000 });
    await expect(card().getByRole("link", { name: /在故事页审核/ })).toBeVisible();
  });

  await test.step("continue, and keep the changed chapter's plan as it is", async () => {
    await card().getByRole("button", { name: "继续" }).click();
    await expect(card().getByText(/^Chapters changed since they were planned — 1 chapter/)).toBeVisible({
      timeout: 60_000,
    });
    // No reload: the card refreshes what is out of date on every change to the run, waiting → waiting included.
    const stale = card().getByText("Chapters whose text changed after they were planned");
    await expect(stale).toBeVisible();
    await card().getByRole("button", { name: "Keep current" }).first().click();
    await expect(stale).toBeHidden();
    const { stalePlans } = await a.get<{ stalePlans: unknown[] }>(`/projects/${p.id}/staleness`);
    expect(stalePlans).toEqual([]);
  });
});

test("stopping a run cancels its queued jobs", async () => {
  const p = await newProject("E2E stop a run");
  const a = api(page);
  // Paste-mode text keeps the analysis waiting for an answer: a job the run queued that has not started.
  await a.post(`/projects/${p.id}/production-runs`, {
    reviewGates: false,
    render: false,
    ai: { text: { manual: true }, image: null },
  });
  const run = await until(async () => {
    const { runs } = await a.get<{ runs: Run[] }>(`/projects/${p.id}/production-runs`);
    return runs[0]?.pendingJobs ? runs[0] : null;
  }, "a queued job");
  const jobId = run.steps.find((st) => st.key === "analyze")!.jobIds![0]!;

  await page.goto(p.url);
  await expect(runStatus(/^运行中$/)).toBeVisible();
  await card().getByRole("button", { name: "停止" }).click();
  const d = page.getByRole("dialog", { name: "停止制作任务" });
  await expect(d.getByText("将取消 1 个尚未开始的任务。", { exact: false })).toBeVisible();
  await expect(d.getByLabel(/停止制作并取消排队任务/)).toBeChecked();
  await d.getByRole("button", { name: "停止" }).click();
  await expect(d).toBeHidden();
  await expect(runStatus(/^已取消$/)).toBeVisible();

  await page.goto(`${p.url}/generation/${jobId}`);
  await expect(page.getByText("已取消").first()).toBeVisible();
  const { job } = await a.get<{ job: { status: string } }>(`/generations/${jobId}`);
  expect(job.status).toBe("cancelled");
});
