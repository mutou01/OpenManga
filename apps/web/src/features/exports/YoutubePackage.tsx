import { ProjectSettings } from "@openmanga/schemas";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Download, Sparkles, Youtube } from "lucide-react";
import { useEffect, useState } from "react";
import { patch, post } from "../../api/client.ts";
import { onProjectEvent, qk } from "../../api/hooks.ts";
import { Field, Spinner, toast } from "../../components/ui.tsx";
import { AiChip, useAiBody } from "../ai/AiPicker.tsx";
import { CopyButton } from "../generation/shared.tsx";
import { useProject, useProjectId } from "../project/ProjectLayout.tsx";

type Pkg = {
  titles: string[];
  description: string;
  tags: string[];
  pinnedComment: string;
  thumbnailHeadlines: string[];
};
const EMPTY: Pkg = { titles: [], description: "", tags: [], pinnedComment: "", thumbnailHeadlines: [] };

/**
 * Publishing text for the video: written once by the text model, then edited here. The "YouTube 发布包" export
 * zips it with the newest video, its subtitles and chapter timestamps, and the thumbnail.
 */
export function YoutubePackageCard() {
  const projectId = useProjectId();
  const { data } = useProject();
  const qc = useQueryClient();
  const aiText = useAiBody("text");
  const saved = (data?.project.settings.youtubePackage as Pkg | undefined) ?? null;
  const [p, setP] = useState<Pkg>(saved ?? EMPTY);
  // Typed as text and parsed when saved, so a new line or comma being typed is not stripped mid-word.
  const [titlesText, setTitlesText] = useState((saved ?? EMPTY).titles.join("\n"));
  const [tagsText, setTagsText] = useState((saved ?? EMPTY).tags.join(", "));
  const [headlinesText, setHeadlinesText] = useState((saved ?? EMPTY).thumbnailHeadlines.join("\n"));
  const [writing, setWriting] = useState(false);
  const key = JSON.stringify(saved);
  useEffect(() => {
    setP(saved ?? EMPTY);
    setTitlesText((saved ?? EMPTY).titles.join("\n"));
    setTagsText((saved ?? EMPTY).tags.join(", "));
    setHeadlinesText((saved ?? EMPTY).thumbnailHeadlines.join("\n"));
  }, [key]);
  // The job writes into the project settings; refresh when it finishes.
  useEffect(
    () =>
      onProjectEvent((e) => {
        if (
          e.type === "job.updated" &&
          e.kind === "youtube_package" &&
          (["completed", "failed", "cancelled", "awaiting_input"] as unknown[]).includes(e.status)
        ) {
          setWriting(false);
          void qc.invalidateQueries({ queryKey: qk.project(projectId), exact: true });
          if (e.status === "failed") toast.error("YouTube 发布文案生成失败");
          if (e.status === "awaiting_input") toast.info("请到生成任务页粘贴回答");
        }
      }),
    [projectId, qc],
  );
  const write = async () => {
    setWriting(true);
    try {
      await post(`/projects/${projectId}/youtube-package`, aiText());
    } catch (e) {
      setWriting(false);
      toast.error(e);
    }
  };
  const save = async (next: Pkg) => {
    try {
      await patch(`/projects/${projectId}`, { settings: { youtubePackage: next } });
      await qc.invalidateQueries({ queryKey: qk.project(projectId), exact: true });
      toast.success("已保存");
    } catch (e) {
      toast.error(e);
    }
  };
  const applyHeadline = async (h: string) => {
    const t = data?.project.settings.thumbnail;
    if (!t) return toast.info("请先在概览页生成缩略图");
    try {
      await patch(`/projects/${projectId}`, { settings: { thumbnail: { ...t, title: h } } });
      await qc.invalidateQueries({ queryKey: qk.project(projectId), exact: true });
      toast.success("缩略图标题已更新");
    } catch (e) {
      toast.error(e);
    }
  };
  const split = (v: string, sep: string) =>
    v
      .split(sep)
      .map((s) => s.trim())
      .filter(Boolean);
  const current: Pkg = {
    ...p,
    titles: split(titlesText, "\n"),
    tags: split(tagsText, ","),
    thumbnailHeadlines: split(headlinesText, "\n"),
  };
  const thumb = data?.project.settings.thumbnail;
  const dirty = JSON.stringify(current) !== JSON.stringify(saved ?? EMPTY);
  // The same limits the server applies, said before saving instead of as a failed save.
  const problem = (() => {
    const r = ProjectSettings.shape.youtubePackage.safeParse(current);
    if (r.success) return null;
    const LIMITS: Record<string, string> = {
      titles: "最多 8 个标题，每个不超过 100 个字符",
      thumbnailHeadlines: "最多 8 个缩略图标题，每个不超过 60 个字符",
      tags: "最多 30 个标签，每个不超过 60 个字符",
      description: "简介不超过 4,500 个字符",
      pinnedComment: "置顶评论不超过 2,000 个字符",
    };
    return `YouTube 内容限制为${LIMITS[String(r.error.issues[0]?.path[0])] ?? "请减少内容长度或数量"}。`;
  })();

  return (
    <section className="card mb-4 space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto flex items-center gap-2 font-medium">
          <Youtube className="size-4" /> YouTube 发布包
        </h2>
        <AiChip cap="text" />
        <button type="button" className="btn-secondary" disabled={writing} onClick={write}>
          {writing ? <Spinner /> : <Sparkles className="size-4" />} {saved ? "用 AI 重写" : "用 AI 撰写"}
        </button>
        {dirty && (
          <button type="button" className="btn-primary" disabled={Boolean(problem)} onClick={() => save(current)}>
            保存
          </button>
        )}
      </div>
      <p className="muted text-xs">
        由文本模型撰写标题、简介、标签、置顶评论与缩略图标题，生成后可编辑。导出<strong>YouTube 发布包</strong>
        时，会将这些文案与同一范围内最新渲染的视频、字幕、加入简介的章节时间戳及缩略图一起打包。
      </p>
      {dirty && problem && <p className="text-xs text-red-600 dark:text-red-400">{problem}</p>}
      {saved || dirty ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="备选标题（每行一个）">
            <textarea className="input min-h-24" value={titlesText} onChange={(e) => setTitlesText(e.target.value)} />
          </Field>
          <Field label="简介">
            <textarea
              className="input min-h-24"
              value={p.description}
              onChange={(e) => setP({ ...p, description: e.target.value })}
            />
          </Field>
          <Field label="标签（用英文逗号分隔）">
            <input className="input" value={tagsText} onChange={(e) => setTagsText(e.target.value)} />
          </Field>
          <Field label="置顶评论">
            <input
              className="input"
              value={p.pinnedComment}
              onChange={(e) => setP({ ...p, pinnedComment: e.target.value })}
            />
          </Field>
          <Field label="缩略图标题（每行一个）">
            <textarea
              className="input min-h-20"
              value={headlinesText}
              onChange={(e) => setHeadlinesText(e.target.value)}
            />
          </Field>
          <div className="flex items-end">
            <CopyButton
              text={[current.titles[0] ?? "", "", p.description, "", current.tags.join(", ")].join("\n")}
              label="复制全部"
            />
          </div>
          <div className="md:col-span-2">
            <span className="label">缩略图变体</span>
            {!thumb ? (
              <p className="muted text-xs">在概览页生成缩略图后，即可预览各个标题的效果。</p>
            ) : (
              <>
                <p className="muted mb-2 text-xs">
                  在同一张原画上预览各个标题，可并排比较。YouTube 发布包会分别导出这些图片，供 YouTube
                  测试与比较功能使用，每次可比较三张。
                </p>
                <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {current.thumbnailHeadlines.map((h, i) => {
                    const url = (download: boolean) =>
                      `/api/projects/${projectId}/thumbnail.png?${new URLSearchParams({
                        title: h,
                        subtitle: thumb.subtitle,
                        side: thumb.side,
                        v: thumb.assetId,
                        ...(download ? { download: "1" } : { width: "480" }),
                      })}`;
                    return (
                      <li key={`${i}:${h}`} className="overflow-hidden rounded-lg border border-[var(--border)]">
                        <img src={url(false)} alt={`缩略图：${h}`} className="aspect-video w-full object-cover" />
                        <div className="flex items-center gap-1 p-1.5 text-xs">
                          <span className="min-w-0 flex-1 truncate" title={h}>
                            {h}
                          </span>
                          {thumb.title === h ? (
                            <span className="chip flex items-center gap-1">
                              <Check className="size-3" /> 使用中
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="btn-ghost px-1.5 py-0.5 text-xs"
                              title="将其用作缩略图标题"
                              onClick={() => applyHeadline(h)}
                            >
                              使用
                            </button>
                          )}
                          <a
                            className="btn-ghost px-1.5 py-0.5"
                            href={url(true)}
                            aria-label={`下载 1280×720 PNG：${h}`}
                            title="1280×720 PNG"
                          >
                            <Download className="size-3.5" />
                          </a>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        </div>
      ) : (
        <p className="muted text-sm">暂无文案。</p>
      )}
    </section>
  );
}
