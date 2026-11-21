import type { ImageDescription } from "@openmanga/schemas";
import { useRef } from "react";
import { PageHeader } from "../../components/ui.tsx";
import { useProjectId } from "../project/ProjectLayout.tsx";
import { DescribeHistory } from "./DescribeHistory.tsx";
import { DescribeImage, type DescribeImageHandle } from "./DescribeImage.tsx";

export function DescribeImagePage() {
  const projectId = useProjectId();
  const handle = useRef<DescribeImageHandle | null>(null);
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <PageHeader
        title="图片描述"
        subtitle="上传视频画面或喜欢的漫画页面等参考图，提取可用于生成的画风、角色或地点描述。"
      />
      <DescribeImage projectId={projectId} handleRef={handle} />
      <DescribeHistory
        projectId={projectId}
        onReuse={(row) => {
          handle.current?.show(row.description as ImageDescription, {
            projectTitle: row.projectTitle,
            assetId: row.assetId,
          });
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
      />
    </div>
  );
}
