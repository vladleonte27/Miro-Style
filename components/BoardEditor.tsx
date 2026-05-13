"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import AIMindmapDialog from "./AIMindmapDialog";

type Mode = "select" | "connect";

type Drag =
  | { kind: "none" }
  | { kind: "pan"; startSx: number; startSy: number; startTx: number; startTy: number }
  | { kind: "move"; id: string; startSx: number; startSy: number; origX: number; origY: number; scale: number; moved: boolean }
  | { kind: "resize"; id: string; corner: "nw" | "ne" | "sw" | "se"; orig: Shape; startSx: number; startSy: number; scale: number };

const DEFAULTS: Record<ShapeKind, Pick<Shape, "w" | "h" | "fill" | "stroke">> = {
  rect: { w: 160, h: 90, fill: "#fef3c7", stroke: "#1f2937" },
  ellipse: { w: 160, h: 90, fill: "#dbeafe", stroke: "#1f2937" },
  diamond: { w: 140, h: 120, fill: "#dcfce7", stroke: "#1f2937" },
  text: { w: 220, h: 40, fill: "transparent", stroke: "transparent" },
};

const SWATCHES = ["#fef3c7", "#dbeafe", "#dcfce7", "#fbcfe8", "#ddd6fe", "#fed7aa", "#fecaca", "#ffffff"];

