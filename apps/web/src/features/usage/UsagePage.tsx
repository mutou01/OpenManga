import { useQuery } from "@tanstack/react-query";
import { get } from "../../api/client.ts";
import { qk } from "../../api/hooks.ts";
import type { UsageSummary } from "../../api/types.ts";
import { ErrorBox, PageHeader, Spinner } from "../../components/ui.tsx";
import { useProjectId } from "../project/ProjectLayout.tsx";
import { UsageDashboard } from "./UsageDashboard.tsx";

function UsageView({
  title,
  subtitle,
  queryKey,
  path,
}: {
  title: string;
  subtitle: string;
  queryKey: readonly unknown[];
  path: string;
}) {
  const q = useQuery({ queryKey, queryFn: () => get<UsageSummary>(path) });
  return (
    <div className="mx-auto max-w-6xl p-6">
      <PageHeader title={title} subtitle={subtitle} />
      {q.error && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
      {q.isLoading ? <Spinner /> : q.data && <UsageDashboard data={q.data} />}
    </div>
  );
}

export function UsagePage() {
  return (
    <UsageView
      title="API 用量与费用"
      subtitle="统计所有项目。费用根据已记录的供应商用量和费率快照估算。"
      queryKey={["usage", "me"]}
      path="/usage"
    />
  );
}

export function ProjectUsagePage() {
  const projectId = useProjectId();
  return (
    <UsageView
      title="项目费用"
      subtitle="此项目已记录的供应商用量。"
      queryKey={qk.usage(projectId)}
      path={`/projects/${projectId}/usage`}
    />
  );
}
