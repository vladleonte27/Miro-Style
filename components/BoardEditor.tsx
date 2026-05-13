"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  deleteBoard,
  getBoard,
  renameBoard,
  saveBoard,
} from "@/lib/storage";
import type { Board, Edge, Shape, ShapeKind } from "@/lib/types";
import { newId } from "@/lib/id";
import { layoutMindmap, type MindmapNode } from "@/lib/mindmap";
import ImportDialog from "./ImportDialog";

type Mode = "select" | "connect";
type Corner = "nw" | "ne" | "sw" | "se";

type Drag =
  | { kind: "none" }
  | { kind: "pan"; startSx: number; startSy: number; startTx: number; startTy: number }
  | { kind: "move"; id: string; startSx: number; startSy: number; origX: number; origY: number; scale: number; moved: boolean }
  | { kind: "resize"; id: string; corner: Corner; orig: Shape; startSx: number; startSy: number; scale: number }
  | { kind: "pinch"; initialDist: number; initialScale: number; initialTx: number; initialTy: number; centerSx: number; centerSy: number }
  | { kind: "connecting"; fromId: string };

const DEFAULTS: Record<ShapeKind, Pick<Shape, "w" | "h" | "fill" | "stroke" | "fontSize">> = {
  rect: { w: 160, h: 96, fill: "#fef3c7", stroke: "#1f2937", fontSize: 14 },
  ellipse: { w: 160, h: 96, fill: "#dbeafe", stroke: "#1f2937", fontSize: 14 },
  diamond: { w: 144, h: 124, fill: "#dcfce7", stroke: "#1f2937", fontSize: 14 },
  text: { w: 220, h: 44, fill: "transparent", stroke: "transparent", fontSize: 18 },
};

const SWATCHES = ["#fef3c7", "#dbeafe", "#dcfce7", "#fbcfe8", "#ddd6fe", "#fed7aa", "#fecaca", "#ffffff"];
const FONT_MIN = 10;
const FONT_MAX = 72;
const FONT_STEP = 2;
const HIGHLIGHT_COLOR = "#fde047";

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
function shapeCenter(s: Shape) {
  return { x: s.x + s.w / 2, y: s.y + s.h / 2 };
}
function effFontSize(s: Shape): number {
  return s.fontSize ?? (s.kind === "text" ? 18 : 14);
}
function pointInShape(s: Shape, x: number, y: number): boolean {
  return x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h;
}