function shapeCenter(s: Shape) {
  return { x: s.x + s.w / 2, y: s.y + s.h / 2 };
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
  const [aiOpen, setAiOpen] = useState(false);
  const [name, setName] = useState("");

  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<Drag>({ kind: "none" });

  // ---- Load board ----
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

  // ---- Auto-save (debounced) ----
  useEffect(() => {
    if (!board) return;
    const t = setTimeout(() => {
      saveBoard({ ...board, name, shapes, edges });
    }, 350);
    return () => clearTimeout(t);
  }, [board, name, shapes, edges]);

  // ---- Wheel zoom (non-passive) ----
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
        const scale = Math.max(0.15, Math.min(4, v.scale * factor));
        const bx = (sx - v.tx) / v.scale;
        const by = (sy - v.ty) / v.scale;
        return { scale, tx: sx - bx * scale, ty: sy - by * scale };
      });
    }
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  // ---- Window-level mouse move/up for drag ----
  useEffect(() => {
    function onMove(e: MouseEvent) {
      const d = dragRef.current;
      const svg = svgRef.current;
      if (!svg || d.kind === "none") return;
      const rect = svg.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      if (d.kind === "pan") {
        const dx = sx - d.startSx;
        const dy = sy - d.startSy;
        setViewport((v) => ({ ...v, tx: d.startTx + dx, ty: d.startTy + dy }));
      } else if (d.kind === "move") {
        const dx = (sx - d.startSx) / d.scale;
        const dy = (sy - d.startSy) / d.scale;
        if (Math.abs(dx) + Math.abs(dy) > 1) d.moved = true;
        setShapes((ss) =>
          ss.map((s) => (s.id === d.id ? { ...s, x: d.origX + dx, y: d.origY + dy } : s)),
        );
      } else if (d.kind === "resize") {
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
            return { ...s, x: nx, y: ny, w: Math.max(30, nw), h: Math.max(24, nh) };
          }),
        );
      }
    }
    function onUp() {
      dragRef.current = { kind: "none" };
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  // ---- Keyboard ----
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (editingId) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        setShapes((s) => s.filter((x) => x.id !== selectedId));
        setEdges((es) => es.filter((x) => x.from !== selectedId && x.to !== selectedId));
        setSelectedId(null);
      } else if (e.key === "Escape") {
        setMode("select");
        setEdgeFromId(null);
        setSelectedId(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, editingId]);

  // ---- Helpers ----
  function screenToBoard(clientX: number, clientY: number) {
    const svg = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    return { x: (sx - viewport.tx) / viewport.scale, y: (sy - viewport.ty) / viewport.scale };
  }

  function addShape(kind: ShapeKind) {
    const svg = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    // place at center of current view
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
    };
    setShapes((ss) => [...ss, s]);
    setSelectedId(s.id);
  }

  function onShapeMouseDown(e: React.MouseEvent, s: Shape) {
    e.stopPropagation();
    if (editingId) return;
    if (mode === "connect") {
      if (!edgeFromId) {
        setEdgeFromId(s.id);
      } else if (edgeFromId !== s.id) {
        // create edge if not duplicate
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
    dragRef.current = {
      kind: "move",
      id: s.id,
      startSx: e.clientX - svgRef.current!.getBoundingClientRect().left,
      startSy: e.clientY - svgRef.current!.getBoundingClientRect().top,
      origX: s.x,
      origY: s.y,
      scale: viewport.scale,
      moved: false,
    };
  }

  function onCanvasMouseDown(e: React.MouseEvent) {
    if (editingId) return;
    setSelectedId(null);
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

  function onHandleMouseDown(e: React.MouseEvent, s: Shape, corner: "nw" | "ne" | "sw" | "se") {
    e.stopPropagation();
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

  function updateShape(id: string, patch: Partial<Shape>) {
    setShapes((ss) => ss.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function applyMindmap(root: MindmapNode) {
    const { shapes: ms, edges: me } = layoutMindmap(root);
    // place at viewport center
    const svg = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    const cx = (rect.width / 2 - viewport.tx) / viewport.scale;
    const cy = (rect.height / 2 - viewport.ty) / viewport.scale;
    // compute bounds of the laid out shapes
    const minX = Math.min(...ms.map((s) => s.x));
    const maxX = Math.max(...ms.map((s) => s.x + s.w));
    const minY = Math.min(...ms.map((s) => s.y));
    const maxY = Math.max(...ms.map((s) => s.y + s.h));
    const dx = cx - (minX + maxX) / 2;
    const dy = cy - (minY + maxY) / 2;
    const offsetted = ms.map((s) => ({ ...s, x: s.x + dx, y: s.y + dy }));
    setShapes((ss) => [...ss, ...offsetted]);
    setEdges((es) => [...es, ...me]);
  }

  function onDeleteBoard() {
    if (!board) return;
    if (window.confirm("Delete this board permanently?")) {
      deleteBoard(board.id);
      router.push("/");
    }
  }

  // ---- Render states ----
  if (board === undefined) {
    return <div className="p-8 text-slate-500">Loading…</div>;
  }
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

  return (
    <div className="h-screen flex flex-col">
      {/* Top bar */}
      <header className="flex items-center gap-3 px-4 py-2 border-b bg-white">
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-900">
          ← Boards
        </Link>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => board && renameBoard(board.id, name)}
          className="text-sm font-medium px-2 py-1 rounded hover:bg-slate-100 focus:bg-slate-100 focus:outline-none w-64"
        />
        <div className="flex-1" />

        <Toolbar
          mode={mode}
          onMode={setMode}
          onAdd={addShape}
          onAI={() => setAiOpen(true)}
        />

        <div className="w-px h-6 bg-slate-200 mx-1" />
        <button
          onClick={onDeleteBoard}
          className="text-xs text-red-600 hover:text-red-800 px-2 py-1"
          title="Delete board"
        >
          Delete board
        </button>
      </header>

      {/* Canvas */}
      <div className="relative flex-1 overflow-hidden canvas-bg">
        <svg
          ref={svgRef}
          className="absolute inset-0 w-full h-full cursor-default"
          onMouseDown={onCanvasMouseDown}
          onDoubleClick={(e) => {
            // double-click on background does nothing; shape handles its own dbl-click
            e.stopPropagation();
          }}
        >
          <g transform={`translate(${viewport.tx} ${viewport.ty}) scale(${viewport.scale})`}>
            {/* Edges first so shapes paint on top */}
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
                />
              );
            })}

            {/* Shapes */}
            {shapes.map((s) => (
              <ShapeNode
                key={s.id}
                shape={s}
                selected={s.id === selectedId}
                connectSource={s.id === edgeFromId}
                onMouseDown={(e) => onShapeMouseDown(e, s)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setEditingId(s.id);
                  setSelectedId(s.id);
                }}
              />
            ))}

            {/* Resize handles for selected shape */}
            {selected && !editing && (
              <ResizeHandles
                shape={selected}
                scale={viewport.scale}
                onHandle={(corner, e) => onHandleMouseDown(e, selected, corner)}
              />
            )}
          </g>
        </svg>

        {/* Text-edit overlay */}
        {editing && (
          <TextEditOverlay
            shape={editing}
            viewport={viewport}
            onChange={(text) => updateShape(editing.id, { text })}
            onDone={() => setEditingId(null)}
          />
        )}

        {/* Inspector for selected shape */}
        {selected && !editing && (
          <Inspector
            shape={selected}
            onChange={(patch) => updateShape(selected.id, patch)}
            onDelete={() => {
              setShapes((s) => s.filter((x) => x.id !== selected.id));
              setEdges((es) => es.filter((x) => x.from !== selected.id && x.to !== selected.id));
              setSelectedId(null);
            }}
            onEditText={() => setEditingId(selected.id)}
          />
        )}

        {/* Mode hint */}
        {mode === "connect" && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-xs px-3 py-1.5 rounded-full shadow">
            {edgeFromId ? "Click a target shape" : "Click the source shape (Esc to cancel)"}
          </div>
        )}
      </div>

      <AIMindmapDialog
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        onGenerated={applyMindmap}
      />
    </div>
  );
}

