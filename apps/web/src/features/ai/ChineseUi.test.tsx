import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { AccountPage } from "../account/AccountPage.tsx";
import { AdminPage } from "../admin/AdminPage.tsx";
import { StorageAlert } from "../admin/StorageAlert.tsx";
import { StorageTab, SummaryList } from "../admin/StorageTab.tsx";
import { AgentPage } from "../agent/AgentPage.tsx";
import { AgentsPage, GrantEditor } from "../agents/AgentsPage.tsx";
import { ConnectPage } from "../agents/ConnectPage.tsx";
import { ExpertActions } from "../experts/ExpertActions.tsx";
import { ExpertsPage } from "../experts/ExpertsPage.tsx";
import { ModelPicker, ProviderKeys } from "./AiPicker.tsx";

test("模型选择和密钥表单显示中文并保留模型及提供商标识", async () => {
  const client = new QueryClient();
  client.setQueryData(["ai-options"], {
    defaults: { text: null, image: null, tts: null },
    mockMode: false,
    credentials: [
      {
        id: "key-1",
        kind: "openai",
        label: "My OpenAI",
        keyHint: "…1234",
        createdAt: "2026-11-20T00:00:00Z",
        lastUsedAt: null,
      },
    ],
  });
  client.setQueryData(["ai-models", "key-1", "text"], { models: ["gpt-4.1"] });
  const root = createRootRoute();
  const route = createRoute({
    getParentRoute: () => root,
    path: "/account",
    component: () => (
      <>
        <ModelPicker cap="text" />
        <ProviderKeys />
      </>
    ),
  });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ["/account"] }),
  });
  await router.load();
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  for (const label of ["文本提供商", "模型", "手动粘贴", "验证并保存密钥"]) expect(html).toContain(label);
  expect(html).toContain("gpt-4.1");
  expect(html).toContain("My OpenAI");
  expect(html).toContain('value="openai"');
  expect(html).toContain('value="manual"');
});

test.each([
  ["/account", AccountPage, ["账号", "修改密码", "活跃会话", "旁白", "你的活动"]],
  ["/admin", AdminPage, ["管理", "用户", "生成任务", "存储", "活动"]],
  ["/projects/$projectId/agent", AgentPage, ["智能体", "目标", "制定计划", "执行记录"]],
  ["/agents", AgentsPage, ["智能体访问", "连接", "待你审批", "新建访问令牌"]],
  ["/experts", ExpertsPage, ["专家", "新建对话", "搜索对话", "创建自定义专家"]],
] satisfies [string, ComponentType, string[]][])(
  "页面 %s 通过公开路由展示中文控件",
  async (path, component, labels) => {
    const client = new QueryClient();
    client.setQueryData(["me"], { id: "user-1", username: "Example User", email: "test@example.com", role: "admin" });
    const root = createRootRoute();
    const route = createRoute({ getParentRoute: () => root, path, component });
    const router = createRouter({
      routeTree: root.addChildren([route]),
      history: createMemoryHistory({ initialEntries: [path.replace("$projectId", "project-1")] }),
    });
    await router.load();
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    const visible = html.replace(/<[^>]*>/g, "");
    for (const label of labels) expect(visible + html).toContain(label);
  },
);

async function renderPage(path: string, component: ComponentType, client = new QueryClient(), search = "") {
  const root = createRootRoute();
  const route = createRoute({ getParentRoute: () => root, path, component });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({
      initialEntries: [path.replace("$requestId", "request-1").replace("$chatId", "chat-1") + search],
    }),
  });
  await router.load();
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const agentInfo = {
  enabled: true,
  endpoint: "https://example.com/mcp",
  scopes: [{ scope: "projects:read", description: "View projects and project metadata." }],
  approvalTtlMinutes: 30,
};

