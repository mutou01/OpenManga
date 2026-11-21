import { expect, test } from "bun:test";
import { documentTitle } from "./title.ts";

test("page, project and app name, in that order", () => {
  expect(documentTitle("Cast", { title: "Night Bus", format: "comic" })).toBe("角色 · Night Bus · OpenManga");
});

test("outside a project only the page is named", () => {
  expect(documentTitle("Projects")).toBe("项目 · OpenManga");
  expect(documentTitle(undefined)).toBe("OpenManga");
});

test("film projects say Shots, matching the sidebar", () => {
  const film = { title: "Night Bus", format: "film" };
  expect(documentTitle("Pages", film)).toBe("镜头 · Night Bus · OpenManga");
  expect(documentTitle("Page editor", film)).toBe("镜头编辑器 · Night Bus · OpenManga");
  expect(documentTitle("Cast", film)).toBe("角色 · Night Bus · OpenManga");
});
