import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { qk } from "../api/hooks.ts";

test("desktop header places the Chinese language selector between the account and sign-out controls", async () => {
  const buildGlobal = Object.getOwnPropertyDescriptor(globalThis, "__WEB_BUILD__");
  const documentGlobal = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "__WEB_BUILD__", {
    configurable: true,
    value: { version: "test", builtAt: null, sha: null },
  });
  try {
    const { AppShell } = await import("./AppShell.tsx");
    const root = createRootRoute();
    const home = createRoute({ getParentRoute: () => root, path: "/", component: AppShell });
    const router = createRouter({ routeTree: root.addChildren([home]), history: createMemoryHistory() });
    await router.load();
    const client = new QueryClient();
    client.setQueryData(qk.me, { username: "studio-owner", role: "user" });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { documentElement: { classList: { contains: () => false } } },
    });
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    expect(html).toContain("studio-owner");
    expect(html).toContain('aria-label="语言"');
    expect(html).toContain('<option value="zh-CN" selected="">简体中文</option>');
    expect(html.indexOf("studio-owner")).toBeLessThan(html.indexOf('aria-label="语言"'));
    expect(html.indexOf('aria-label="语言"')).toBeLessThan(html.indexOf('aria-label="退出登录"'));
    expect(html).toMatch(/>\s*系列<\/a>/);
    expect(html).toContain('aria-label="通知"');
  } finally {
    if (documentGlobal) Object.defineProperty(globalThis, "document", documentGlobal);
    else Reflect.deleteProperty(globalThis, "document");
    if (buildGlobal) Object.defineProperty(globalThis, "__WEB_BUILD__", buildGlobal);
    else Reflect.deleteProperty(globalThis, "__WEB_BUILD__");
  }
});