test("智能体授权表单显示中文并保留权限值和项目名称", async () => {
  const client = new QueryClient();
  client.setQueryData(["agents", "info"], agentInfo);
  client.setQueryData(["projects", "all-for-agents"], {
    projects: [{ id: "project-1", title: "My Original Project" }],
  });
  const html = await renderPage(
    "/agents",
    () => (
      <GrantEditor
        value={{
          name: "My Agent",
          scopes: ["projects:read"],
          projectAccess: "selected",
          projectIds: [],
          allowProjectCreate: false,
          approvalMode: "REQUIRE_APPROVAL",
        }}
        onChange={() => {}}
      />
    ),
    client,
  );
  for (const label of [
    "连接名称",
    "允许的操作",
    "查看项目及项目元数据。",
    "全选",
    "只读",
    "清空",
    "仅限我选择的项目",
    "先询问我",
    "My Agent",
    "My Original Project",
    "projects:read",
  ])
    expect(html).toContain(label);
});

test.each([
  ["connections", ["agents", "connections"], { connections: [] }, ["尚未连接智能体"]],
  ["pending", ["agents", "approvals", "pending"], { approvals: [] }, ["暂无待审批请求"]],
  ["history", ["agents", "approvals", "history"], { approvals: [] }, ["暂无审批记录"]],
  ["rules", ["agents", "rules"], { rules: [] }, ["暂无已记住的决定"]],
] as const)("智能体 %s 标签的空态显示中文", async (tab, key, data, labels) => {
  const client = new QueryClient();
  client.setQueryData(key, data);
  const html = await renderPage("/agents", AgentsPage, client, `?tab=${tab}`);
  for (const label of labels) expect(html).toContain(label);
});

test("智能体审批显示中文操作并保留请求摘要和工具标识", async () => {
  const client = new QueryClient();
  client.setQueryData(["agents", "approvals", "pending"], {
    approvals: [
      {
        id: "approval-1",
        status: "pending",
        tool: "generate_panel",
        action: "panels.generate",
        summary: "Original request summary",
        sensitivity: "spend",
        estimate: { count: 2, estimatedUsd: 0.2 },
        createdAt: "2026-11-21T00:00:00Z",
        expiresAt: "2026-11-22T00:00:00Z",
        arguments: { prompt: "Original prompt" },
        project: { id: "project-1", title: "Original title" },
        connection: { id: "connection-1", name: "My Agent" },
      },
    ],
  });
  const html = await renderPage("/agents", AgentsPage, client, "?tab=pending");
  for (const label of [
    "消耗提供商额度",
    "批准",
    "拒绝",
    "显示原始请求",
    "理由（可选",
    "Original request summary",
    "generate_panel",
    "panels.generate",
    "Original title",
  ])
    expect(html).toContain(label);
});

test("连接授权使用中文并保留客户端、账号、回跳地址及权限标识", async () => {
  const client = new QueryClient();
  client.setQueryData(["me"], { username: "Original User" });
  client.setQueryData(["agents", "info"], agentInfo);
  client.setQueryData(["consent", "request-1"], {
    request: {
      id: "request-1",
      client: { id: "client-1", name: "My MCP Client", kind: "dcr" },
      redirectHost: "example.com",
      scopes: agentInfo.scopes,
    },
  });
  const html = await renderPage("/connect/$requestId", ConnectPage, client);
  for (const label of [
    "请求连接你的 OpenManga 账号",
    "当前登录账号",
    "你自己的提供商额度",
    "取消",
    "允许",
    "连接名称",
    "My MCP Client",
    "Original User",
    "example.com",
    "projects:read",
  ])
    expect(html).toContain(label);
});

function setQueryError(client: QueryClient, key: readonly string[]) {
  client.setQueryDefaults(key, { retry: false, retryOnMount: false });
  client.setQueryData(key, null);
  client
    .getQueryCache()
    .find({ queryKey: key })!
    .setState({ data: undefined, status: "error", error: new Error("Original API error"), fetchStatus: "idle" });
}

test("连接授权失效时显示中文标题及原始错误", async () => {
  const client = new QueryClient();
  setQueryError(client, ["consent", "request-1"]);
  const html = await renderPage("/connect/$requestId", ConnectPage, client);
  expect(html).toContain("此连接请求已失效");
  expect(html).toContain("Original API error");
});