// ---------- Sub-components ----------

function Toolbar({
  mode,
  onMode,
  onAdd,
  onAI,
}: {
  mode: Mode;
  onMode: (m: Mode) => void;
  onAdd: (k: ShapeKind) => void;
  onAI: () => void;
}) {
  const btn = "px-2.5 py-1 text-xs rounded-md hover:bg-slate-100 border border-transparent";
  return (
    <div className="flex items-center gap-1">
      <button onClick={() => onAdd("rect")} className={btn} title="Rectangle">▭ Rect</button>
      <button onClick={() => onAdd("ellipse")} className={btn} title="Ellipse">◯ Ellipse</button>
      <button onClick={() => onAdd("diamond")} className={btn} title="Diamond">◇ Diamond</button>
      <button onClick={() => onAdd("text")} className={btn} title="Text">T Text</button>
      <div className="w-px h-5 bg-slate-200 mx-1" />
      <button
        onClick={() => onMode(mode === "connect" ? "select" : "connect")}
        className={`${btn} ${mode === "connect" ? "bg-slate-900 text-white hover:bg-slate-800" : ""}`}
        title="Connect shapes with edges"
      >
        ↔ Connect
      </button>
      <div className="w-px h-5 bg-slate-200 mx-1" />
      <button
        onClick={onAI}
        className="px-3 py-1 text-xs rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
        title="Generate mindmap with AI"
      >
        ✨ AI Mindmap
      </button>
    </div>
  );
}

