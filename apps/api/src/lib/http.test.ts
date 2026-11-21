import { expect, test } from "bun:test";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context.ts";
import { body, handleError, notFound, requireUser } from "./http.ts";

const app = new Hono<AppEnv>();
app.onError(handleError);
app.use("*", async (c, next) => {
  c.set("requestId", "test-request");
  await next();
});
app.get("/private", requireUser, (c) => c.json({ ok: true }));
app.post("/form", async (c) => c.json(await body(c, z.object({ title: z.string().min(1) }))));
app.get("/missing", () => {
  throw notFound("Project");
});

test("unauthenticated responses explain sign-in in Chinese and keep the error code and status", async () => {
  const response = await app.request("/private");
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({
    error: { code: "unauthenticated", message: "请先登录", requestId: "test-request" },
  });
});

test("validation responses use Chinese for built-in constraints and keep the field path", async () => {
  const response = await app.request("/form", { method: "POST", body: JSON.stringify({ title: "" }) });
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({
    error: {
      code: "validation_error",
      message: "输入无效",
      requestId: "test-request",
      details: [{ path: "title", message: expect.stringMatching(/[\u3400-\u9fff]/u) }],
    },
  });
});

test("missing projects have a localized message and keep the not_found code", async () => {
  const response = await app.request("/missing");
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({ error: { code: "not_found", message: "未找到项目" } });
});