test("专家列表显示中文操作、空态并保留自定义专家内容", async () => {
  const client = new QueryClient();
  client.setQueryData(["experts"], {
    builtin: [],
    custom: [
      {
        id: "expert-1",
        name: "Original Expert",
        description: "Original description",
        systemPrompt: "Original system prompt",
        starters: ["Original opener"],
      },
    ],
  });
  client.setQueryData(["expert-chats"], { chats: [] });
  client.setQueryData(["projects", "active"], { projects: [] });
  const html = await renderPage("/experts", ExpertsPage, client);
  for (const label of [
    "暂无对话",
    "开始对话",
    "讨论的项目",
    "不关联项目",
    "编辑 Original Expert",
    "删除 Original Expert",
    "Original description",
  ])
    expect(html).toContain(label);
});

test("专家对话使用中文编辑和发送控件并保留消息及提示词", async () => {
  const client = new QueryClient();
  client.setQueryData(["experts"], {
    builtin: [],
    custom: [{ id: "expert-1", name: "Original Expert", starters: ["Original opener"] }],
  });
  client.setQueryData(["expert-chats"], { chats: [] });
  client.setQueryData(["expert-chat", "chat-1"], {
    chat: { id: "chat-1", title: "Original Chat", expert: "expert-1", systemPrompt: "Original system prompt" },
    project: null,
    extractions: [],
    messages: [
      {
        id: "message-1",
        role: "assistant",
        content: "Original reply",
        status: "awaiting_input",
        error: null,
        attachments: [],
        images: [],
        options: {},
        prompt: "Original manual prompt",
        model: "manual",
      },
    ],
  });
  const html = await renderPage("/experts/$chatId", ExpertsPage, client);
  for (const label of [
    "对话标题",
    "删除对话",
    "粘贴回答",
    "复制对话",
    "使用此回答",
    "输入消息",
    "发送",
    "Original Chat",
    "Original reply",
  ])
    expect(html).toContain(label);
});

test("专家提取操作和失败重试显示中文", async () => {
  const html = await renderPage("/experts", () => (
    <ExpertActions
      chatId="chat-1"
      messageId="message-1"
      projectId={null}
      extractions={[
        {
          id: "extract-1",
          messageId: "message-1",
          projectId: null,
          action: "concept",
          status: "failed",
          manual: false,
          result: null,
          applied: null,
          failureReason: null,
          createdAt: "2026-11-21T00:00:00Z",
        },
      ]}
    />
  ));
  for (const label of ["用于", "新建项目", "故事设定", "故事大纲", "YouTube 文案", "重试"])
    expect(html).toContain(label);
});

const storageSummary = {
  computedAt: "2026-11-21T00:00:00Z",
  files: 2,
  bytes: 2048,
  totalBytes: 4096,
  afterBytes: 2048,
  overLimitBytes: 1024,
  reasons: { age: 1, size: 1 },
  byKind: { export: { files: 2, bytes: 2048 } },
};

test("存储策略、统计和待审批删除显示中文", async () => {
  const client = new QueryClient();
  client.setQueryData(["admin", "storage"], {
    policy: { enabled: true, maxAgeDays: 30, maxTotalGb: 10, mode: "approve" },
    usage: { totalBytes: 4096, expendable: { export: { files: 2, bytes: 2048 } } },
    preview: null,
    pending: storageSummary,
    disk: { freeBytes: 10000, totalBytes: 20000 },
  });
  const html = await renderPage("/admin", StorageTab, client);
  for (const label of [
    "存储策略",
    "启用存储策略",
    "保存策略",
    "使用情况",
    "等待你审批",
    "立即删除",
    "导出文件",
    "个文件",
  ])
    expect(html).toContain(label);
});