export default function BoardEditor({ boardId }: { boardId: string }) {
  const router = useRouter();
  const [board, setBoard] = useState<Board | null | undefined>(undefined);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("select");
  const [edgeFromId, setEdgeFromId] = useState<string | null>(null);
  const [viewport, setViewport] = useState({ tx: 0, ty: 0, scale: 1 });
  const [importOpen, setImportOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [connectPreview, setConnectPreview] = useState<{
    fromId: string;
    toX: number;
    toY: number;
    targetId: string | null;
  } | null>(null);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<Drag>({ kind: "none" });
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const shapesRef = useRef<Shape[]>([]);
  const viewportRef = useRef(viewport);

  useEffect(() => {
    shapesRef.current = shapes;
  }, [shapes]);
  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  // Load board
  useEffect(() => {
    const b = getBoard(boardId);
    if (!b) {
      setBoard(null);
      return;
    }
    setBoard(b);
    setShapes(b.shapes);
    setEdges(b.edges);
    setName(b.name);
  }, [boardId]);

  // Auto-save
  useEffect(() => {
    if (!board) return;
    const t = setTimeout(() => {
      saveBoard({ ...board, name, shapes, edges });
    }, 350);
    return () => clearTimeout(t);
  }, [board, name, shapes, edges]);

  // Wheel zoom (desktop)
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = svg!.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      setViewport((v) => {
        const factor = e.deltaY > 0 ? 1 / 1.1 : 1.1;
        const scale = clamp(v.scale * factor, 0.15, 4);
        const bx = (sx - v.tx) / v.scale;
        const by = (sy - v.ty) / v.scale;
        return { scale, tx: sx - bx * scale, ty: sy - by * scale };
      });
    }
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  // Global pointer move/up for drags + pinch + connecting
  useEffect(() => {
    function onMove(e: PointerEvent) {
      const d = dragRef.current;
      if (d.kind === "none") return;
      const svg = svgRef.current;
      if (!svg) return;
      if (pointersRef.current.has(e.pointerId)) {
        pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      const rect = svg.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      if (d.kind === "pinch") {
        const pts = [...pointersRef.current.values()].slice(0, 2);
        if (pts.length < 2) return;
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        const mx = (pts[0].x + pts[1].x) / 2 - rect.left;
        const my = (pts[0].y + pts[1].y) / 2 - rect.top;
        const scale = clamp(d.initialScale * (dist / d.initialDist), 0.15, 4);
        const bx = (d.centerSx - d.initialTx) / d.initialScale;
        const by = (d.centerSy - d.initialTy) / d.initialScale;
        setViewport({ scale, tx: mx - bx * scale, ty: my - by * scale });
        return;
      }
      if (d.kind === "connecting") {
        const vp = viewportRef.current;
        const bx = (sx - vp.tx) / vp.scale;
        const by = (sy - vp.ty) / vp.scale;
        let targetId: string | null = null;
        const list = shapesRef.current;
        for (let i = list.length - 1; i >= 0; i--) {
          const s = list[i];
          if (s.id === d.fromId) continue;
          if (pointInShape(s, bx, by)) {
            targetId = s.id;
            break;
          }
        }
        setConnectPreview({ fromId: d.fromId, toX: bx, toY: by, targetId });
        return;
      }
      if (d.kind === "pan") {
        setViewport((v) => ({ ...v, tx: d.startTx + (sx - d.startSx), ty: d.startTy + (sy - d.startSy) }));
        return;
      }
      if (d.kind === "move") {
        const dx = (sx - d.startSx) / d.scale;
        const dy = (sy - d.startSy) / d.scale;
        if (Math.abs(dx) + Math.abs(dy) > 1) d.moved = true;
        setShapes((ss) => ss.map((s) => (s.id === d.id ? { ...s, x: d.origX + dx, y: d.origY + dy } : s)));
        return;
      }
      if (d.kind === "resize") {
        const dx = (sx - d.startSx) / d.scale;
        const dy = (sy - d.startSy) / d.scale;
        setShapes((ss) =>
          ss.map((s) => {
            if (s.id !== d.id) return s;
            const o = d.orig;
            let nx = o.x, ny = o.y, nw = o.w, nh = o.h;
            if (d.corner === "se") { nw = o.w + dx; nh = o.h + dy; }
            if (d.corner === "ne") { ny = o.y + dy; nh = o.h - dy; nw = o.w + dx; }
            if (d.corner === "sw") { nx = o.x + dx; nw = o.w - dx; nh = o.h + dy; }
            if (d.corner === "nw") { nx = o.x + dx; ny = o.y + dy; nw = o.w - dx; nh = o.h - dy; }
            return { ...s, x: nx, y: ny, w: Math.max(40, nw), h: Math.max(32, nh) };
          }),
        );
      }
    }
    function onEnd(e: PointerEvent) {
      pointersRef.current.delete(e.pointerId);
      const d = dragRef.current;
      if (d.kind === "connecting") {
        const preview = connectPreviewRef.current;
        if (preview?.targetId) {
          const fromId = d.fromId;
          const toId = preview.targetId;
          setEdges((es) =>
            es.some((x) => x.from === fromId && x.to === toId)
              ? es
              : [...es, { id: newId("e_"), from: fromId, to: toId }],
          );
        }
        setConnectPreview(null);
        dragRef.current = { kind: "none" };
        return;
      }
      if (d.kind === "pinch" && pointersRef.current.size < 2) {
        dragRef.current = { kind: "none" };
      } else if (pointersRef.current.size === 0) {
        dragRef.current = { kind: "none" };
      }
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };
  }, []);

  // Keep latest connectPreview accessible in onEnd
  const connectPreviewRef = useRef<typeof connectPreview>(null);
  useEffect(() => {
    connectPreviewRef.current = connectPreview;
  }, [connectPreview]);

  // Keyboard (desktop)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (editingId) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        deleteShape(selectedId);
      } else if (e.key === "Escape") {
        setMode("select");
        setEdgeFromId(null);
        setSelectedId(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, editingId]);

  function deleteShape(id: string) {
    setShapes((s) => s.filter((x) => x.id !== id));
    setEdges((es) => es.filter((x) => x.from !== id && x.to !== id));
    if (selectedId === id) setSelectedId(null);
    if (editingId === id) setEditingId(null);
  }

  function trySwitchToPinch(): boolean {
    if (pointersRef.current.size < 2) return false;
    const pts = [...pointersRef.current.values()].slice(0, 2);
    const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    const rect = svgRef.current!.getBoundingClientRect();
    const centerSx = (pts[0].x + pts[1].x) / 2 - rect.left;
    const centerSy = (pts[0].y + pts[1].y) / 2 - rect.top;
    dragRef.current = {
      kind: "pinch",
      initialDist: dist,
      initialScale: viewport.scale,
      initialTx: viewport.tx,
      initialTy: viewport.ty,
      centerSx,
      centerSy,
    };
    setConnectPreview(null);
    return true;
  }

  function addShape(kind: ShapeKind) {
    const rect = svgRef.current!.getBoundingClientRect();
    const cx = (rect.width / 2 - viewport.tx) / viewport.scale;
    const cy = (rect.height / 2 - viewport.ty) / viewport.scale;
    const d = DEFAULTS[kind];
    const s: Shape = {
      id: newId("s_"),
      kind,
      x: cx - d.w / 2,
      y: cy - d.h / 2,
      w: d.w,
      h: d.h,
      text: kind === "text" ? "Text" : "",
      fill: d.fill,
      stroke: d.stroke,
      fontSize: d.fontSize,
    };
    setShapes((ss) => [...ss, s]);
    setSelectedId(s.id);
    setAddOpen(false);
  }

  function maybeCloseEdit() {
    if (editingId) setEditingId(null);
  }

  function onShapePointerDown(e: React.PointerEvent, s: Shape) {
    e.stopPropagation();
    maybeCloseEdit();
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (trySwitchToPinch()) return;

    if (mode === "connect") {
      if (!edgeFromId) {
        setEdgeFromId(s.id);
      } else if (edgeFromId !== s.id) {
        setEdges((es) =>
          es.some((x) => x.from === edgeFromId && x.to === s.id)
            ? es
            : [...es, { id: newId("e_"), from: edgeFromId, to: s.id }],
        );
        setEdgeFromId(null);
        setMode("select");
      }
      return;
    }
    setSelectedId(s.id);
    const rect = svgRef.current!.getBoundingClientRect();
    dragRef.current = {
      kind: "move",
      id: s.id,
      startSx: e.clientX - rect.left,
      startSy: e.clientY - rect.top,
      origX: s.x,
      origY: s.y,
      scale: viewport.scale,
      moved: false,
    };
  }

  function onCanvasPointerDown(e: React.PointerEvent) {
    maybeCloseEdit();
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (trySwitchToPinch()) return;

    setSelectedId(null);
    setAddOpen(false);
    setMenuOpen(false);
    if (mode === "connect") {
      setEdgeFromId(null);
      setMode("select");
      return;
    }
    const rect = svgRef.current!.getBoundingClientRect();
    dragRef.current = {
      kind: "pan",
      startSx: e.clientX - rect.left,
      startSy: e.clientY - rect.top,
      startTx: viewport.tx,
      startTy: viewport.ty,
    };
  }

  function onHandlePointerDown(e: React.PointerEvent, s: Shape, corner: Corner) {
    e.stopPropagation();
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (trySwitchToPinch()) return;
    const rect = svgRef.current!.getBoundingClientRect();
    dragRef.current = {
      kind: "resize",
      id: s.id,
      corner,
      orig: { ...s },
      startSx: e.clientX - rect.left,
      startSy: e.clientY - rect.top,
      scale: viewport.scale,
    };
  }

  function onDotPointerDown(e: React.PointerEvent, s: Shape) {
    e.stopPropagation();
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (trySwitchToPinch()) return;
    dragRef.current = { kind: "connecting", fromId: s.id };
    const c = shapeCenter(s);
    setConnectPreview({ fromId: s.id, toX: c.x, toY: c.y, targetId: null });
  }

  function updateShape(id: string, patch: Partial<Shape>) {
    setShapes((ss) => ss.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function bumpFontSize(id: string, delta: number) {
    setShapes((ss) =>
      ss.map((s) => (s.id === id ? { ...s, fontSize: clamp(effFontSize(s) + delta, FONT_MIN, FONT_MAX) } : s)),
    );
  }

  function applyMindmap(root: MindmapNode) {
    const { shapes: ms, edges: me } = layoutMindmap(root);
    const rect = svgRef.current!.getBoundingClientRect();
    const cx = (rect.width / 2 - viewport.tx) / viewport.scale;
    const cy = (rect.height / 2 - viewport.ty) / viewport.scale;
    const minX = Math.min(...ms.map((s) => s.x));
    const maxX = Math.max(...ms.map((s) => s.x + s.w));
    const minY = Math.min(...ms.map((s) => s.y));
    const maxY = Math.max(...ms.map((s) => s.y + s.h));
    const dx = cx - (minX + maxX) / 2;
    const dy = cy - (minY + maxY) / 2;
    setShapes((ss) => [...ss, ...ms.map((s) => ({ ...s, x: s.x + dx, y: s.y + dy }))]);
    setEdges((es) => [...es, ...me]);
  }

  function onDeleteBoard() {
    if (!board) return;
    if (window.confirm("Delete this board permanently?")) {
      deleteBoard(board.id);
      router.push("/");
    }
  }

  if (board === undefined) return <div className="p-8 text-slate-500">Loading…</div>;
  if (board === null) {
    return (
      <div className="p-8">
        <p className="mb-4">Board not found.</p>
        <Link href="/" className="underline">Back to boards</Link>
      </div>
    );
  }

  const selected = shapes.find((s) => s.id === selectedId) ?? null;
  const editing = shapes.find((s) => s.id === editingId) ?? null;
  const connectingFrom = connectPreview ? shapes.find((s) => s.id === connectPreview.fromId) ?? null : null;

  return (
    <div className="flex flex-col" style={{ height: "100dvh" }}>
      <header
        className="flex items-center gap-2 px-2 sm:px-4 py-2 border-b bg-white"
        style={{ paddingTop: "max(8px, env(safe-area-inset-top))" }}
      >
        <Link
          href="/"
          className="px-3 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-lg leading-none"
          aria-label="Back to boards"
        >
          ←
        </Link>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => board && renameBoard(board.id, name)}
          className="flex-1 min-w-0 text-sm font-medium px-2 py-2 rounded hover:bg-slate-100 focus:bg-slate-100 focus:outline-none"
        />
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="px-3 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-xl leading-none"
            aria-label="Board menu"
          >
            ⋮
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 bg-white border shadow-lg rounded-lg py-1 w-44 z-30">
              <button
                onClick={() => { setMenuOpen(false); onDeleteBoard(); }}
                className="block w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50"
              >
                Delete board
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="relative flex-1 overflow-hidden canvas-bg">
        <svg
          ref={svgRef}
          className="canvas-surface absolute inset-0 w-full h-full"
          onPointerDown={onCanvasPointerDown}
        >
          <g transform={`translate(${viewport.tx} ${viewport.ty}) scale(${viewport.scale})`}>
            {edges.map((e) => {
              const a = shapes.find((s) => s.id === e.from);
              const b = shapes.find((s) => s.id === e.to);
              if (!a || !b) return null;
              const p1 = shapeCenter(a);
              const p2 = shapeCenter(b);
              return (
                <line
                  key={e.id}
                  x1={p1.x}
                  y1={p1.y}
                  x2={p2.x}
                  y2={p2.y}
                  stroke="#475569"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}

            {/* Live connection preview line */}
            {connectPreview && connectingFrom && (
              <line
                x1={shapeCenter(connectingFrom).x}
                y1={shapeCenter(connectingFrom).y}
                x2={connectPreview.toX}
                y2={connectPreview.toY}
                stroke="#6366f1"
                strokeWidth={2.5}
                strokeDasharray="6 4"
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            )}

            {shapes.map((s) => (
              <ShapeNode
                key={s.id}
                shape={s}
                selected={s.id === selectedId}
                connectSource={s.id === edgeFromId || s.id === connectPreview?.fromId}
                connectTarget={s.id === connectPreview?.targetId}
                onPointerDown={(e) => onShapePointerDown(e, s)}
                onDoubleClick={() => {
                  setEditingId(s.id);
                  setSelectedId(s.id);
                }}
              />
            ))}

            {selected && !editing && (
              <>
                <ResizeHandles
                  shape={selected}
                  scale={viewport.scale}
                  onHandle={(corner, e) => onHandlePointerDown(e, selected, corner)}
                />
                <ConnectionDots
                  shape={selected}
                  scale={viewport.scale}
                  onStart={(e) => onDotPointerDown(e, selected)}
                />
              </>
            )}
          </g>
        </svg>

        {editing && (
          <>
            <TextEditOverlay
              shape={editing}
              viewport={viewport}
              onChange={(text) => updateShape(editing.id, { text })}
              onDone={() => setEditingId(null)}
            />
            <EditingTopBar
              shape={editing}
              onToggle={(patch) => updateShape(editing.id, patch)}
              onBump={(delta) => bumpFontSize(editing.id, delta)}
              onDone={() => setEditingId(null)}
            />
          </>
        )}

        {mode === "connect" && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-xs px-3 py-2 rounded-full shadow z-10 pointer-events-none">
            {edgeFromId ? "Tap a target shape" : "Tap source, then target"}
          </div>
        )}

        {selected && !editing ? (
          <Inspector
            shape={selected}
            onChange={(patch) => updateShape(selected.id, patch)}
            onBump={(delta) => bumpFontSize(selected.id, delta)}
            onDelete={() => deleteShape(selected.id)}
            onEditText={() => setEditingId(selected.id)}
          />
        ) : (
          !editing && (
            <BottomToolbar
              mode={mode}
              addOpen={addOpen}
              onToggleAdd={() => setAddOpen((v) => !v)}
              onAdd={addShape}
              onToggleConnect={() => setMode((m) => (m === "connect" ? "select" : "connect"))}
              onImport={() => setImportOpen(true)}
            />
          )
        )}
      </div>

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImport={applyMindmap}
      />
    </div>
  );
}

// ---------- sub-components ----------

function ShapeNode({
  shape,
  selected,
  connectSource,
  connectTarget,
  onPointerDown,
  onDoubleClick,
}: {
  shape: Shape;
  selected: boolean;
  connectSource: boolean;
  connectTarget: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onDoubleClick: () => void;
}) {
  const strokeColor = connectTarget
    ? "#22c55e"
    : connectSource
      ? "#6366f1"
      : selected
        ? "#0ea5e9"
        : shape.stroke;
  const strokeW = selected || connectSource || connectTarget ? 2.5 : 1.5;
  const handlers = {
    onPointerDown,
    onDoubleClick,
    style: { cursor: "move" as const, touchAction: "none" as const },
  };

  let geometry: React.ReactNode;
  if (shape.kind === "rect") {
    geometry = (
      <rect
        x={shape.x} y={shape.y} width={shape.w} height={shape.h}
        rx={10} ry={10}
        fill={shape.fill} stroke={strokeColor} strokeWidth={strokeW}
        vectorEffect="non-scaling-stroke" {...handlers}
      />
    );
  } else if (shape.kind === "ellipse") {
    geometry = (
      <ellipse
        cx={shape.x + shape.w / 2} cy={shape.y + shape.h / 2}
        rx={shape.w / 2} ry={shape.h / 2}
        fill={shape.fill} stroke={strokeColor} strokeWidth={strokeW}
        vectorEffect="non-scaling-stroke" {...handlers}
      />
    );
  } else if (shape.kind === "diamond") {
    const pts = [
      `${shape.x + shape.w / 2},${shape.y}`,
      `${shape.x + shape.w},${shape.y + shape.h / 2}`,
      `${shape.x + shape.w / 2},${shape.y + shape.h}`,
      `${shape.x},${shape.y + shape.h / 2}`,
    ].join(" ");
    geometry = (
      <polygon
        points={pts}
        fill={shape.fill} stroke={strokeColor} strokeWidth={strokeW}
        vectorEffect="non-scaling-stroke" {...handlers}
      />
    );
  } else {
    geometry = (
      <rect
        x={shape.x} y={shape.y} width={shape.w} height={shape.h}
        fill="transparent"
        stroke={selected || connectSource || connectTarget ? strokeColor : "transparent"}
        strokeDasharray={selected ? "4 4" : undefined}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke" {...handlers}
      />
    );
  }

  return (
    <g>
      {geometry}
      <foreignObject
        x={shape.x} y={shape.y} width={shape.w} height={shape.h}
        pointerEvents="none"
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 8,
            boxSizing: "border-box",
            color: "#0f172a",
            textAlign: "center",
            wordBreak: "break-word",
            lineHeight: 1.25,
            userSelect: "none",
            fontSize: effFontSize(shape),
            fontWeight: shape.bold ? 700 : 400,
            fontStyle: shape.italic ? "italic" : "normal",
          }}
        >
          <span
            style={{
              backgroundColor: shape.highlight ? HIGHLIGHT_COLOR : "transparent",
              padding: shape.highlight ? "2px 6px" : 0,
              borderRadius: 4,
            }}
          >
            {shape.text}
          </span>
        </div>
      </foreignObject>
    </g>
  );
}

function ResizeHandles({
  shape,
  scale,
  onHandle,
}: {
  shape: Shape;
  scale: number;
  onHandle: (corner: Corner, e: React.PointerEvent) => void;
}) {
  const vis = 9 / scale;
  const hit = 28 / scale;
  const corners: { key: Corner; x: number; y: number; cursor: string }[] = [
    { key: "nw", x: shape.x, y: shape.y, cursor: "nwse-resize" },
    { key: "ne", x: shape.x + shape.w, y: shape.y, cursor: "nesw-resize" },
    { key: "sw", x: shape.x, y: shape.y + shape.h, cursor: "nesw-resize" },
    { key: "se", x: shape.x + shape.w, y: shape.y + shape.h, cursor: "nwse-resize" },
  ];
  return (
    <>
      {corners.map((c) => (
        <g key={c.key}>
          <rect
            x={c.x - hit / 2} y={c.y - hit / 2}
            width={hit} height={hit}
            fill="transparent"
            style={{ cursor: c.cursor, touchAction: "none" }}
            onPointerDown={(e) => onHandle(c.key, e)}
          />
          <rect
            x={c.x - vis / 2} y={c.y - vis / 2}
            width={vis} height={vis}
            fill="#ffffff" stroke="#0ea5e9" strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        </g>
      ))}
    </>
  );
}

function ConnectionDots({
  shape,
  scale,
  onStart,
}: {
  shape: Shape;
  scale: number;
  onStart: (e: React.PointerEvent) => void;
}) {
  const vis = 12 / scale;
  const hit = 32 / scale;
  const dots = [
    { x: shape.x + shape.w / 2, y: shape.y },
    { x: shape.x + shape.w, y: shape.y + shape.h / 2 },
    { x: shape.x + shape.w / 2, y: shape.y + shape.h },
    { x: shape.x, y: shape.y + shape.h / 2 },
  ];
  return (
    <>
      {dots.map((d, i) => (
        <g key={i}>
          <circle
            cx={d.x} cy={d.y} r={hit / 2}
            fill="transparent"
            style={{ cursor: "crosshair", touchAction: "none" }}
            onPointerDown={onStart}
          />
          <circle
            cx={d.x} cy={d.y} r={vis / 2}
            fill="#ffffff" stroke="#6366f1" strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        </g>
      ))}
    </>
  );
}

function TextEditOverlay({
  shape,
  viewport,
  onChange,
  onDone,
}: {
  shape: Shape;
  viewport: { tx: number; ty: number; scale: number };
  onChange: (text: string) => void;
  onDone: () => void;
}) {
  const left = shape.x * viewport.scale + viewport.tx;
  const top = shape.y * viewport.scale + viewport.ty;
  const width = shape.w * viewport.scale;
  const height = shape.h * viewport.scale;
  const fontPx = effFontSize(shape) * viewport.scale;

  return (
    <textarea
      autoFocus
      value={shape.text}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape" || (e.key === "Enter" && !e.shiftKey)) {
          e.preventDefault();
          onDone();
        }
      }}
      style={{
        position: "absolute",
        left,
        top,
        width,
        height: Math.max(height, 44),
        padding: 8,
        boxSizing: "border-box",
        textAlign: "center",
        fontSize: Math.max(14, fontPx),
        fontWeight: shape.bold ? 700 : 400,
        fontStyle: shape.italic ? "italic" : "normal",
        lineHeight: 1.25,
        border: "2px solid #0ea5e9",
        borderRadius: 8,
        background: shape.highlight ? HIGHLIGHT_COLOR : "white",
        resize: "none",
        outline: "none",
        zIndex: 20,
      }}
    />
  );
}

