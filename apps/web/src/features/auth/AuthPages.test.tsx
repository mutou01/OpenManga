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
import { ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage } from "./AuthPages.tsx";
import { InvitePage } from "./InvitePage.tsx";

test.each([
  ["/login", LoginPage, ["登录", "用户名或邮箱", "忘记密码"]],
  ["/register", RegisterPage, ["创建账号", "用户名", "确认密码"]],
  ["/forgot-password", ForgotPasswordPage, ["重置密码", "发送重置链接"]],
  ["/reset-password", ResetPasswordPage, ["链接无效", "申请新链接"]],
  ["/invite", InvitePage, ["邀请不可用", "前往 OpenManga"]],
] as const)("shows Chinese account controls on %s", async (path, component, labels) => {
  const root = createRootRoute();
  const route = createRoute({ getParentRoute: () => root, path, component });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  const html = renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  const visibleText = html.replace(/<[^>]*>/g, "");
  for (const label of labels) expect(visibleText).toContain(label);
});
