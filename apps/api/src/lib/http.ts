import { AuthError } from "@openmanga/auth";
import { type SQLWrapper, sql } from "@openmanga/db";
import { ProviderError } from "@openmanga/domain";
import { PlanningError } from "@openmanga/services";
import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { AppEnv } from "../context.ts";

export class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 402 | 403 | 404 | 409 | 413 | 415 | 422 | 429 | 500 | 503,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

const resourceLabels = new Map<string, string>([
  ["Resource", "资源"],
  ["Account with that username", "该用户名对应的账号"],
  ["Agent run", "智能体任务"],
  ["Alias", "别名"],
  ["Analysis", "分析结果"],
  ["Approval request", "审批请求"],
  ["Artwork", "画面"],
  ["Artwork version", "画面版本"],
  ["Asset", "素材"],
  ["Attachment", "附件"],
  ["Audio job", "音频任务"],
  ["Authorization request (it may have expired or been answered already)", "授权请求（可能已过期或已处理）"],
  [
    "Authorization request (it may have expired; start connecting again from your app)",
    "授权请求（可能已过期，请从你的应用重新发起连接）",
  ],
  ["Batch", "批次"],
  ["Board item", "看板条目"],
  ["Card", "卡片"],
  ["Channel profile", "频道配置"],
  ["Chapter", "章节"],
  ["Character", "角色"],
  ["Chat", "对话"],
  ["Clip", "视频片段"],
  ["Comment", "评论"],
  ["Comments", "评论"],
  ["Comparison run", "对比任务"],
  ["Connection", "连接"],
  ["Cover", "封面"],
  ["Coverage sheet", "补充镜头表"],
  ["Coverage sheet image", "补充镜头表图片"],
  ["Credential", "凭据"],
  ["Description", "描述"],
  ["Dialogue", "对白"],
  ["Email", "邮件"],
  ["Episode", "分集"],
  ["Event", "事件"],
  ["Expert", "专家"],
  ["Export", "导出任务"],
  ["Export target", "导出目标"],
  ["Extraction", "提取任务"],
  ["Fact", "事实"],
  ["Finding", "检查结果"],
  ["Guide image", "构图引导图"],
  ["Hook variant", "开场方案"],
  ["Image", "图片"],
  ["Invitation", "邀请"],
  ["Job", "任务"],
  ["Layout", "版式"],
  ["Library entry", "资源库条目"],
  ["Link", "链接"],
  ["Linked video", "关联视频"],
  ["Location state", "场景状态"],
  ["Member", "成员"],
  ["Message", "消息"],
  ["Narration fix", "旁白修正"],
  ["Narration line", "旁白行"],
  ["Narration segment", "旁白片段"],
  ["Outfit", "服装"],
  ["Outfit change", "服装变更"],
  ["Page", "页面"],
  ["Page to insert after", "插入位置对应的页面"],
  ["Palette image", "色板图片"],
  ["Panel", "画格"],
  ["Project", "项目"],
  ["Public or unlisted YouTube video", "公开或不公开列出的 YouTube 视频"],
  ["Reference", "参考图"],
  ["Retime job", "计时调整任务"],
  ["Route", "接口"],
  ["Rule", "规则"],
  ["Run", "运行记录"],
  ["Series", "系列"],
  ["SFX", "音效"],
  ["State", "状态"],
  ["Story revision", "故事版本"],
  ["Style", "画风"],
  ["Style preset", "画风预设"],
  ["Style version", "画风版本"],
  ["Template", "模板"],
  ["Thread", "评论串"],
  ["Thumbnail", "缩略图"],
  ["User", "用户"],
  ["Version", "版本"],
  ["Video edit", "视频编辑记录"],
  ["YouTube channel", "YouTube 频道"],
  ["location", "场景"],
  ["prop", "道具"],
]);

export const notFound = (what = "Resource") =>
  new ApiError(404, "not_found", `未找到${resourceLabels.get(what) ?? "资源"}`);
export const forbidden = () => new ApiError(403, "forbidden", "你没有权限执行此操作");
export const conflict = (msg: string) => new ApiError(409, "conflict", msg);
export const badRequest = (msg: string, details?: unknown) => new ApiError(400, "bad_request", msg, details);

