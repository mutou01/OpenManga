import { expect, type Page, test } from "@playwright/test";
import { api, expectNoErrors, seedPlannedProject, sharedPage } from "./helpers.ts";

// Why is this stale: an out-of-date stage on the production card opens what changed under it and what an update redoes.

let page: Page;
let errors: string[];
let s: Awaited<ReturnType<typeof seedPlannedProject>>;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  ({ page, errors } = await sharedPage(browser, "why-stale"));
  s = await seedPlannedProject(page, "E2E why stale");
});
test.afterAll(() => page?.context().close());
test.afterEach(() => expectNoErrors(errors));

test("why stale: a chapter whose text changed after planning is explained on the overview", async () => {
  const a = api(page);
  const { chapter } = await a.get<{ chapter: { sourceExcerpt: string } }>(`/chapters/${s.chapterId}`);
  await a.patch(`/chapters/${s.chapterId}`, { sourceExcerpt: `${chapter.sourceExcerpt}\nThe rain stopped.` });
  await page.goto(s.url);
  await page.getByRole("button", { name: /^规划 \d+$/ }).click();
  const why = page.getByRole("region", { name: "规划过期原因" });
  await expect(why.getByText(/^规划后原文已修改/)).toBeVisible();
  await expect(why.getByText(/^更新后将 · 重新规划将替换 \d+ 页/)).toBeVisible();
});