function FmtBtn({
  active,
  label,
  bold,
  italic,
  onActivate,
  ariaLabel,
}: {
  active: boolean;
  label: string;
  bold?: boolean;
  italic?: boolean;
  onActivate: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      onMouseDown={(e) => e.preventDefault()}
      onClick={onActivate}
      aria-pressed={active}
      aria-label={ariaLabel}
      className={`h-11 min-w-11 px-2 rounded-xl text-sm ${active ? "bg-slate-900 text-white" : "hover:bg-slate-100"}`}
      style={{ fontWeight: bold ? 700 : undefined, fontStyle: italic ? "italic" : undefined }}
    >
      {label}
    </button>
  );
}

function EditingTopBar({
  shape,
  onToggle,
  onBump,
  onDone,
}: {
  shape: Shape;
  onToggle: (patch: Partial<Shape>) => void;
  onBump: (delta: number) => void;
  onDone: () => void;
}) {
  return (
    <div
      className="absolute left-0 right-0 px-2 z-40 pointer-events-none"
      style={{ top: "max(8px, env(safe-area-inset-top))" }}
    >
      <div className="flex justify-center">
        <div className="pointer-events-auto bg-white border shadow-lg rounded-2xl p-1.5 flex items-center gap-1">
          <FmtBtn label="B" bold active={!!shape.bold} onActivate={() => onToggle({ bold: !shape.bold })} ariaLabel="Bold" />
          <FmtBtn label="I" italic active={!!shape.italic} onActivate={() => onToggle({ italic: !shape.italic })} ariaLabel="Italic" />
          <FmtBtn label="H" active={!!shape.highlight} onActivate={() => onToggle({ highlight: !shape.highlight })} ariaLabel="Highlight" />
          <div className="w-px h-6 bg-slate-200 mx-0.5" />
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onBump(-FONT_STEP)}
            className="h-11 min-w-11 px-2 rounded-xl hover:bg-slate-100 text-sm"
            aria-label="Smaller text"
          >
            A−
          </button>
          <div className="px-1 text-xs text-slate-500 tabular-nums w-8 text-center">
            {effFontSize(shape)}
          </div>
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onBump(FONT_STEP)}
            className="h-11 min-w-11 px-2 rounded-xl hover:bg-slate-100 text-sm"
            aria-label="Larger text"
          >
            A+
          </button>
          <div className="w-px h-6 bg-slate-200 mx-0.5" />
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={onDone}
            className="h-11 px-3 rounded-xl bg-slate-900 text-white text-sm font-medium"
          >
            Done ✓
          </button>
        </div>
      </div>
    </div>
  );
}