/** Sanitized error responses: never leak stack traces or provider internals. */
export function handleError(err: Error, c: Context<AppEnv>) {
  const requestId = c.get("requestId");
  const log = c.get("log");
  if (err instanceof ApiError) {
    return c.json({ error: { code: err.code, message: err.message, details: err.details, requestId } }, err.status);
  }
  if (err instanceof z.ZodError) {
    return c.json(
      {
        error: {
          code: "validation_error",
          message: "输入无效",
          details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
          requestId,
        },
      },
      422,
    );
  }
  if (err instanceof AuthError) {
    const status =
      err.code === "conflict"
        ? 409
        : err.code === "registration_disabled"
          ? 403
          : err.code === "invalid_token"
            ? 400
            : 401;
    return c.json({ error: { code: err.code, message: err.message, requestId } }, status);
  }
  if (err instanceof PlanningError) {
    return c.json({ error: { code: "planning_error", message: err.message, requestId } }, err.status);
  }
  if (err instanceof ProviderError) {
    const rejected = err.code === "invalid_request" || err.code === "content_policy" || err.code === "synthesis_error";
    return c.json(
      { error: { code: `provider_${err.code}`, message: err.userMessage, requestId } },
      rejected ? 422 : 503,
    );
  }
  // Drizzle's refusal of an update with nothing in it: a PATCH whose body named no field (`{}`) or only unknown ones.
  // One check here rather than a non-empty refinement on every patch schema.
  if (err.message === "No values to set") {
    return c.json({ error: { code: "validation_error", message: "请至少提供一个要更新的字段", requestId } }, 422);
  }
  if (err instanceof HTTPException) {
    return c.json({ error: { code: "http_error", message: err.message, requestId } }, err.status);
  }
  log?.error("unhandled error", { error: err, requestId });
  const deps = c.get("deps");
  if (deps) {
    import("@openmanga/services")
      .then(({ recordError }) =>
        recordError(deps.db, { source: "api", message: err.message, requestId, metadata: { path: c.req.path } }),
      )
      .catch(() => {});
  }
  return c.json({ error: { code: "internal_error", message: "发生错误，请重试。", requestId } }, 500);
}

const zhValidation = { error: z.locales.zhCN().localeError };

export async function body<T extends z.ZodType>(c: Context<AppEnv>, schema: T): Promise<z.infer<T>> {
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    throw badRequest("请求正文必须为有效的 JSON");
  }
  return schema.parse(json, zhValidation);
}

export function query<T extends z.ZodType>(c: Context<AppEnv>, schema: T): z.infer<T> {
  return schema.parse(c.req.query(), zhValidation);
}

/**
 * A timestamp to the microsecond, as the database keeps it, for a page cursor. `Date.toISOString()` keeps
 * milliseconds, so the next page asked for rows before `.123000` and skipped every row of the same millisecond after
 * the boundary (a bulk run's jobs share one timestamp).
 */
export const cursorTime = (col: SQLWrapper) =>
  sql<string>`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export const uuidParam = (c: Context<AppEnv>, name: string) => {
  const v = c.req.param(name);
  if (!v || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) throw notFound();
  return v;
};

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get("user")) throw new ApiError(401, "unauthenticated", "请先登录");
  await next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const u = c.get("user");
  if (!u) throw new ApiError(401, "unauthenticated", "请先登录");
  if (u.role !== "admin") throw forbidden();
  await next();
};

export const user = (c: Context<AppEnv>) => {
  const u = c.get("user");
  if (!u) throw new ApiError(401, "unauthenticated", "请先登录");
  return u;
};

/**
 * Only `X-Real-IP` is trusted, and only because the bundled nginx overwrites it with the connection's own address
 * (after `real_ip` has applied CF-Connecting-IP from a proxy on our network). Reading a client-supplied
 * `CF-Connecting-IP` or `X-Forwarded-For` here would let anyone rotate the value that rate limiting keys on.
 * Behind a different proxy, make it set `X-Real-IP` the same way.
 */
export const clientIp = (c: Context<AppEnv>) => c.req.header("x-real-ip")?.trim() || null;