test("存储摘要及全局告警使用中文且保留字节统计", async () => {
  const client = new QueryClient();
  client.setQueryData(["admin", "storage", "alert"], { pending: storageSummary });
  const html = await renderPage(
    "/admin",
    () => (
      <>
        <SummaryList s={storageSummary} />
        <StorageAlert />
      </>
    ),
    client,
  );
  for (const label of ["导出文件", "存储策略", "等待你审批", "查看", "2 个文件", "2.0 KB"])
    expect(html).toContain(label);
  expect(html).toContain("/admin?tab=storage");
});

test("存储策略加载失败提供中文重试", async () => {
  const client = new QueryClient();
  setQueryError(client, ["admin", "storage"]);
  const html = await renderPage("/admin", StorageTab, client);
  expect(html).toContain("重试");
  expect(html).toContain("Original API error");
});

test("专家目录加载失败显示中文错误并保留服务器信息", async () => {
  const client = new QueryClient();
  setQueryError(client, ["experts"]);
  setQueryError(client, ["expert-chats"]);
  const html = await renderPage("/experts", ExpertsPage, client);
  for (const label of ["加载专家失败", "加载对话列表失败", "重试", "Original API error"]) expect(html).toContain(label);
  expect(html).not.toContain("暂无对话");
});

test("专家对话加载失败与不存在使用不同的中文提示", async () => {
  const client = new QueryClient();
  setQueryError(client, ["expert-chat", "chat-1"]);
  const html = await renderPage("/experts/$chatId", ExpertsPage, client);
  expect(html).toContain("加载对话失败");
  expect(html).toContain("Original API error");
  expect(html).not.toContain("未找到对话");
});

test("已记住的决定加载失败时显示错误及重试", async () => {
  const client = new QueryClient();
  setQueryError(client, ["agents", "rules"]);
  const html = await renderPage("/agents", AgentsPage, client, "?tab=rules");
  expect(html).toContain("Original API error");
  expect(html).toContain("重试");
  expect(html).not.toContain("暂无已记住的决定");
});

test("授权表单的项目加载失败显示可重试的中文错误", async () => {
  const client = new QueryClient();
  setQueryError(client, ["projects", "all-for-agents"]);
  const html = await renderPage(
    "/agents",
    () => (
      <GrantEditor
        value={{
          name: "Original Agent",
          scopes: [],
          projectAccess: "selected",
          projectIds: [],
          allowProjectCreate: false,
          approvalMode: "REQUIRE_APPROVAL",
        }}
        onChange={() => {}}
      />
    ),
    client,
  );
  expect(html).toContain("加载项目失败");
  expect(html).toContain("Original API error");
  expect(html).toContain("重试");
});

test("已连接智能体的状态和规则操作显示中文且保留名称与权限值", async () => {
  const client = new QueryClient();
  client.setQueryData(["agents", "connections"], {
    connections: [
      {
        id: "connection-1",
        name: "Original Agent",
        kind: "pat",
        scopes: ["projects:read"],
        projectAccess: "all",
        allowProjectCreate: true,
        approvalMode: "REQUIRE_APPROVAL",
        createdAt: "2026-11-21T00:00:00Z",
        lastUsedAt: null,
        revokedAt: null,
        metadata: { declinedScopes: ["story:write"] },
        projects: [],
        tokens: [{ id: "token-1", hint: "1234", expiresAt: null }],
      },
    ],
  });
  let html = await renderPage("/agents", AgentsPage, client);
  for (const label of [
    "Original Agent",
    "访问令牌",
    "有效",
    "编辑",
    "撤销",
    "永不过期",
    "全部项目",
    "先询问我",
    "projects:read",
    "story:write",
  ])
    expect(html).toContain(label);
  client.setQueryData(["agents", "rules"], {
    rules: [
      {
        id: "rule-1",
        actionKey: "panels.generate",
        decision: "ALLOW",
        connection: "Original Agent",
        project: "Original Project",
        updatedAt: "2026-11-21T00:00:00Z",
      },
    ],
  });
  html = await renderPage("/agents", AgentsPage, client, "?tab=rules");
  for (const label of ["始终允许", "改为拒绝", "移除规则", "panels.generate", "Original Project"])
    expect(html).toContain(label);
});