function ShapeNode({
  shape,
  selected,
  connectSource,
  onMouseDown,
  onDoubleClick,
}: {
  shape: Shape;
  selected: boolean;
  connectSource: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onDoubleClick: (e: React.MouseEvent) => void;
}) {
  const strokeColor = connectSource ? "#6366f1" : selected ? "#0ea5e9" : shape.stroke;
  const strokeW = selected || connectSource ? 2.5 : 1.5;
  const common = {
    onMouseDown,
    onDoubleClick,
    style: { cursor: "move" as const },
  };

  let geometry: React.ReactNode;
  if (shape.kind === "rect") {
    geometry = (
      <rect
        x={shape.x}
        y={shape.y}
        width={shape.w}
        height={shape.h}
        rx={8}
        ry={8}
        fill={shape.fill}
        stroke={strokeColor}
        strokeWidth={strokeW}
        {...common}
      />
    );
  } else if (shape.kind === "ellipse") {
    geometry = (
      <ellipse
        cx={shape.x + shape.w / 2}
        cy={shape.y + shape.h / 2}
        rx={shape.w / 2}
        ry={shape.h / 2}
        fill={shape.fill}
        stroke={strokeColor}
        strokeWidth={strokeW}
        {...common}
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
      <polygon points={pts} fill={shape.fill} stroke={strokeColor} strokeWidth={strokeW} {...common} />
    );
  } else {
    // text shape: invisible rect for hit-testing + selection outline
    geometry = (
      <rect
        x={shape.x}
        y={shape.y}
        width={shape.w}
        height={shape.h}
        fill="transparent"
        stroke={selected || connectSource ? strokeColor : "transparent"}
        strokeDasharray={selected ? "4 4" : undefined}
        strokeWidth={1.5}
        {...common}
      />
    );
  }

  return (
    <g>
      {geometry}
      <foreignObject
        x={shape.x}
        y={shape.y}
        width={shape.w}
        height={shape.h}
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
            fontSize: shape.kind === "text" ? 18 : 14,
            fontWeight: shape.kind === "text" ? 500 : 400,
            color: "#0f172a",
            textAlign: "center",
            wordBreak: "break-word",
            lineHeight: 1.25,
            userSelect: "none",
          }}
        >
          {shape.text}
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
  onHandle: (corner: "nw" | "ne" | "sw" | "se", e: React.MouseEvent) => void;
}) {
  const size = 8 / scale;
  const half = size / 2;
  const corners: { key: "nw" | "ne" | "sw" | "se"; x: number; y: number; cursor: string }[] = [
    { key: "nw", x: shape.x, y: shape.y, cursor: "nwse-resize" },
    { key: "ne", x: shape.x + shape.w, y: shape.y, cursor: "nesw-resize" },
    { key: "sw", x: shape.x, y: shape.y + shape.h, cursor: "nesw-resize" },
    { key: "se", x: shape.x + shape.w, y: shape.y + shape.h, cursor: "nwse-resize" },
  ];
  return (
    <>
      {corners.map((c) => (
        <rect
          key={c.key}
          x={c.x - half}
          y={c.y - half}
          width={size}
          height={size}
          fill="#ffffff"
          stroke="#0ea5e9"
          strokeWidth={1.5 / scale}
          style={{ cursor: c.cursor }}
          onMouseDown={(e) => onHandle(c.key, e)}
        />
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

  return (
    <textarea
      autoFocus
      value={shape.text}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onDone}
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
        height,
        padding: 8,
        boxSizing: "border-box",
        textAlign: "center",
        fontSize: (shape.kind === "text" ? 18 : 14) * viewport.scale,
        fontWeight: shape.kind === "text" ? 500 : 400,
        lineHeight: 1.25,
        border: "2px solid #0ea5e9",
        borderRadius: 6,
        background: "white",
        resize: "none",
        outline: "none",
      }}
    />
  );
}

function Inspector({
  shape,
  onChange,
  onDelete,
  onEditText,
}: {
  shape: Shape;
  onChange: (p: Partial<Shape>) => void;
  onDelete: () => void;
  onEditText: () => void;
}) {
  return (
    <div className="absolute right-3 top-3 bg-white rounded-lg shadow-md border p-3 w-56 text-sm">
      <div className="text-xs uppercase tracking-wide text-slate-400 mb-2">Shape</div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {SWATCHES.map((c) => (
          <button
            key={c}
            onClick={() => onChange({ fill: c })}
            className={`w-6 h-6 rounded border ${shape.fill === c ? "ring-2 ring-slate-900" : ""}`}
            style={{ background: c }}
            title={c}
          />
        ))}
      </div>
      <button
        onClick={onEditText}
        className="w-full text-left px-2 py-1.5 rounded hover:bg-slate-100 text-xs"
      >
        ✎ Edit text
      </button>
      <button
        onClick={onDelete}
        className="w-full text-left px-2 py-1.5 rounded hover:bg-red-50 text-red-600 text-xs"
      >
        🗑 Delete
      </button>
    </div>
  );
}
