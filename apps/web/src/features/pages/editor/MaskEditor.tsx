import { useQueryClient } from "@tanstack/react-query";
import { Eraser, Paintbrush, Trash2, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, assetUrl, post } from "../../../api/client.ts";
import { qk } from "../../../api/hooks.ts";
import { Modal, Spinner, toast } from "../../../components/ui.tsx";
import { AiChip, useAiBody } from "../../ai/AiPicker.tsx";

type Stroke = { size: number; erase: boolean; points: [number, number][] };

/** Mask painted at the artwork's natural pixel size: white opaque = edit region, transparent = keep. */
export function MaskEditor({
  panelId,
  artworkId,
  pageId,
  onClose,
}: {
  panelId: string;
  artworkId: string;
  pageId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const view = useRef<HTMLCanvasElement>(null);
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const tintRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [ready, setReady] = useState(false);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const drawing = useRef<Stroke | null>(null);
  const [size, setSize] = useState(60);
  const [erase, setErase] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      for (const r of [maskRef, tintRef]) {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        r.current = c;
      }
      if (view.current) {
        view.current.width = img.naturalWidth;
        view.current.height = img.naturalHeight;
      }
      setReady(true);
    };
    img.onerror = () => toast.error("无法加载图片");
    img.src = assetUrl(artworkId);
  }, [artworkId]);

  const redraw = (all: Stroke[]) => {
    const img = imgRef.current;
    const mask = maskRef.current;
    const tint = tintRef.current;
    const v = view.current;
    if (!img || !mask || !tint || !v) return;
    const m = mask.getContext("2d")!;
    m.clearRect(0, 0, mask.width, mask.height);
    for (const s of all) {
      m.globalCompositeOperation = s.erase ? "destination-out" : "source-over";
      m.strokeStyle = "#ffffff";
      m.lineWidth = s.size;
      m.lineCap = "round";
      m.lineJoin = "round";
      m.beginPath();
      for (const [i, [x, y]] of s.points.entries()) {
        if (i) m.lineTo(x, y);
        else m.moveTo(x, y);
      }
      if (s.points.length === 1) m.lineTo(s.points[0]![0] + 0.1, s.points[0]![1]);
      m.stroke();
    }
    m.globalCompositeOperation = "source-over";
    const t = tint.getContext("2d")!;
    t.clearRect(0, 0, tint.width, tint.height);
    t.globalCompositeOperation = "source-over";
    t.drawImage(mask, 0, 0);
    t.globalCompositeOperation = "source-in";
    t.fillStyle = "#ef4444";
    t.fillRect(0, 0, tint.width, tint.height);
    const ctx = v.getContext("2d")!;
    ctx.globalAlpha = 1;
    ctx.drawImage(img, 0, 0);
    ctx.globalAlpha = 0.5;
    ctx.drawImage(tint, 0, 0);
    ctx.globalAlpha = 1;
  };
  useEffect(() => {
    if (ready) redraw(strokes);
  }, [ready, strokes]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [
      ((e.clientX - r.left) / r.width) * e.currentTarget.width,
      ((e.clientY - r.top) / r.height) * e.currentTarget.height,
    ];
  };

  const aiImage = useAiBody("image");
  const submit = async () => {
    const mask = maskRef.current;
    if (!mask) return;
    setBusy(true);
    try {
      const blob = await new Promise<Blob | null>((res) => mask.toBlob(res, "image/png"));
      if (!blob) throw new Error("无法编码蒙版");
      const form = new FormData();
      form.set("file", new File([blob], "mask.png", { type: "image/png" }));
      const m = await api<{ asset: { id: string } }>(`/panels/${panelId}/mask`, { method: "POST", body: form });
      await post(`/panels/${panelId}/edit`, {
        ...aiImage(),
        maskAssetId: m.asset.id,
        instruction,
        sourceAssetId: artworkId,
      });
      toast.success("局部重绘已加入队列");
      await qc.invalidateQueries({ queryKey: qk.page(pageId) });
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="局部重绘"
      wide="xl"
      footer={
        <>
          <AiChip cap="image" className="mr-auto" />
          <button type="button" className="btn-secondary" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={busy || !strokes.some((s) => !s.erase) || instruction.trim().length < 3}
            onClick={() => void submit()}
          >
            {busy && <Spinner />} 提交编辑
          </button>
        </>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <button
          type="button"
          className={erase ? "btn-secondary" : "btn-primary"}
          aria-pressed={!erase}
          onClick={() => setErase(false)}
        >
          <Paintbrush className="size-4" /> 画笔
        </button>
        <button
          type="button"
          className={erase ? "btn-primary" : "btn-secondary"}
          aria-pressed={erase}
          onClick={() => setErase(true)}
        >
          <Eraser className="size-4" /> 橡皮擦
        </button>
        <label className="flex items-center gap-2">
          画笔大小
          <input
            type="range"
            min={5}
            max={300}
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
            aria-label="画笔大小"
          />{" "}
          <span className="w-8 tabular-nums">{size}</span>
        </label>
        <button
          type="button"
          className="btn-ghost"
          disabled={!strokes.length}
          onClick={() => setStrokes((s) => s.slice(0, -1))}
        >
          <Undo2 className="size-4" /> 撤销笔画
        </button>
        <button type="button" className="btn-ghost" disabled={!strokes.length} onClick={() => setStrokes([])}>
          <Trash2 className="size-4" /> 清空
        </button>
      </div>
      {!ready && <Spinner />}
      <canvas
        ref={view}
        className="mx-auto block max-h-[55vh] max-w-full cursor-crosshair touch-none rounded-lg bg-[var(--panel-2)]"
        style={{ display: ready ? "block" : "none" }}
        aria-label="涂绘要修改的区域"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = { size, erase, points: [point(e)] };
          redraw([...strokes, drawing.current]);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          drawing.current.points.push(point(e));
          redraw([...strokes, drawing.current]);
        }}
        onPointerUp={() => {
          if (drawing.current) setStrokes((s) => [...s, drawing.current!]);
          drawing.current = null;
        }}
      />
      <label className="label mt-3" htmlFor="edit-instruction">
        修改要求
      </label>
      <input
        id="edit-instruction"
        className="input"
        placeholder="例如：移除雨伞，补上雨丝"
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
      />
      <p className="muted mt-2 text-xs">
        系统会发送原分辨率的画格和遮罩，以及缩小后的角色参考图。生成结果会另存为新版本，并保留当前版本。
      </p>
    </Modal>
  );
}