test.each([
  ["executed", "已执行"],
  ["denied", "已拒绝"],
  ["failed", "失败"],
  ["stale", "目标已变化"],
  ["expired", "已过期"],
  ["cancelled", "已取消"],
  ["approved", "执行中"],
  ["execution_unknown", "结果未知"],
])("审批历史状态 %s 显示中文", async (status, label) => {
  const client = new QueryClient();
  client.setQueryData(["agents", "approvals", "history"], {
    approvals: [
      {
        id: "approval-1",
        status,
        sensitivity: "read",
        summary: "Original summary",
        action: "projects.list",
        tool: "list_projects",
        createdAt: "2026-11-21T00:00:00Z",
        decisionReason: "Original reason",
        arguments: {},
      },
    ],
  });
  const html = await renderPage("/agents", AgentsPage, client, "?tab=history");
  for (const text of [label, "Original summary", "Original reason", "projects.list", "list_projects"])
    expect(html).toContain(text);
});

test.each([
  [null, "暂无生效策略"],
  [storageSummary, "当前策略预计删除"],
])("存储策略预览和无策略提示显示中文 %j", async (preview, expected) => {
  const client = new QueryClient();
  client.setQueryData(["admin", "storage"], {
    policy: { enabled: false, maxAgeDays: null, maxTotalGb: null, mode: "auto" },
    usage: { totalBytes: 4096, expendable: {} },
    preview,
    pending: null,
    disk: null,
  });
  const html = await renderPage("/admin", StorageTab, client);
  expect(html).toContain(expected);
  expect(html).toContain("自动删除");
});

test("专家回复失败显示中文重试且保留原始消息及图片提示词", async () => {
  const client = new QueryClient();
  client.setQueryData(["expert-chat", "chat-1"], {
    chat: { id: "chat-1", title: "Original Chat", expert: "expert-1" },
    project: null,
    extractions: [],
    messages: [
      {
        id: "message-1",
        role: "assistant",
        content: "Original reply",
        status: "failed",
        error: null,
        attachments: [],
        images: [],
        options: { imagePrompt: "IMAGE PROMPT: Original image prompt", imageError: "Original image error" },
        prompt: "Original manual prompt",
        model: "gpt-4.1",
      },
    ],
  });
  const html = await renderPage("/experts/$chatId", ExpertsPage, client);
  for (const label of [
    "回复失败。",
    "重试",
    "复制回复",
    "图片提示词",
    "输入消息",
    "gpt-4.1",
    "Original reply",
    "IMAGE PROMPT: Original image prompt",
    "Original image error",
  ])
    expect(html).toContain(label);
});

test("指定目录内的静态界面文字和无障碍标签不残留英文操作文案", () => {
  const untranslated: string[] = [];
  const technicalText = new Set(["Authorization: Bearer &lt;token&gt;", "IP", "(UTC)", "https://api.example.com/v1"]);
  const uiAttributes = new Set(["title", "label", "placeholder", "aria-label", "confirmLabel", "hint", "subtitle"]);
  for (const directory of ["account", "admin", "agent", "agents", "ai", "experts"]) {
    const folder = join(import.meta.dir, "..", directory);
    for (const file of readdirSync(folder).filter((name) => name.endsWith(".tsx") && !name.includes(".test."))) {
      const source = ts.createSourceFile(
        file,
        readFileSync(join(folder, file), "utf8"),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      const visit = (node: ts.Node) => {
        const isUiAttribute =
          ts.isStringLiteral(node) &&
          ts.isJsxAttribute(node.parent) &&
          uiAttributes.has(node.parent.name.getText(source));
        if (ts.isJsxText(node) || isUiAttribute) {
          const text = (node as ts.JsxText | ts.StringLiteral).text.trim();
          if (/[a-z]{2,}/i.test(text) && !/[\u3400-\u9fff]/.test(text) && !technicalText.has(text))
            untranslated.push(directory + "/" + file + " — " + text);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
  expect(untranslated).toEqual([]);
});
