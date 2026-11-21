import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { Bot, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { get, post } from "../../api/client.ts";
import { useMe } from "../../api/hooks.ts";
import { ErrorBox, Spinner } from "../../components/ui.tsx";
import { type Grant, GrantEditor } from "./AgentsPage.tsx";

type ConsentRequest = {
  id: string;
  client: { id: string; name: string; kind: "dcr" | "cimd" };
  redirectHost: string;
  scopes: { scope: string; description: string }[];
  expiresAt: string;
};

/**
 * OAuth consent, reached from /oauth/authorize after the normal sign-in. The request itself (client, redirect,
 * PKCE, state) was frozen by the server when it arrived; this page only ever refers to it by id, and chooses what
 * to grant within what was asked.
 */
export function ConnectPage() {
  const { requestId } = useParams({ strict: false }) as { requestId: string };
  const { data: me } = useMe();
  const q = useQuery({
    queryKey: ["consent", requestId],
    queryFn: () => get<{ request: ConsentRequest }>(`/agents/consent/${requestId}`),
    retry: false,
  });
  const [grant, setGrant] = useState<Grant | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const req = q.data?.request;
  const value: Grant | null =
    grant ??
    (req
      ? {
          name: req.client.name,
          scopes: req.scopes.map((s) => s.scope),
          projectAccess: "selected",
          projectIds: [],
          allowProjectCreate: false,
          approvalMode: "REQUIRE_APPROVAL",
        }
      : null);

  const answer = async (approve: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ redirectTo: string }>(
        `/agents/consent/${requestId}`,
        approve ? { approve, grant: value } : { approve },
      );
      window.location.assign(r.redirectTo);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      {q.isLoading && <Spinner />}
      {q.error && <ErrorBox error={q.error} title="此连接请求已失效" />}
      {req && value && (
        <div className="card space-y-5 p-5">
          <div className="flex items-start gap-3">
            <Bot className="mt-1 size-8 shrink-0 text-accent-500" />
            <div>
              <h1 className="text-lg font-semibold">{req.client.name} 请求连接你的 OpenManga 账号</h1>
              <p className="muted text-sm">
                当前登录账号为 <strong>{me?.username}</strong>。允许连接后，将返回 <code>{req.redirectHost}</code>.
              </p>
            </div>
          </div>
          <div className="flex gap-2 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <TriangleAlert className="size-4 shrink-0 text-amber-500" />
            <div>
              外部 AI 智能体将<strong>以你的身份</strong>，在下方选择的权限范围内操作
              OpenManga。生成图片、使用你的密钥调用文本模型或通过提供商合成语音，都会消耗
              <strong>你自己的提供商额度</strong>，并计入项目预算。API
              密钥本身不会共享给智能体。你可以随时在“智能体访问”中修改或撤销授权。
            </div>
          </div>
          <GrantEditor value={value} onChange={setGrant} offered={req.scopes.map((s) => s.scope)} />
          <ErrorBox error={error} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => answer(false)}>
              取消
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={busy || !value.scopes.length || !value.name.trim()}
              onClick={() => answer(true)}
            >
              {busy && <Spinner />} 允许
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