function BottomToolbar({
  mode,
  addOpen,
  onToggleAdd,
  onAdd,
  onToggleConnect,
  onImport,
}: {
  mode: Mode;
  addOpen: boolean;
  onToggleAdd: () => void;
  onAdd: (k: ShapeKind) => void;
  onToggleConnect: () => void;
  onImport: () => void;
}) {
  return (
    <div
      className="absolute left-0 right-0 bottom-0 px-2 pointer-events-none z-10"
      style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}
    >
      <div className="flex justify-center">
        <div className="pointer-events-auto bg-white border shadow-lg rounded-2xl p-1.5 flex items-center gap-1">
          <div className="relative">
            <button
              onClick={onToggleAdd}
              className={`px-3 h-11 min-w-11 rounded-xl text-sm font-medium ${addOpen ? "bg-slate-900 text-white" : "hover:bg-slate-100"}`}
              aria-expanded={addOpen}
            >
              + Shape
            </button>
            {addOpen && (
              <div className="absolute bottom-full mb-2 left-0 bg-white border shadow-lg rounded-xl p-1 flex flex-col w-44 z-20">
                {(
                  [
                    ["rect", "▭  Rectangle"],
                    ["ellipse", "◯  Ellipse"],
                    ["diamond", "◇  Diamond"],
                    ["text", "T  Text"],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => onAdd(k)}
                    className="px-3 h-11 text-left rounded-lg hover:bg-slate-100 text-sm"
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={onToggleConnect}
            className={`px-3 h-11 min-w-11 rounded-xl text-sm font-medium ${mode === "connect" ? "bg-slate-900 text-white" : "hover:bg-slate-100"}`}
            aria-pressed={mode === "connect"}
          >
            ↔ Connect
          </button>
          <button
            onClick={onImport}
            className="px-3 h-11 min-w-11 rounded-xl text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700"
          >
            📋 Import
          </button>
        </div>
      </div>
    </div>
  );
}

function Inspector({
  shape,
  onChange,
  onBump,
  onDelete,
  onEditText,
}: {
  shape: Shape;
  onChange: (p: Partial<Shape>) => void;
  onBump: (delta: number) => void;
  onDelete: () => void;
  onEditText: () => void;
}) {
  return (
    <div
      className="absolute left-2 right-2 bottom-0 z-10 pointer-events-none"
      style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}
    >
      <div className="flex justify-center">
        <div className="pointer-events-auto bg-white border shadow-lg rounded-2xl p-2 w-full max-w-md flex flex-col gap-2">
          {/* Row 1: formatting */}
          <div className="flex items-center gap-1">
            <FmtBtn label="B" bold active={!!shape.bold} onActivate={() => onChange({ bold: !shape.bold })} ariaLabel="Bold" />
            <FmtBtn label="I" italic active={!!shape.italic} onActivate={() => onChange({ italic: !shape.italic })} ariaLabel="Italic" />
            <FmtBtn label="H" active={!!shape.highlight} onActivate={() => onChange({ highlight: !shape.highlight })} ariaLabel="Highlight" />
            <div className="w-px h-6 bg-slate-200 mx-0.5" />
            <button
              onClick={() => onBump(-FONT_STEP)}
              className="h-11 min-w-11 px-2 rounded-xl hover:bg-slate-100 text-sm"
              aria-label="Smaller text"
            >
              A−
            </button>
            <div className="px-1 text-xs text-slate-500 tabular-nums w-8 text-center">
              {effFontSize(shape)}
            </div>
            <button
              onClick={() => onBump(FONT_STEP)}
              className="h-11 min-w-11 px-2 rounded-xl hover:bg-slate-100 text-sm"
              aria-label="Larger text"
            >
              A+
            </button>
            <div className="flex-1" />
            <button
              onClick={onEditText}
              className="h-11 min-w-11 px-3 rounded-xl hover:bg-slate-100 text-sm"
              aria-label="Edit text"
            >
              ✎
            </button>
            <button
              onClick={onDelete}
              className="h-11 min-w-11 px-3 rounded-xl hover:bg-red-50 text-red-600 text-sm"
              aria-label="Delete shape"
            >
              🗑
            </button>
          </div>
          {/* Row 2: colors */}
          <div className="flex flex-wrap gap-1.5 px-1">
            {SWATCHES.map((c) => (
              <button
                key={c}
                onClick={() => onChange({ fill: c })}
                className={`w-8 h-8 rounded-full border ${shape.fill === c ? "ring-2 ring-slate-900 ring-offset-1" : ""}`}
                style={{ background: c }}
                aria-label={`Fill ${c}`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
