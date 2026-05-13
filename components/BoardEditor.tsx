"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  deleteBoard,
  getBoard,
  renameBoard,
  saveBoard,
} from "@/lib/storage";
import type { Anchor, Board, Edge, Shape, ShapeKind, TextAlign } from "@/lib/types";
import { newId } from "@/lib/id";
import { layoutImport, type MindmapDocument } from "@/lib/mindmap";
import ImportDialog from "./ImportDialog";
import VoiceCaptureDialog from "./VoiceCaptureDialog";
import LinkDialog, { type LinkPreview } from "./LinkDialog";
import { Icon, type IconName } from "./icons";

type AddItem = ShapeKind | "voice";

type Mode = "select" | "connect";
type Corner = "nw" | "ne" | "sw" | "se";
type Pt = { x: number; y: number };
type Viewport = { tx: number; ty: number; scale: number };
type Snapshot = { shapes: Shape[]; edges: Edge[] };
type TextStyleKey = "h1" | "h2" | "h3" | "body";

type Drag =
  | { kind: "none" }
  | { kind: "pan"; startSx: number; startSy: number; startTx: number; startTy: number }
  | { kind: "move"; ids: string[]; primaryId: string; startSx: number; startSy: number; origPositions: Map<string, { x: number; y: number }>; w: number; h: number; scale: number; moved: boolean }
  | { kind: "marquee"; startBx: number; startBy: number; additive: boolean; baseIds: string[]; moved: boolean; clickToggle: boolean }
  | { kind: "resize"; id: string; corner: Corner; orig: Shape; startSx: number; startSy: number; scale: number }
  | { kind: "pinch"; initialDist: number; initialScale: number; initialTx: number; initialTy: number; centerSx: number; centerSy: number }
  | { kind: "connecting"; fromId: string; fromAnchor: Anchor };

const DEFAULTS: Record<Exclude<ShapeKind, "image" | "link">, Pick<Shape, "w" | "h" | "fill" | "stroke" | "fontSize">> = {
  rect: { w: 160, h: 96, fill: "#fef3c7", stroke: "#1f2937", fontSize: 14 },
  ellipse: { w: 160, h: 96, fill: "#dbeafe", stroke: "#1f2937", fontSize: 14 },
  diamond: { w: 144, h: 124, fill: "#dcfce7", stroke: "#1f2937", fontSize: 14 },
  text: { w: 220, h: 44, fill: "transparent", stroke: "transparent", fontSize: 18 },
};

const SWATCHES = ["#fef3c7", "#dbeafe", "#dcfce7", "#fbcfe8", "#ddd6fe", "#fed7aa", "#fecaca", "#ffffff"];
const HIGHLIGHT_SWATCHES = ["#fde047", "#86efac", "#fda4af", "#93c5fd", "#c4b5fd", "#fdba74"];
const DEFAULT_HIGHLIGHT = "#fde047";
const FONT_MIN = 10;
const FONT_MAX = 72;
const FONT_STEP = 2;
const SNAP_PX = 6;
const HISTORY_LIMIT = 50;
const EDGE_HIT_WIDTH = 18;
const IMAGE_MAX_DIM = 1024;
const IMAGE_DEFAULT_DISPLAY = 360;

const STYLE_PRESETS: Record<TextStyleKey, { fontSize: number; bold: boolean }> = {
  h1: { fontSize: 22, bold: true },
  h2: { fontSize: 18, bold: true },
  h3: { fontSize: 16, bold: true },
  body: { fontSize: 14, bold: false },
};

const JUSTIFY: Record<TextAlign, "flex-start" | "center" | "flex-end"> = {
  left: "flex-start",
  center: "center",
  right: "flex-end",
};

// ---------- pure helpers ----------

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
function effFontSize(s: Shape): number {
  return s.fontSize ?? (s.kind === "text" ? 18 : 14);
}
function effHighlightColor(s: Shape): string {
  return s.highlightColor ?? DEFAULT_HIGHLIGHT;
}
function effTextAlign(s: Shape): TextAlign {
  return s.textAlign ?? (s.bullet ? "left" : "center");
}
function detectTextStyle(s: Shape): TextStyleKey | null {
  const fs = effFontSize(s);
  if (s.bold) {
    if (fs >= 22) return "h1";
    if (fs >= 18) return "h2";
    if (fs >= 16) return "h3";
  } else if (fs <= 14) {
    return "body";
  }
  return null;
}
function clipPathFor(kind: ShapeKind): string | undefined {
  if (kind === "ellipse") return "ellipse(50% 50% at 50% 50%)";
  if (kind === "diamond") return "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)";
  return undefined;
}
function pointInShape(s: Shape, x: number, y: number): boolean {
  return x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h;
}
function anchorPoint(s: Shape, anchor: Anchor): Pt {
  switch (anchor) {
    case "top": return { x: s.x + s.w / 2, y: s.y };
    case "right": return { x: s.x + s.w, y: s.y + s.h / 2 };
    case "bottom": return { x: s.x + s.w / 2, y: s.y + s.h };
    case "left": return { x: s.x, y: s.y + s.h / 2 };
  }
}
function controlOffset(anchor: Anchor, dist: number): Pt {
  switch (anchor) {
    case "top": return { x: 0, y: -dist };
    case "right": return { x: dist, y: 0 };
    case "bottom": return { x: 0, y: dist };
    case "left": return { x: -dist, y: 0 };
  }
}
function bestAnchorPair(a: Shape, b: Shape): [Anchor, Anchor] {
  const dx = (b.x + b.w / 2) - (a.x + a.w / 2);
  const dy = (b.y + b.h / 2) - (a.y + a.h / 2);
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? ["right", "left"] : ["left", "right"];
  }
  return dy > 0 ? ["bottom", "top"] : ["top", "bottom"];
}
function closestAnchor(s: Shape, x: number, y: number): Anchor {
  const anchors: Anchor[] = ["top", "right", "bottom", "left"];
  let best: Anchor = "top";
  let bestD = Infinity;
  for (const a of anchors) {
    const p = anchorPoint(s, a);
    const d = Math.hypot(x - p.x, y - p.y);
    if (d < bestD) { bestD = d; best = a; }
  }
  return best;
}
function edgePath(p1: Pt, p2: Pt, a1: Anchor, a2: Anchor): { d: string; mid: Pt } {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const dist = clamp(Math.hypot(dx, dy) * 0.45, 40, 240);
  const c1 = controlOffset(a1, dist);
  const c2 = controlOffset(a2, dist);
  const mid: Pt = {
    x: 0.5 * p1.x + 0.5 * p2.x + 0.375 * (c1.x + c2.x),
    y: 0.5 * p1.y + 0.5 * p2.y + 0.375 * (c1.y + c2.y),
  };
  return {
    d: `M ${p1.x} ${p1.y} C ${p1.x + c1.x} ${p1.y + c1.y}, ${p2.x + c2.x} ${p2.y + c2.y}, ${p2.x} ${p2.y}`,
    mid,
  };
}
function loosePath(p1: Pt, a1: Anchor, to: Pt): string {
  const dx = to.x - p1.x;
  const dy = to.y - p1.y;
  const dist = clamp(Math.hypot(dx, dy) * 0.5, 30, 220);
  const c1 = controlOffset(a1, dist);
  const c2 = { x: -dx * 0.3, y: -dy * 0.3 };
  return `M ${p1.x} ${p1.y} C ${p1.x + c1.x} ${p1.y + c1.y}, ${to.x + c2.x} ${to.y + c2.y}, ${to.x} ${to.y}`;
}

function computeSnap(
  x: number,
  y: number,
  w: number,
  h: number,
  others: Shape[],
  threshold: number,
): { x: number; y: number; guideX: number | null; guideY: number | null } {
  const myV = [x, x + w / 2, x + w];
  const myH = [y, y + h / 2, y + h];
  let bestDX = threshold;
  let bestDY = threshold;
  let snapDX = 0;
  let snapDY = 0;
  let guideX: number | null = null;
  let guideY: number | null = null;
  for (const o of others) {
    const ov = [o.x, o.x + o.w / 2, o.x + o.w];
    const oh = [o.y, o.y + o.h / 2, o.y + o.h];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const dxv = ov[j] - myV[i];
        if (Math.abs(dxv) < bestDX) {
          bestDX = Math.abs(dxv);
          snapDX = dxv;
          guideX = ov[j];
        }
        const dyv = oh[j] - myH[i];
        if (Math.abs(dyv) < bestDY) {
          bestDY = Math.abs(dyv);
          snapDY = dyv;
          guideY = oh[j];
        }
      }
    }
  }
  return { x: x + snapDX, y: y + snapDY, guideX, guideY };
}

// ---------- image helpers ----------

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("Failed to read file"));
    r.readAsDataURL(file);
  });
}

function resizeImage(dataUrl: string, maxDim: number): Promise<{ src: string; w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => {
      let w = img.width;
      let h = img.height;
      if (!w || !h) { resolve({ src: dataUrl, w: w || 200, h: h || 200 }); return; }
      const ratio = w / h;
      if (w > maxDim || h > maxDim) {
        if (ratio >= 1) { w = maxDim; h = maxDim / ratio; }
        else { h = maxDim; w = maxDim * ratio; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(w);
      canvas.height = Math.round(h);
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve({ src: dataUrl, w: Math.round(w), h: Math.round(h) }); return; }
      const isPng = dataUrl.startsWith("data:image/png");
      // JPEG can't represent transparency — fill white first so transparent
      // source pixels don't become black after re-encode.
      if (!isPng) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(img, 0, 0, w, h);
      const mime = isPng ? "image/png" : "image/jpeg";
      const out = isPng ? canvas.toDataURL(mime) : canvas.toDataURL(mime, 0.9);
      resolve({ src: out, w: canvas.width, h: canvas.height });
    };
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = dataUrl;
  });
}

function loadImageMeta(src: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve({ w: img.width || 200, h: img.height || 200 });
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = src;
  });
}

// ---------- main component ----------

export default function BoardEditor({ boardId }: { boardId: string }) {
  const router = useRouter();
  const [board, setBoard] = useState<Board | null | undefined>(undefined);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("select");
  const [multiMode, setMultiMode] = useState(false);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [edgeFromId, setEdgeFromId] = useState<string | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ tx: 0, ty: 0, scale: 1 });
  const [importOpen, setImportOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [connectPreview, setConnectPreview] = useState<{
    fromId: string;
    fromAnchor: Anchor;
    toX: number;
    toY: number;
    targetId: string | null;
    toAnchor: Anchor | null;
  } | null>(null);
  const [snapGuides, setSnapGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });
  const [, setHistoryVersion] = useState(0);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Drag>({ kind: "none" });
  const pointersRef = useRef<Map<number, Pt>>(new Map());
  const shapesRef = useRef<Shape[]>([]);
  const edgesRef = useRef<Edge[]>([]);
  const viewportRef = useRef(viewport);
  const selectedIdsRef = useRef<string[]>([]);
  const multiModeRef = useRef(false);
  const historyRef = useRef<Snapshot[]>([]);
  const futureRef = useRef<Snapshot[]>([]);
  const preDragRef = useRef<Snapshot | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingMoveRef = useRef<PointerEvent | null>(null);

  useEffect(() => { shapesRef.current = shapes; }, [shapes]);
  useEffect(() => { edgesRef.current = edges; }, [edges]);
  useEffect(() => { viewportRef.current = viewport; }, [viewport]);
  useEffect(() => { selectedIdsRef.current = selectedIds; }, [selectedIds]);
  useEffect(() => { multiModeRef.current = multiMode; }, [multiMode]);

  // Load board (resets all per-board UI state when boardId changes)
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
    setSelectedIds([]);
    setSelectedEdgeId(null);
    setEditingId(null);
    setMode("select");
    setEdgeFromId(null);
    setMultiMode(false);
    setAddOpen(false);
    setMenuOpen(false);
    setMarquee(null);
    setConnectPreview(null);
    setSnapGuides({ x: null, y: null });
    setViewport({ tx: 0, ty: 0, scale: 1 });
    historyRef.current = [];
    futureRef.current = [];
    setHistoryVersion((v) => v + 1);
  }, [boardId]);

  // Auto-save
  useEffect(() => {
    if (!board) return;
    const t = setTimeout(() => {
      saveBoard({ ...board, name, shapes, edges });
    }, 350);
    return () => clearTimeout(t);
  }, [board, name, shapes, edges]);

  const snapshot = useCallback(
    (): Snapshot => ({ shapes: shapesRef.current, edges: edgesRef.current }),
    [],
  );

  const pushHistory = useCallback((snap: Snapshot) => {
    // Always push. Direct callers (delete/duplicate/format/etc.) snapshot
    // BEFORE mutating state, so at this moment snap === current. The drag
    // commit path dedups itself via the drag's "moved" flag, and undo()
    // skips any no-op snapshots that slip through.
    historyRef.current.push(snap);
    if (historyRef.current.length > HISTORY_LIMIT) historyRef.current.shift();
    futureRef.current = [];
    setHistoryVersion((v) => v + 1);
  }, []);

  const undo = useCallback(() => {
    let prev: Snapshot | undefined;
    while ((prev = historyRef.current.pop())) {
      if (prev.shapes !== shapesRef.current || prev.edges !== edgesRef.current) break;
    }
    if (!prev) return;
    futureRef.current.unshift(snapshot());
    if (futureRef.current.length > HISTORY_LIMIT) futureRef.current.pop();
    setShapes(prev.shapes);
    setEdges(prev.edges);
    setSelectedIds([]);
    setSelectedEdgeId(null);
    setEditingId(null);
    setHistoryVersion((v) => v + 1);
  }, [snapshot]);

  const redo = useCallback(() => {
    const next = futureRef.current.shift();
    if (!next) return;
    historyRef.current.push(snapshot());
    if (historyRef.current.length > HISTORY_LIMIT) historyRef.current.shift();
    setShapes(next.shapes);
    setEdges(next.edges);
    setSelectedIds([]);
    setSelectedEdgeId(null);
    setEditingId(null);
    setHistoryVersion((v) => v + 1);
  }, [snapshot]);

  // Wheel zoom — attached to the canvas container so it fires no matter
  // which child element is under the cursor (SVG, foreignObject HTML, link
  // card thumbnail, floating inspector buttons, etc).
  useEffect(() => {
    const container = canvasRef.current;
    if (!container) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      setViewport((v) => {
        const k = e.ctrlKey ? 0.01 : 0.005;
        const factor = Math.exp(-e.deltaY * k);
        const scale = clamp(v.scale * factor, 0.1, 4);
        const bx = (sx - v.tx) / v.scale;
        const by = (sy - v.ty) / v.scale;
        return { scale, tx: sx - bx * scale, ty: sy - by * scale };
      });
    }
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, []);

  // Pointer handlers (rAF coalesced)
  useEffect(() => {
    function handleMove(e: PointerEvent) {
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
        const scale = clamp(d.initialScale * (dist / d.initialDist), 0.1, 4);
        const bx = (d.centerSx - d.initialTx) / d.initialScale;
        const by = (d.centerSy - d.initialTy) / d.initialScale;
        setViewport({ scale, tx: mx - bx * scale, ty: my - by * scale });
        return;
      }
      if (d.kind === "connecting") {
        const vp = viewportRef.current;
        const bx = (sx - vp.tx) / vp.scale;
        const by = (sy - vp.ty) / vp.scale;
        const list = shapesRef.current;
        let targetId: string | null = null;
        for (let i = list.length - 1; i >= 0; i--) {
          const s = list[i];
          if (s.id === d.fromId) continue;
          if (pointInShape(s, bx, by)) { targetId = s.id; break; }
        }
        const toAnchor = targetId
          ? closestAnchor(list.find((s) => s.id === targetId)!, bx, by)
          : null;
        const endPt = targetId && toAnchor
          ? anchorPoint(list.find((s) => s.id === targetId)!, toAnchor)
          : { x: bx, y: by };
        setConnectPreview({
          fromId: d.fromId,
          fromAnchor: d.fromAnchor,
          toX: endPt.x,
          toY: endPt.y,
          targetId,
          toAnchor,
        });
        return;
      }
      if (d.kind === "pan") {
        setViewport((v) => ({ ...v, tx: d.startTx + (sx - d.startSx), ty: d.startTy + (sy - d.startSy) }));
        return;
      }
      if (d.kind === "move") {
        const dxBoard = (sx - d.startSx) / d.scale;
        const dyBoard = (sy - d.startSy) / d.scale;
        if (Math.abs(dxBoard) + Math.abs(dyBoard) > 1) d.moved = true;
        // Snap based on the primary shape's bounding box. The whole group
        // shifts by the post-snap delta of the primary.
        const primaryOrig = d.origPositions.get(d.primaryId)!;
        const candidateX = primaryOrig.x + dxBoard;
        const candidateY = primaryOrig.y + dyBoard;
        const groupSet = new Set(d.ids);
        const others = shapesRef.current.filter((s) => !groupSet.has(s.id));
        const threshold = SNAP_PX / d.scale;
        const snapped = computeSnap(candidateX, candidateY, d.w, d.h, others, threshold);
        const finalDx = snapped.x - primaryOrig.x;
        const finalDy = snapped.y - primaryOrig.y;
        setShapes((ss) =>
          ss.map((sh) => {
            const orig = d.origPositions.get(sh.id);
            if (!orig) return sh;
            return { ...sh, x: orig.x + finalDx, y: orig.y + finalDy };
          }),
        );
        setSnapGuides({ x: snapped.guideX, y: snapped.guideY });
        return;
      }
      if (d.kind === "marquee") {
        const vp = viewportRef.current;
        const bx = (sx - vp.tx) / vp.scale;
        const by = (sy - vp.ty) / vp.scale;
        // Don't drop the current selection until the pointer actually moves.
        // A pure click (no movement) is handled in onEnd as deselect.
        if (!d.moved) {
          if (Math.abs(bx - d.startBx) + Math.abs(by - d.startBy) > 3 / vp.scale) {
            d.moved = true;
          } else {
            return;
          }
        }
        const x = Math.min(d.startBx, bx);
        const y = Math.min(d.startBy, by);
        const w = Math.abs(bx - d.startBx);
        const h = Math.abs(by - d.startBy);
        setMarquee({ x, y, w, h });
        const hit: string[] = [];
        for (const s of shapesRef.current) {
          if (s.x + s.w >= x && s.x <= x + w && s.y + s.h >= y && s.y <= y + h) {
            hit.push(s.id);
          }
        }
        const merged = d.additive
          ? Array.from(new Set([...d.baseIds, ...hit]))
          : hit;
        setSelectedIds(merged);
        return;
      }
      if (d.kind === "resize") {
        const dxBoard = (sx - d.startSx) / d.scale;
        const dyBoard = (sy - d.startSy) / d.scale;
        const shiftLock = e.shiftKey;
        setShapes((ss) =>
          ss.map((s) => {
            if (s.id !== d.id) return s;
            const o = d.orig;
            let nx = o.x, ny = o.y, nw = o.w, nh = o.h;
            if (d.corner === "se") { nw = o.w + dxBoard; nh = o.h + dyBoard; }
            if (d.corner === "ne") { ny = o.y + dyBoard; nh = o.h - dyBoard; nw = o.w + dxBoard; }
            if (d.corner === "sw") { nx = o.x + dxBoard; nw = o.w - dxBoard; nh = o.h + dyBoard; }
            if (d.corner === "nw") { nx = o.x + dxBoard; ny = o.y + dyBoard; nw = o.w - dxBoard; nh = o.h - dyBoard; }
            nw = Math.max(40, nw);
            nh = Math.max(32, nh);
            if (shiftLock && o.w > 0 && o.h > 0) {
              const aspect = o.w / o.h;
              const candAspect = nw / nh;
              if (candAspect > aspect) {
                const newW = nh * aspect;
                if (d.corner === "nw" || d.corner === "sw") {
                  nx = o.x + o.w - newW;
                }
                nw = newW;
              } else {
                const newH = nw / aspect;
                if (d.corner === "nw" || d.corner === "ne") {
                  ny = o.y + o.h - newH;
                }
                nh = newH;
              }
            }
            return { ...s, x: nx, y: ny, w: nw, h: nh };
          }),
        );
      }
    }

    function onMove(e: PointerEvent) {
      pendingMoveRef.current = e;
      if (rafRef.current != null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const pending = pendingMoveRef.current;
        pendingMoveRef.current = null;
        if (pending) handleMove(pending);
      });
    }

    function commitPreDrag(changed: boolean) {
      const pre = preDragRef.current;
      preDragRef.current = null;
      if (!pre || !changed) return;
      pushHistory(pre);
    }

    function onEnd(e: PointerEvent) {
      const d = dragRef.current;
      if (d.kind === "connecting") {
        const svg = svgRef.current;
        let targetId: string | null = null;
        let toAnchor: Anchor | null = null;
        if (svg) {
          const rect = svg.getBoundingClientRect();
          const sx = e.clientX - rect.left;
          const sy = e.clientY - rect.top;
          const vp = viewportRef.current;
          const bx = (sx - vp.tx) / vp.scale;
          const by = (sy - vp.ty) / vp.scale;
          const list = shapesRef.current;
          for (let i = list.length - 1; i >= 0; i--) {
            const s = list[i];
            if (s.id === d.fromId) continue;
            if (pointInShape(s, bx, by)) {
              targetId = s.id;
              toAnchor = closestAnchor(s, bx, by);
              break;
            }
          }
        }
        let edgeCreated = false;
        if (targetId && toAnchor) {
          const fromId = d.fromId;
          const fromAnchor = d.fromAnchor;
          const finalToId = targetId;
          const finalToAnchor = toAnchor;
          setEdges((es) => {
            if (es.some((x) => x.from === fromId && x.to === finalToId)) return es;
            edgeCreated = true;
            return [...es, { id: newId("e_"), from: fromId, to: finalToId, fromAnchor, toAnchor: finalToAnchor }];
          });
        }
        setConnectPreview(null);
        dragRef.current = { kind: "none" };
        pointersRef.current.delete(e.pointerId);
        commitPreDrag(edgeCreated);
        return;
      }
      pointersRef.current.delete(e.pointerId);
      if (d.kind === "move") {
        if (!d.moved && e.pointerType === "mouse") {
          // Mouse click without drag → toggle in selection.
          const id = d.primaryId;
          setSelectedIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
          );
          setSelectedEdgeId(null);
        } else if (d.moved && !selectedIdsRef.current.includes(d.primaryId)) {
          setSelectedIds(d.ids);
        }
        setSnapGuides({ x: null, y: null });
        commitPreDrag(d.moved);
      }
      if (d.kind === "resize") {
        setSnapGuides({ x: null, y: null });
        // Resize drags always start at the original shape; assume any
        // committed handle release was a resize. Undo's skip-no-op handles
        // the degenerate "click without drag" case.
        commitPreDrag(true);
      }
      if (d.kind === "marquee") {
        setMarquee(null);
        if (!d.moved && d.clickToggle) {
          // Click on empty without drag → deselect all.
          setSelectedIds([]);
          setSelectedEdgeId(null);
        }
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
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [pushHistory]);

  const deleteSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    pushHistory(snapshot());
    const idSet = new Set(selectedIds);
    setShapes((s) => s.filter((x) => !idSet.has(x.id)));
    setEdges((es) => es.filter((x) => !idSet.has(x.from) && !idSet.has(x.to)));
    setSelectedIds([]);
    setEditingId((ed) => (ed && idSet.has(ed) ? null : ed));
  }, [pushHistory, snapshot, selectedIds]);

  const deleteEdge = useCallback((id: string) => {
    pushHistory(snapshot());
    setEdges((es) => es.filter((e) => e.id !== id));
    setSelectedEdgeId((sel) => (sel === id ? null : sel));
  }, [pushHistory, snapshot]);

  const duplicateSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    pushHistory(snapshot());
    const idMap = new Map<string, string>();
    const newShapes: Shape[] = [];
    for (const id of selectedIds) {
      const src = shapesRef.current.find((s) => s.id === id);
      if (!src) continue;
      const nid = newId("s_");
      idMap.set(id, nid);
      newShapes.push({ ...src, id: nid, x: src.x + 24, y: src.y + 24 });
    }
    // Clone edges that connect *within* the duplicated set.
    const newEdges: Edge[] = [];
    for (const e of edgesRef.current) {
      const f = idMap.get(e.from);
      const t = idMap.get(e.to);
      if (f && t) newEdges.push({ ...e, id: newId("e_"), from: f, to: t });
    }
    setShapes((ss) => [...ss, ...newShapes]);
    setEdges((es) => [...es, ...newEdges]);
    setSelectedIds(newShapes.map((s) => s.id));
  }, [pushHistory, snapshot, selectedIds]);

  const updateSelectedShapes = useCallback(
    (patch: Partial<Shape>, opts?: { history?: boolean }) => {
      if (selectedIds.length === 0) return;
      if (opts?.history !== false) pushHistory(snapshot());
      const idSet = new Set(selectedIds);
      setShapes((ss) => ss.map((s) => (idSet.has(s.id) ? { ...s, ...patch } : s)));
    },
    [pushHistory, snapshot, selectedIds],
  );

  const addImageFromFile = useCallback(async (file: File, bx: number, by: number) => {
    if (!file.type.startsWith("image/")) return;
    try {
      const original = await readFileAsDataURL(file);
      // For small / reasonable-size sources, keep the original bytes —
      // avoids any canvas re-encode that could clobber colors/transparency.
      let result: { src: string; w: number; h: number };
      if (file.size < 600_000) {
        const meta = await loadImageMeta(original);
        if (Math.max(meta.w, meta.h) <= IMAGE_MAX_DIM * 1.5) {
          result = { src: original, w: meta.w, h: meta.h };
        } else {
          result = await resizeImage(original, IMAGE_MAX_DIM);
        }
      } else {
        result = await resizeImage(original, IMAGE_MAX_DIM);
      }
      const aspect = result.w / result.h;
      let w = Math.min(result.w, IMAGE_DEFAULT_DISPLAY);
      let h = w / aspect;
      if (h > IMAGE_DEFAULT_DISPLAY) { h = IMAGE_DEFAULT_DISPLAY; w = h * aspect; }
      pushHistory(snapshot());
      const s: Shape = {
        id: newId("s_"),
        kind: "image",
        x: bx - w / 2,
        y: by - h / 2,
        w,
        h,
        text: "",
        fill: "transparent",
        stroke: "transparent",
        src: result.src,
      };
      setShapes((ss) => [...ss, s]);
      setSelectedIds([s.id]);
      setSelectedEdgeId(null);
    } catch (err) {
      console.error("Image load failed", err);
    }
  }, [pushHistory, snapshot]);

  // Keyboard
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const isEditable = (e.target as HTMLElement | null)?.isContentEditable;
      const cmd = e.metaKey || e.ctrlKey;
      if (cmd && e.key.toLowerCase() === "z") {
        if (tag === "INPUT" || tag === "TEXTAREA" || isEditable) return;
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if (cmd && e.key.toLowerCase() === "y") {
        if (tag === "INPUT" || tag === "TEXTAREA" || isEditable) return;
        e.preventDefault();
        redo();
        return;
      }
      if (cmd && e.key.toLowerCase() === "d" && selectedIds.length > 0) {
        if (tag === "INPUT" || tag === "TEXTAREA" || isEditable) return;
        e.preventDefault();
        duplicateSelected();
        return;
      }
      if (cmd && e.key.toLowerCase() === "a") {
        if (tag === "INPUT" || tag === "TEXTAREA" || isEditable) return;
        e.preventDefault();
        setSelectedIds(shapesRef.current.map((s) => s.id));
        setSelectedEdgeId(null);
        return;
      }
      if (editingId) return;
      if (tag === "INPUT" || tag === "TEXTAREA" || isEditable) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedIds.length > 0) {
          e.preventDefault();
          deleteSelected();
        } else if (selectedEdgeId) {
          e.preventDefault();
          deleteEdge(selectedEdgeId);
        }
      } else if (e.key === "Escape") {
        setMode("select");
        setEdgeFromId(null);
        setSelectedIds([]);
        setSelectedEdgeId(null);
        setMultiMode(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedIds, selectedEdgeId, editingId, undo, redo, deleteSelected, deleteEdge, duplicateSelected]);

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
      initialScale: viewportRef.current.scale,
      initialTx: viewportRef.current.tx,
      initialTy: viewportRef.current.ty,
      centerSx,
      centerSy,
    };
    setConnectPreview(null);
    setSnapGuides({ x: null, y: null });
    preDragRef.current = null;
    return true;
  }

  function viewportCenter(): Pt {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: (rect.width / 2 - viewport.tx) / viewport.scale,
      y: (rect.height / 2 - viewport.ty) / viewport.scale,
    };
  }

  function addShape(kind: AddItem) {
    if (kind === "voice") {
      setAddOpen(false);
      setVoiceOpen(true);
      return;
    }
    if (kind === "link") {
      setAddOpen(false);
      setLinkOpen(true);
      return;
    }
    if (kind === "image") {
      setAddOpen(false);
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return;
        const { x, y } = viewportCenter();
        addImageFromFile(file, x, y);
      };
      input.click();
      return;
    }
    pushHistory(snapshot());
    const { x: cx, y: cy } = viewportCenter();
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
    setSelectedIds([s.id]);
    setSelectedEdgeId(null);
    setAddOpen(false);
  }

  function handleVoiceCommit(transcript: string) {
    const text = transcript.trim();
    if (!text) return;
    pushHistory(snapshot());
    const { x, y } = viewportCenter();
    const w = 280, h = 180;
    const s: Shape = {
      id: newId("s_"),
      kind: "rect",
      x: x - w / 2,
      y: y - h / 2,
      w,
      h,
      text,
      fill: "#fef3c7",
      stroke: "#f59e0b",
      fontSize: 14,
      textAlign: "left",
    };
    setShapes((ss) => [...ss, s]);
    setSelectedIds([s.id]);
    setSelectedEdgeId(null);
  }

  function handleLinkCommit(preview: LinkPreview) {
    pushHistory(snapshot());
    const { x, y } = viewportCenter();
    const w = 280, h = preview.thumbnail ? 240 : 120;
    const s: Shape = {
      id: newId("s_"),
      kind: "link",
      x: x - w / 2,
      y: y - h / 2,
      w,
      h,
      text: "",
      fill: "#ffffff",
      stroke: "transparent",
      href: preview.href,
      linkTitle: preview.title,
      linkThumbnail: preview.thumbnail,
      linkProvider: preview.provider,
    };
    setShapes((ss) => [...ss, s]);
    setSelectedIds([s.id]);
    setSelectedEdgeId(null);
  }

  const onShapePointerDown = useCallback((e: React.PointerEvent, s: Shape) => {
    e.stopPropagation();
    if (editingId) setEditingId(null);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (trySwitchToPinch()) return;

    const isMouse = e.pointerType === "mouse";

    // Middle-mouse drag pans regardless of target.
    if (isMouse && e.button === 1) {
      e.preventDefault();
      const rect = svgRef.current!.getBoundingClientRect();
      dragRef.current = {
        kind: "pan",
        startSx: e.clientX - rect.left,
        startSy: e.clientY - rect.top,
        startTx: viewportRef.current.tx,
        startTy: viewportRef.current.ty,
      };
      return;
    }
    // Non-primary mouse buttons (right, etc.) do nothing.
    if (isMouse && e.button !== 0) return;

    if (mode === "connect") {
      if (!edgeFromId) {
        setEdgeFromId(s.id);
      } else if (edgeFromId !== s.id) {
        const fromShape = shapesRef.current.find((x) => x.id === edgeFromId);
        if (fromShape) {
          const [fa, ta] = bestAnchorPair(fromShape, s);
          const fromId = edgeFromId;
          pushHistory(snapshot());
          setEdges((es) =>
            es.some((x) => x.from === fromId && x.to === s.id)
              ? es
              : [...es, { id: newId("e_"), from: fromId, to: s.id, fromAnchor: fa, toAnchor: ta }],
          );
        }
        setEdgeFromId(null);
        setMode("select");
      }
      return;
    }
    // Shift-click or multi-mode toggles membership without starting a drag.
    if (e.shiftKey || multiModeRef.current) {
      setSelectedIds((prev) =>
        prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id],
      );
      setSelectedEdgeId(null);
      return;
    }
    // Drag the existing group if the shape is part of it; otherwise just this.
    const currentSel = selectedIdsRef.current;
    const dragIds = currentSel.includes(s.id) && currentSel.length > 1
      ? currentSel.slice()
      : [s.id];
    // Touch: pre-emptively replace selection on the tap (current UX).
    // Mouse: defer to pointerup — a click (no drag) toggles, a drag moves.
    if (!isMouse && (!currentSel.includes(s.id) || currentSel.length !== 1)) {
      setSelectedIds(dragIds);
    }
    setSelectedEdgeId(null);
    const origPositions = new Map<string, { x: number; y: number }>();
    for (const id of dragIds) {
      const sh = shapesRef.current.find((x) => x.id === id);
      if (sh) origPositions.set(id, { x: sh.x, y: sh.y });
    }
    const rect = svgRef.current!.getBoundingClientRect();
    preDragRef.current = snapshot();
    dragRef.current = {
      kind: "move",
      ids: dragIds,
      primaryId: s.id,
      origPositions,
      startSx: e.clientX - rect.left,
      startSy: e.clientY - rect.top,
      w: s.w,
      h: s.h,
      scale: viewportRef.current.scale,
      moved: false,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, mode, edgeFromId, pushHistory, snapshot]);

  const onShapeDoubleClick = useCallback((id: string) => {
    const s = shapesRef.current.find((sh) => sh.id === id);
    if (!s || s.kind === "image" || s.kind === "link") return; // cards don't have editable text
    pushHistory(snapshot());
    setEditingId(id);
    setSelectedIds([id]);
    setSelectedEdgeId(null);
  }, [pushHistory, snapshot]);

  function onCanvasPointerDown(e: React.PointerEvent) {
    if (editingId) setEditingId(null);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (trySwitchToPinch()) return;

    setAddOpen(false);
    setMenuOpen(false);
    if (mode === "connect") {
      setSelectedIds([]);
      setSelectedEdgeId(null);
      setEdgeFromId(null);
      setMode("select");
      return;
    }

    const isMouse = e.pointerType === "mouse";
    const rect = svgRef.current!.getBoundingClientRect();

    // Middle-mouse drag = pan.
    if (isMouse && e.button === 1) {
      e.preventDefault();
      dragRef.current = {
        kind: "pan",
        startSx: e.clientX - rect.left,
        startSy: e.clientY - rect.top,
        startTx: viewport.tx,
        startTy: viewport.ty,
      };
      return;
    }
    // Non-primary mouse buttons (right, etc.) ignored.
    if (isMouse && e.button !== 0) return;

    // Mouse left-click always begins a marquee with click-to-deselect
    // semantics (no-drag click clears selection unless shift is held).
    // Touch keeps the old behavior: marquee only when shift or multiMode.
    if (isMouse || e.shiftKey || multiMode) {
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const vp = viewportRef.current;
      const bx = (sx - vp.tx) / vp.scale;
      const by = (sy - vp.ty) / vp.scale;
      dragRef.current = {
        kind: "marquee",
        startBx: bx,
        startBy: by,
        additive: e.shiftKey,
        baseIds: e.shiftKey ? selectedIds.slice() : [],
        moved: false,
        clickToggle: !e.shiftKey,
      };
      setMarquee({ x: bx, y: by, w: 0, h: 0 });
      if (!e.shiftKey) setSelectedEdgeId(null);
      return;
    }
    // Touch with no modifier: pan (and clear selection).
    setSelectedIds([]);
    setSelectedEdgeId(null);
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
    preDragRef.current = snapshot();
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

  function onDotPointerDown(e: React.PointerEvent, s: Shape, anchor: Anchor) {
    e.stopPropagation();
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (trySwitchToPinch()) return;
    preDragRef.current = snapshot();
    dragRef.current = { kind: "connecting", fromId: s.id, fromAnchor: anchor };
    const start = anchorPoint(s, anchor);
    setConnectPreview({
      fromId: s.id,
      fromAnchor: anchor,
      toX: start.x,
      toY: start.y,
      targetId: null,
      toAnchor: null,
    });
  }

  function onEdgePointerDown(e: React.PointerEvent, edgeId: string) {
    e.stopPropagation();
    if (editingId) setEditingId(null);
    setSelectedIds([]);
    setSelectedEdgeId(edgeId);
  }

  const updateShape = useCallback((id: string, patch: Partial<Shape>, opts?: { history?: boolean }) => {
    if (opts?.history !== false) pushHistory(snapshot());
    setShapes((ss) => ss.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, [pushHistory, snapshot]);

  function bumpFontSize(id: string, delta: number, opts?: { history?: boolean }) {
    if (opts?.history !== false) pushHistory(snapshot());
    setShapes((ss) =>
      ss.map((s) => (s.id === id ? { ...s, fontSize: clamp(effFontSize(s) + delta, FONT_MIN, FONT_MAX) } : s)),
    );
  }

  function applyTextStyle(id: string, style: TextStyleKey, opts?: { history?: boolean }) {
    const preset = STYLE_PRESETS[style];
    updateShape(id, { fontSize: preset.fontSize, bold: preset.bold || undefined }, opts);
  }

  function autoFitTo(ms: Shape[], padding = 60) {
    if (!ms.length) return;
    const minX = Math.min(...ms.map((s) => s.x));
    const maxX = Math.max(...ms.map((s) => s.x + s.w));
    const minY = Math.min(...ms.map((s) => s.y));
    const maxY = Math.max(...ms.map((s) => s.y + s.h));
    const bw = maxX - minX;
    const bh = maxY - minY;
    const rect = svgRef.current!.getBoundingClientRect();
    const vw = Math.max(1, rect.width - padding * 2);
    const vh = Math.max(1, rect.height - padding * 2);
    const scale = clamp(Math.min(vw / bw, vh / bh), 0.1, 1);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    setViewport({ scale, tx: rect.width / 2 - cx * scale, ty: rect.height / 2 - cy * scale });
  }

  function applyMindmap(doc: MindmapDocument) {
    pushHistory(snapshot());
    const { shapes: ms, edges: me } = layoutImport(doc);
    if (ms.length === 0) return;
    // Place the imported document near the current viewport center.
    const rect = svgRef.current!.getBoundingClientRect();
    const cx = (rect.width / 2 - viewport.tx) / viewport.scale;
    const cy = (rect.height / 2 - viewport.ty) / viewport.scale;
    const minX = Math.min(...ms.map((s) => s.x));
    const maxX = Math.max(...ms.map((s) => s.x + s.w));
    const minY = Math.min(...ms.map((s) => s.y));
    const maxY = Math.max(...ms.map((s) => s.y + s.h));
    const dx = cx - (minX + maxX) / 2;
    const dy = cy - (minY + maxY) / 2;
    const offset = ms.map((s) => ({ ...s, x: s.x + dx, y: s.y + dy }));
    setShapes((ss) => [...ss, ...offset]);
    setEdges((es) => [...es, ...me]);
    requestAnimationFrame(() => autoFitTo(offset));
  }

  function onDeleteBoard() {
    if (!board) return;
    if (window.confirm("Delete this board permanently?")) {
      deleteBoard(board.id);
      router.push("/");
    }
  }

  // Drag-drop image onto canvas (desktop)
  function onContainerDragOver(e: React.DragEvent) {
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      if (!isDraggingFile) setIsDraggingFile(true);
    }
  }
  function onContainerDragLeave(e: React.DragEvent) {
    if (e.currentTarget === e.target) setIsDraggingFile(false);
  }
  function onContainerDrop(e: React.DragEvent) {
    setIsDraggingFile(false);
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.type.startsWith("image/")) return;
    e.preventDefault();
    const rect = svgRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const bx = (sx - viewport.tx) / viewport.scale;
    const by = (sy - viewport.ty) / viewport.scale;
    addImageFromFile(file, bx, by);
  }

  const shapesById = useMemo(() => {
    const m = new Map<string, Shape>();
    for (const s of shapes) m.set(s.id, s);
    return m;
  }, [shapes]);

  const renderedEdges = useMemo(() => {
    return edges.map((e) => {
      const a = shapesById.get(e.from);
      const b = shapesById.get(e.to);
      if (!a || !b) return null;
      const [fa, ta] = (e.fromAnchor && e.toAnchor)
        ? [e.fromAnchor, e.toAnchor]
        : bestAnchorPair(a, b);
      const p1 = anchorPoint(a, fa);
      const p2 = anchorPoint(b, ta);
      const { d, mid } = edgePath(p1, p2, fa, ta);
      return { id: e.id, d, mid };
    });
  }, [edges, shapesById]);

  if (board === undefined) return <div className="p-8 text-slate-500">Loading…</div>;
  if (board === null) {
    return (
      <div className="p-8">
        <p className="mb-4">Board not found.</p>
        <Link href="/" className="underline">Back to boards</Link>
      </div>
    );
  }

  const primarySelectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  const selected = primarySelectedId ? shapesById.get(primarySelectedId) ?? null : null;
  const multiSelected = selectedIds.length > 1;
  const editing = editingId ? shapesById.get(editingId) ?? null : null;
  const selectedEdgeMid =
    selectedEdgeId && !editing
      ? renderedEdges.find((e) => e && e.id === selectedEdgeId)?.mid ?? null
      : null;
  const connectingFrom = connectPreview ? shapesById.get(connectPreview.fromId) ?? null : null;
  const canUndo = historyRef.current.length > 0;
  const canRedo = futureRef.current.length > 0;
  const isEmpty = shapes.length === 0;

  return (
    <div className="flex flex-col" style={{ height: "100dvh" }}>
      <header
        className="flex items-center gap-2 px-2 sm:px-4 py-2 border-b bg-white"
        style={{ paddingTop: "max(8px, env(safe-area-inset-top))" }}
      >
        <Link
          href="/"
          className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg"
          aria-label="Back to boards"
        >
          <Icon name="arrow-left" size={20} />
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
            className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg"
            aria-label="Board menu"
          >
            <Icon name="more-vertical" size={20} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 bg-white border shadow-lg rounded-lg py-1 w-44 z-30">
              <button
                onClick={() => { setMenuOpen(false); onDeleteBoard(); }}
                className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50"
              >
                <Icon name="trash" size={16} />
                Delete board
              </button>
            </div>
          )}
        </div>
      </header>

      <div
        ref={canvasRef}
        className="relative flex-1 overflow-hidden canvas-bg"
        style={{
          backgroundSize: `${24 * viewport.scale}px ${24 * viewport.scale}px`,
          backgroundPosition: `${viewport.tx}px ${viewport.ty}px`,
        }}
        onDragOver={onContainerDragOver}
        onDragLeave={onContainerDragLeave}
        onDrop={onContainerDrop}
      >
        <svg
          ref={svgRef}
          className="canvas-surface absolute inset-0 w-full h-full"
          onPointerDown={onCanvasPointerDown}
        >
          <defs>
            <marker
              id="edge-arrow" viewBox="0 0 10 10" refX="9" refY="5"
              markerWidth={6} markerHeight={6} orient="auto" markerUnits="strokeWidth"
            >
              <path d="M0,0 L10,5 L0,10 Z" fill="#475569" />
            </marker>
            <marker
              id="edge-arrow-selected" viewBox="0 0 10 10" refX="9" refY="5"
              markerWidth={6} markerHeight={6} orient="auto" markerUnits="strokeWidth"
            >
              <path d="M0,0 L10,5 L0,10 Z" fill="#0ea5e9" />
            </marker>
            <marker
              id="edge-arrow-preview" viewBox="0 0 10 10" refX="9" refY="5"
              markerWidth={6} markerHeight={6} orient="auto" markerUnits="strokeWidth"
            >
              <path d="M0,0 L10,5 L0,10 Z" fill="#6366f1" />
            </marker>
          </defs>

          <g transform={`translate(${viewport.tx} ${viewport.ty}) scale(${viewport.scale})`}>
            {renderedEdges.map((e) => {
              if (!e) return null;
              const isSel = e.id === selectedEdgeId;
              return (
                <g key={e.id}>
                  <path
                    d={e.d}
                    stroke="transparent" strokeWidth={EDGE_HIT_WIDTH} fill="none"
                    style={{ cursor: "pointer", touchAction: "none" }}
                    onPointerDown={(ev) => onEdgePointerDown(ev, e.id)}
                  />
                  <path
                    d={e.d}
                    stroke={isSel ? "#0ea5e9" : "#475569"}
                    strokeWidth={isSel ? 2.5 : 2}
                    fill="none"
                    vectorEffect="non-scaling-stroke"
                    markerEnd={isSel ? "url(#edge-arrow-selected)" : "url(#edge-arrow)"}
                    pointerEvents="none"
                  />
                </g>
              );
            })}

            {marquee && (
              <rect
                x={marquee.x}
                y={marquee.y}
                width={marquee.w}
                height={marquee.h}
                fill="rgba(14,165,233,0.10)"
                stroke="#0ea5e9"
                strokeWidth={1.5}
                strokeDasharray="6 4"
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            )}
            {snapGuides.x !== null && (
              <line
                x1={snapGuides.x} y1={-1e6} x2={snapGuides.x} y2={1e6}
                stroke="#f43f5e" strokeWidth={1}
                vectorEffect="non-scaling-stroke" pointerEvents="none"
              />
            )}
            {snapGuides.y !== null && (
              <line
                x1={-1e6} y1={snapGuides.y} x2={1e6} y2={snapGuides.y}
                stroke="#f43f5e" strokeWidth={1}
                vectorEffect="non-scaling-stroke" pointerEvents="none"
              />
            )}

            {connectPreview && connectingFrom && (
              <path
                d={
                  connectPreview.targetId && connectPreview.toAnchor
                    ? edgePath(
                        anchorPoint(connectingFrom, connectPreview.fromAnchor),
                        { x: connectPreview.toX, y: connectPreview.toY },
                        connectPreview.fromAnchor,
                        connectPreview.toAnchor,
                      ).d
                    : loosePath(
                        anchorPoint(connectingFrom, connectPreview.fromAnchor),
                        connectPreview.fromAnchor,
                        { x: connectPreview.toX, y: connectPreview.toY },
                      )
                }
                stroke="#6366f1"
                strokeWidth={2.5}
                strokeDasharray={connectPreview.targetId ? undefined : "6 4"}
                fill="none"
                vectorEffect="non-scaling-stroke"
                markerEnd="url(#edge-arrow-preview)"
                pointerEvents="none"
              />
            )}

            {shapes.map((s) => (
              <ShapeNode
                key={s.id}
                shape={s}
                selected={selectedIds.includes(s.id)}
                editing={s.id === editingId}
                connectSource={s.id === edgeFromId || s.id === connectPreview?.fromId}
                connectTarget={s.id === connectPreview?.targetId}
                onPointerDown={onShapePointerDown}
                onDoubleClick={onShapeDoubleClick}
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
                  highlightAnchor={connectPreview?.toAnchor && connectPreview?.targetId === selected.id ? connectPreview.toAnchor : null}
                  onStart={(e, anchor) => onDotPointerDown(e, selected, anchor)}
                />
              </>
            )}

            {connectPreview?.targetId && connectPreview.toAnchor && connectPreview.targetId !== selected?.id && (
              (() => {
                const tgt = shapesById.get(connectPreview.targetId);
                if (!tgt) return null;
                const p = anchorPoint(tgt, connectPreview.toAnchor);
                return (
                  <circle
                    cx={p.x} cy={p.y} r={12 / viewport.scale}
                    fill="#22c55e" stroke="white" strokeWidth={2 / viewport.scale}
                    pointerEvents="none"
                  />
                );
              })()
            )}
          </g>
        </svg>

        {isDraggingFile && (
          <div className="absolute inset-0 z-30 bg-indigo-500/10 border-4 border-dashed border-indigo-400 flex items-center justify-center pointer-events-none">
            <div className="bg-white px-5 py-3 rounded-xl shadow-lg flex items-center gap-2 text-slate-700 font-medium">
              <Icon name="image" size={20} />
              Drop image to add
            </div>
          </div>
        )}

        {isEmpty && !connectPreview && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center text-slate-400 max-w-xs px-6">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-slate-100 mb-3 text-slate-400">
                <Icon name="plus" size={24} />
              </div>
              <p className="text-sm font-medium text-slate-600 mb-1">Empty board</p>
              <p className="text-xs">Tap <b className="font-semibold text-slate-700">+ Shape</b>, drop an image, or <b className="font-semibold text-slate-700">Import</b> a mindmap.</p>
            </div>
          </div>
        )}

        {editing && (
          <>
            <TextEditOverlay
              shape={editing}
              viewport={viewport}
              onChange={(text) => updateShape(editing.id, { text }, { history: false })}
              onDone={() => setEditingId(null)}
            />
            <EditingTopBar
              shape={editing}
              onToggle={(patch) => updateShape(editing.id, patch, { history: false })}
              onBump={(delta) => bumpFontSize(editing.id, delta, { history: false })}
              onStyle={(s) => applyTextStyle(editing.id, s, { history: false })}
              onDone={() => setEditingId(null)}
            />
          </>
        )}

        {mode === "connect" && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-xs px-3 py-2 rounded-full shadow z-10 pointer-events-none">
            {edgeFromId ? "Tap a target shape" : "Tap source, then target"}
          </div>
        )}

        {selectedEdgeId && selectedEdgeMid && (
          <button
            onClick={() => deleteEdge(selectedEdgeId)}
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute z-20 w-9 h-9 rounded-full bg-white border-2 border-red-500 text-red-500 shadow-lg flex items-center justify-center hover:bg-red-50"
            style={{
              left: selectedEdgeMid.x * viewport.scale + viewport.tx - 18,
              top: selectedEdgeMid.y * viewport.scale + viewport.ty - 18,
            }}
            aria-label="Delete connection"
          >
            <Icon name="trash" size={16} />
          </button>
        )}

        <div className="absolute left-2 z-20 pointer-events-none" style={{ top: "max(8px, env(safe-area-inset-top))" }}>
          <div className="pointer-events-auto bg-white/95 backdrop-blur border shadow rounded-xl flex">
            <button
              onClick={undo}
              disabled={!canUndo}
              className="h-10 w-10 flex items-center justify-center rounded-l-xl text-slate-700 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
              aria-label="Undo"
              title="Undo (Cmd/Ctrl+Z)"
            >
              <Icon name="undo" size={18} />
            </button>
            <div className="w-px bg-slate-200" />
            <button
              onClick={redo}
              disabled={!canRedo}
              className="h-10 w-10 flex items-center justify-center rounded-r-xl text-slate-700 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
              aria-label="Redo"
              title="Redo (Cmd/Ctrl+Shift+Z)"
            >
              <Icon name="redo" size={18} />
            </button>
          </div>
        </div>

        {multiSelected && !editing ? (
          <MultiInspector
            count={selectedIds.length}
            onChange={(patch) => updateSelectedShapes(patch)}
            onDuplicate={() => duplicateSelected()}
            onDelete={() => deleteSelected()}
          />
        ) : selected && !editing ? (
          selected.kind === "image" ? (
            <ImageInspector
              shape={selected}
              onDuplicate={() => duplicateSelected()}
              onDelete={() => deleteSelected()}
            />
          ) : selected.kind === "link" ? (
            <LinkInspector
              shape={selected}
              onOpen={() => {
                if (selected.href) {
                  window.open(selected.href, "_blank", "noopener,noreferrer");
                }
              }}
              onDuplicate={() => duplicateSelected()}
              onDelete={() => deleteSelected()}
            />
          ) : (
            <Inspector
              shape={selected}
              onChange={(patch) => updateShape(selected.id, patch)}
              onBump={(delta) => bumpFontSize(selected.id, delta)}
              onStyle={(s) => applyTextStyle(selected.id, s)}
              onDelete={() => deleteSelected()}
              onDuplicate={() => duplicateSelected()}
              onEditText={() => onShapeDoubleClick(selected.id)}
            />
          )
        ) : (
          !editing && (
            <BottomToolbar
              mode={mode}
              addOpen={addOpen}
              multiMode={multiMode}
              onToggleAdd={() => setAddOpen((v) => !v)}
              onAdd={addShape}
              onToggleConnect={() => setMode((m) => (m === "connect" ? "select" : "connect"))}
              onToggleMulti={() => setMultiMode((v) => !v)}
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
      <VoiceCaptureDialog
        open={voiceOpen}
        onClose={() => setVoiceOpen(false)}
        onCommit={handleVoiceCommit}
      />
      <LinkDialog
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        onCommit={handleLinkCommit}
      />
    </div>
  );
}

// ---------- ShapeNode ----------

const ShapeNode = memo(function ShapeNode({
  shape,
  selected,
  editing,
  connectSource,
  connectTarget,
  onPointerDown,
  onDoubleClick,
}: {
  shape: Shape;
  selected: boolean;
  editing: boolean;
  connectSource: boolean;
  connectTarget: boolean;
  onPointerDown: (e: React.PointerEvent, s: Shape) => void;
  onDoubleClick: (id: string) => void;
}) {
  const strokeColor = editing
    ? shape.stroke
    : connectTarget
      ? "#22c55e"
      : connectSource
        ? "#6366f1"
        : selected
          ? "#0ea5e9"
          : shape.stroke;
  const strokeW = editing ? 1.5 : selected || connectSource || connectTarget ? 2.5 : 1.5;
  const handlePointerDown = (e: React.PointerEvent) => onPointerDown(e, shape);
  const handleDoubleClick = () => onDoubleClick(shape.id);
  const styleProps = { cursor: "move" as const, touchAction: "none" as const };

  let geometry: React.ReactNode;
  if (shape.kind === "rect") {
    geometry = (
      <rect
        x={shape.x} y={shape.y} width={shape.w} height={shape.h}
        rx={10} ry={10}
        fill={shape.fill} stroke={strokeColor} strokeWidth={strokeW}
        vectorEffect="non-scaling-stroke"
        onPointerDown={handlePointerDown}
        onDoubleClick={handleDoubleClick}
        style={styleProps}
      />
    );
  } else if (shape.kind === "ellipse") {
    geometry = (
      <ellipse
        cx={shape.x + shape.w / 2} cy={shape.y + shape.h / 2}
        rx={shape.w / 2} ry={shape.h / 2}
        fill={shape.fill} stroke={strokeColor} strokeWidth={strokeW}
        vectorEffect="non-scaling-stroke"
        onPointerDown={handlePointerDown}
        onDoubleClick={handleDoubleClick}
        style={styleProps}
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
        vectorEffect="non-scaling-stroke"
        onPointerDown={handlePointerDown}
        onDoubleClick={handleDoubleClick}
        style={styleProps}
      />
    );
  } else if (shape.kind === "image") {
    const cornerRadius = Math.min(shape.w, shape.h) * 0.08;
    geometry = (
      <g>
        <foreignObject
          x={shape.x} y={shape.y} width={shape.w} height={shape.h}
        >
          <div
            onPointerDown={handlePointerDown}
            onDoubleClick={handleDoubleClick}
            style={{
              width: "100%",
              height: "100%",
              // Use a px value computed from the shorter side so corners stay
              // truly circular regardless of the shape's aspect ratio.
              borderRadius: `${cornerRadius}px`,
              overflow: "hidden",
              background: "#e2e8f0",
              boxSizing: "border-box",
              cursor: "move",
              touchAction: "none",
            }}
          >
            {shape.src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={shape.src}
                alt=""
                draggable={false}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  display: "block",
                  userSelect: "none",
                  pointerEvents: "none",
                }}
              />
            ) : (
              <div style={{
                width: "100%",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#94a3b8",
                fontSize: 14,
              }}>image</div>
            )}
          </div>
        </foreignObject>
        <rect
          x={shape.x} y={shape.y} width={shape.w} height={shape.h}
          rx={cornerRadius} ry={cornerRadius}
          fill="none"
          stroke={selected || connectSource || connectTarget ? strokeColor : "transparent"}
          strokeWidth={selected || connectSource || connectTarget ? 2.5 : 0}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      </g>
    );
  } else if (shape.kind === "link") {
    const cornerRadius = Math.min(shape.w, shape.h) * 0.04;
    let hostname = "";
    try { hostname = new URL(shape.href || "").hostname.replace(/^www\./, ""); } catch {}
    geometry = (
      <g>
        <foreignObject x={shape.x} y={shape.y} width={shape.w} height={shape.h}>
          <div
            onPointerDown={handlePointerDown}
            onDoubleClick={handleDoubleClick}
            style={{
              width: "100%",
              height: "100%",
              background: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: "4%",
              overflow: "hidden",
              cursor: "move",
              touchAction: "none",
              display: "flex",
              flexDirection: "column",
              boxSizing: "border-box",
            }}
          >
            {shape.linkThumbnail && (
              <div style={{
                position: "relative",
                flex: "0 0 60%",
                overflow: "hidden",
                background: "#f1f5f9",
                minHeight: 0,
              }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={shape.linkThumbnail}
                  alt=""
                  draggable={false}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    display: "block",
                    pointerEvents: "none",
                    userSelect: "none",
                  }}
                />
                {shape.linkProvider === "YouTube" && (
                  <div style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    pointerEvents: "none",
                  }}>
                    <div style={{
                      width: 56,
                      height: 40,
                      borderRadius: 8,
                      background: "rgba(0,0,0,0.78)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "white",
                      paddingLeft: 3,
                    }}>
                      <Icon name="play" size={20} />
                    </div>
                  </div>
                )}
              </div>
            )}
            <div style={{
              padding: 12,
              flex: "1 1 auto",
              display: "flex",
              flexDirection: "column",
              gap: 4,
              overflow: "hidden",
              minHeight: 0,
            }}>
              <div style={{
                fontSize: 13,
                fontWeight: 600,
                color: "#0f172a",
                lineHeight: 1.3,
                overflow: "hidden",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                wordBreak: "break-word",
              }}>
                {shape.linkTitle || shape.href || "Link"}
              </div>
              <div style={{
                fontSize: 10,
                color: "#64748b",
                textTransform: "uppercase",
                letterSpacing: 0.5,
                fontWeight: 500,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}>
                {shape.linkProvider || "Web"}
                {hostname && <> · {hostname}</>}
              </div>
            </div>
          </div>
        </foreignObject>
        <rect
          x={shape.x} y={shape.y} width={shape.w} height={shape.h}
          rx={cornerRadius} ry={cornerRadius}
          fill="none"
          stroke={selected || connectSource || connectTarget ? strokeColor : "transparent"}
          strokeWidth={selected || connectSource || connectTarget ? 2.5 : 0}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      </g>
    );
  } else {
    // text shape
    geometry = (
      <rect
        x={shape.x} y={shape.y} width={shape.w} height={shape.h}
        rx={6} ry={6}
        fill="transparent"
        stroke={!editing && (selected || connectSource || connectTarget) ? strokeColor : "transparent"}
        strokeDasharray={!editing && selected ? "4 4" : undefined}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        onPointerDown={handlePointerDown}
        onDoubleClick={handleDoubleClick}
        style={styleProps}
      />
    );
  }

  if (shape.kind === "image" || shape.kind === "link") {
    return <g>{geometry}</g>;
  }

  const align = effTextAlign(shape);
  const justify = JUSTIFY[align];
  const hlBg = shape.highlight ? effHighlightColor(shape) : "transparent";

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
            justifyContent: justify,
            padding: 8,
            boxSizing: "border-box",
            color: "#0f172a",
            textAlign: align,
            lineHeight: 1.25,
            userSelect: "none",
            fontSize: effFontSize(shape),
            fontWeight: shape.bold ? 700 : 400,
            fontStyle: shape.italic ? "italic" : "normal",
            overflow: "hidden",
            visibility: editing ? "hidden" : "visible",
          }}
        >
          {shape.bullet ? (
            <div style={{ width: "100%", textAlign: "left" }}>
              {(shape.text || "").split("\n").map((line, i) => (
                <div key={i} style={{ display: "flex", gap: "0.45em", alignItems: "baseline" }}>
                  <span style={{ flexShrink: 0 }}>•</span>
                  <span style={{
                    backgroundColor: hlBg,
                    padding: shape.highlight ? "0 4px" : 0,
                    borderRadius: shape.highlight ? 3 : 0,
                    wordBreak: "break-word",
                    boxDecorationBreak: "clone",
                    WebkitBoxDecorationBreak: "clone",
                    flex: 1,
                    textAlign: "left",
                  }}>{line || " "}</span>
                </div>
              ))}
            </div>
          ) : (
            <span style={{
              backgroundColor: hlBg,
              padding: shape.highlight ? "2px 6px" : 0,
              borderRadius: shape.highlight ? 4 : 0,
              wordBreak: "break-word",
              maxWidth: "100%",
              boxDecorationBreak: "clone",
              WebkitBoxDecorationBreak: "clone",
              whiteSpace: "pre-wrap",
            }}>
              {shape.text}
            </span>
          )}
        </div>
      </foreignObject>
    </g>
  );
});

// ---------- ResizeHandles ----------

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

// ---------- ConnectionDots ----------

function ConnectionDots({
  shape,
  scale,
  highlightAnchor,
  onStart,
}: {
  shape: Shape;
  scale: number;
  highlightAnchor: Anchor | null;
  onStart: (e: React.PointerEvent, anchor: Anchor) => void;
}) {
  const vis = 12 / scale;
  const hit = 32 / scale;
  const dots: { anchor: Anchor; x: number; y: number }[] = [
    { anchor: "top", x: shape.x + shape.w / 2, y: shape.y },
    { anchor: "right", x: shape.x + shape.w, y: shape.y + shape.h / 2 },
    { anchor: "bottom", x: shape.x + shape.w / 2, y: shape.y + shape.h },
    { anchor: "left", x: shape.x, y: shape.y + shape.h / 2 },
  ];
  return (
    <>
      {dots.map((d) => {
        const active = highlightAnchor === d.anchor;
        return (
          <g key={d.anchor}>
            <circle
              cx={d.x} cy={d.y} r={hit / 2}
              fill="transparent"
              style={{ cursor: "crosshair", touchAction: "none" }}
              onPointerDown={(e) => onStart(e, d.anchor)}
            />
            <circle
              cx={d.x} cy={d.y} r={(active ? vis * 1.4 : vis) / 2}
              fill={active ? "#22c55e" : "#ffffff"}
              stroke={active ? "#16a34a" : "#6366f1"} strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          </g>
        );
      })}
    </>
  );
}

// ---------- TextEditOverlay ----------

function TextEditOverlay({
  shape,
  viewport,
  onChange,
  onDone,
}: {
  shape: Shape;
  viewport: Viewport;
  onChange: (text: string) => void;
  onDone: () => void;
}) {
  const spanRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = spanRef.current;
    if (!el) return;
    el.innerText = shape.text;
    el.focus();
    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = spanRef.current;
    if (!el) return;
    if (el.innerText !== shape.text) {
      el.innerText = shape.text;
    }
  }, [shape.text]);

  const left = shape.x * viewport.scale + viewport.tx;
  const top = shape.y * viewport.scale + viewport.ty;
  const width = shape.w * viewport.scale;
  const height = shape.h * viewport.scale;
  const fontPx = effFontSize(shape) * viewport.scale;
  const isText = shape.kind === "text";
  const align = effTextAlign(shape);

  const containerBg = isText ? "transparent" : shape.fill;
  const borderRadius = shape.kind === "rect" ? 10 * viewport.scale : isText ? 6 * viewport.scale : 0;
  const clipPath = clipPathFor(shape.kind);

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        left,
        top,
        width,
        height,
        display: "flex",
        alignItems: "center",
        justifyContent: JUSTIFY[align],
        padding: 8,
        boxSizing: "border-box",
        textAlign: align,
        color: "#0f172a",
        lineHeight: 1.25,
        background: containerBg,
        clipPath,
        WebkitClipPath: clipPath,
        borderRadius,
        boxShadow: "0 0 0 2px rgba(14,165,233,0.55)",
        overflow: "hidden",
        zIndex: 20,
      }}
    >
      <span
        ref={spanRef}
        contentEditable
        suppressContentEditableWarning
        onInput={(e) => onChange((e.currentTarget as HTMLSpanElement).innerText)}
        onPaste={(e) => {
          e.preventDefault();
          const text = e.clipboardData.getData("text/plain");
          document.execCommand("insertText", false, text);
        }}
        onKeyDown={(e) => {
          // Enter always inserts a newline (default contentEditable behavior).
          // Esc commits. Tap outside also commits via the canvas pointerdown.
          if (e.key === "Escape") {
            e.preventDefault();
            onDone();
          }
        }}
        style={{
          fontSize: fontPx,
          fontWeight: shape.bold ? 700 : 400,
          fontStyle: shape.italic ? "italic" : "normal",
          backgroundColor: shape.highlight ? effHighlightColor(shape) : "transparent",
          padding: shape.highlight ? "2px 6px" : 0,
          borderRadius: shape.highlight ? 4 : 0,
          outline: "none",
          minWidth: "1ch",
          maxWidth: "100%",
          wordBreak: "break-word",
          whiteSpace: "pre-wrap",
          boxDecorationBreak: "clone",
          WebkitBoxDecorationBreak: "clone",
          caretColor: "#0f172a",
          textAlign: align,
        }}
      />
    </div>
  );
}

// ---------- Buttons ----------

function ToggleBtn({
  active,
  icon,
  preventBlur,
  onActivate,
  ariaLabel,
  title,
}: {
  active: boolean;
  icon: IconName;
  preventBlur?: boolean;
  onActivate: () => void;
  ariaLabel: string;
  title?: string;
}) {
  return (
    <button
      onMouseDown={preventBlur ? (e) => e.preventDefault() : undefined}
      onClick={onActivate}
      aria-pressed={active}
      aria-label={ariaLabel}
      title={title ?? ariaLabel}
      className={`h-11 min-w-11 px-2 rounded-xl flex items-center justify-center ${
        active ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
      }`}
    >
      <Icon name={icon} size={18} />
    </button>
  );
}

function IconBtn({
  icon,
  onClick,
  preventBlur,
  ariaLabel,
  title,
  className,
  variant = "ghost",
}: {
  icon: IconName;
  onClick: () => void;
  preventBlur?: boolean;
  ariaLabel: string;
  title?: string;
  className?: string;
  variant?: "ghost" | "danger";
}) {
  const variantClass =
    variant === "danger"
      ? "text-red-600 hover:bg-red-50"
      : "text-slate-700 hover:bg-slate-100";
  return (
    <button
      onMouseDown={preventBlur ? (e) => e.preventDefault() : undefined}
      onClick={onClick}
      aria-label={ariaLabel}
      title={title ?? ariaLabel}
      className={`h-11 min-w-11 px-2 rounded-xl flex items-center justify-center ${variantClass} ${className ?? ""}`}
    >
      <Icon name={icon} size={18} />
    </button>
  );
}

// ---------- Text style row (used by inspector + edit bar) ----------

function TextStyleRow({
  shape,
  onStyle,
  onToggle,
  preventBlur,
}: {
  shape: Shape;
  onStyle: (s: TextStyleKey) => void;
  onToggle: (patch: Partial<Shape>) => void;
  preventBlur?: boolean;
}) {
  const current = detectTextStyle(shape);
  const items: { key: TextStyleKey; icon: IconName; aria: string }[] = [
    { key: "h1", icon: "heading-1", aria: "Heading 1" },
    { key: "h2", icon: "heading-2", aria: "Heading 2" },
    { key: "h3", icon: "heading-3", aria: "Heading 3" },
    { key: "body", icon: "pilcrow", aria: "Body" },
  ];
  return (
    <div className="flex items-center gap-1">
      {items.map((it) => (
        <button
          key={it.key}
          onMouseDown={preventBlur ? (e) => e.preventDefault() : undefined}
          onClick={() => onStyle(it.key)}
          aria-pressed={current === it.key && !shape.bullet}
          aria-label={it.aria}
          title={it.aria}
          className={`h-11 min-w-11 px-2 rounded-xl flex items-center justify-center ${
            current === it.key && !shape.bullet ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
          }`}
        >
          <Icon name={it.icon} size={18} />
        </button>
      ))}
      <div className="w-px h-6 bg-slate-200 mx-0.5" />
      <button
        onMouseDown={preventBlur ? (e) => e.preventDefault() : undefined}
        onClick={() =>
          onToggle({
            bullet: !shape.bullet,
            textAlign: !shape.bullet ? "left" : shape.textAlign,
          })
        }
        aria-pressed={!!shape.bullet}
        aria-label="Bullet list"
        title="Bullet list"
        className={`h-11 min-w-11 px-2 rounded-xl flex items-center justify-center ${
          shape.bullet ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
        }`}
      >
        <Icon name="list" size={18} />
      </button>
    </div>
  );
}

function AlignRow({
  shape,
  onToggle,
  preventBlur,
}: {
  shape: Shape;
  onToggle: (patch: Partial<Shape>) => void;
  preventBlur?: boolean;
}) {
  const current = effTextAlign(shape);
  const items: { key: TextAlign; icon: IconName; aria: string }[] = [
    { key: "left", icon: "align-left", aria: "Align left" },
    { key: "center", icon: "align-center", aria: "Align center" },
    { key: "right", icon: "align-right", aria: "Align right" },
  ];
  return (
    <div className="flex items-center gap-1">
      {items.map((it) => (
        <button
          key={it.key}
          onMouseDown={preventBlur ? (e) => e.preventDefault() : undefined}
          onClick={() => onToggle({ textAlign: it.key })}
          aria-pressed={current === it.key}
          aria-label={it.aria}
          title={it.aria}
          className={`h-11 min-w-11 px-2 rounded-xl flex items-center justify-center ${
            current === it.key ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
          }`}
        >
          <Icon name={it.icon} size={18} />
        </button>
      ))}
    </div>
  );
}

// ---------- EditingTopBar ----------

function EditingTopBar({
  shape,
  onToggle,
  onBump,
  onStyle,
  onDone,
}: {
  shape: Shape;
  onToggle: (patch: Partial<Shape>) => void;
  onBump: (delta: number) => void;
  onStyle: (s: TextStyleKey) => void;
  onDone: () => void;
}) {
  return (
    <div
      className="absolute left-0 right-0 px-2 z-40 pointer-events-none"
      style={{ top: "max(8px, env(safe-area-inset-top))" }}
    >
      <div className="flex flex-col items-center gap-2">
        <div className="pointer-events-auto bg-white border shadow-lg rounded-2xl p-1.5 flex items-center gap-1">
          <ToggleBtn preventBlur icon="bold" active={!!shape.bold} onActivate={() => onToggle({ bold: !shape.bold })} ariaLabel="Bold" />
          <ToggleBtn preventBlur icon="italic" active={!!shape.italic} onActivate={() => onToggle({ italic: !shape.italic })} ariaLabel="Italic" />
          <ToggleBtn preventBlur icon="highlighter" active={!!shape.highlight} onActivate={() => onToggle({ highlight: !shape.highlight })} ariaLabel="Highlight" />
          <div className="w-px h-6 bg-slate-200 mx-0.5" />
          {/* Font-size group stays together */}
          <div className="flex items-center gap-1">
            <IconBtn preventBlur icon="a-arrow-down" onClick={() => onBump(-FONT_STEP)} ariaLabel="Smaller text" />
            <div className="px-1 text-xs text-slate-500 tabular-nums w-8 text-center">{effFontSize(shape)}</div>
            <IconBtn preventBlur icon="a-arrow-up" onClick={() => onBump(FONT_STEP)} ariaLabel="Larger text" />
          </div>
          <div className="w-px h-6 bg-slate-200 mx-0.5" />
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={onDone}
            className="h-11 px-3 rounded-xl bg-slate-900 text-white text-sm font-medium flex items-center gap-1.5"
          >
            <Icon name="check" size={16} />
            Done
          </button>
        </div>
        <div className="pointer-events-auto bg-white border shadow-lg rounded-2xl p-1.5 flex items-center gap-1">
          {shape.kind === "text" && (
            <>
              <TextStyleRow shape={shape} onStyle={onStyle} onToggle={onToggle} preventBlur />
              <div className="w-px h-6 bg-slate-200 mx-0.5" />
            </>
          )}
          <AlignRow shape={shape} onToggle={onToggle} preventBlur />
        </div>
        {shape.highlight && (
          <div className="pointer-events-auto bg-white border shadow-lg rounded-2xl p-1.5 flex items-center gap-1.5">
            {HIGHLIGHT_SWATCHES.map((c) => (
              <button
                key={c}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onToggle({ highlightColor: c })}
                className={`w-7 h-7 rounded-full border ${effHighlightColor(shape) === c ? "ring-2 ring-slate-900 ring-offset-1" : ""}`}
                style={{ background: c }}
                aria-label={`Highlight ${c}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- BottomToolbar ----------

function BottomToolbar({
  mode,
  addOpen,
  multiMode,
  onToggleAdd,
  onAdd,
  onToggleConnect,
  onToggleMulti,
  onImport,
}: {
  mode: Mode;
  addOpen: boolean;
  multiMode: boolean;
  onToggleAdd: () => void;
  onAdd: (k: AddItem) => void;
  onToggleConnect: () => void;
  onToggleMulti: () => void;
  onImport: () => void;
}) {
  const items: { k: AddItem; label: string; icon: IconName }[] = [
    { k: "rect", label: "Rectangle", icon: "square" },
    { k: "ellipse", label: "Ellipse", icon: "circle" },
    { k: "diamond", label: "Diamond", icon: "diamond" },
    { k: "text", label: "Text", icon: "type" },
    { k: "image", label: "Image", icon: "image" },
    { k: "link", label: "Link", icon: "link" },
    { k: "voice", label: "Voice note", icon: "mic" },
  ];
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
              className={`h-11 px-3 rounded-xl text-sm font-medium flex items-center gap-1.5 ${
                addOpen ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
              }`}
              aria-expanded={addOpen}
            >
              <Icon name="plus" size={18} />
              Add
            </button>
            {addOpen && (
              <div className="absolute bottom-full mb-2 left-0 bg-white border shadow-lg rounded-xl p-1 flex flex-col w-48 z-20">
                {items.map((it) => (
                  <button
                    key={it.k}
                    onClick={() => onAdd(it.k)}
                    className="h-11 px-3 text-left rounded-lg hover:bg-slate-100 text-sm text-slate-700 flex items-center gap-2"
                  >
                    <Icon name={it.icon} size={16} />
                    {it.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={onToggleConnect}
            className={`h-11 px-3 rounded-xl text-sm font-medium flex items-center gap-1.5 ${
              mode === "connect" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
            }`}
            aria-pressed={mode === "connect"}
          >
            <Icon name="share" size={18} />
            Connect
          </button>
          <button
            onClick={onToggleMulti}
            className={`h-11 min-w-11 px-2 rounded-xl text-sm font-medium flex items-center justify-center ${
              multiMode ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
            }`}
            aria-pressed={multiMode}
            title="Multi-select: tap shapes to add; drag empty space to lasso"
          >
            <Icon name="multi" size={18} />
          </button>
          <button
            onClick={onImport}
            className="h-11 px-3 rounded-xl text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 flex items-center gap-1.5"
          >
            <Icon name="clipboard" size={18} />
            Import
          </button>
        </div>
      </div>
    </div>
  );
}

function MultiInspector({
  count,
  onChange,
  onDuplicate,
  onDelete,
}: {
  count: number;
  onChange: (p: Partial<Shape>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="absolute left-2 right-2 bottom-0 z-10 pointer-events-none"
      style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}
    >
      <div className="flex justify-center">
        <div className="pointer-events-auto bg-white border shadow-lg rounded-2xl p-2 w-full max-w-md flex flex-col gap-2">
          <div className="flex items-center gap-1">
            <div className="px-3 text-xs text-slate-500 flex items-center gap-1.5">
              <Icon name="multi" size={14} />
              {count} selected
            </div>
            <div className="flex-1" />
            <IconBtn icon="copy" onClick={onDuplicate} ariaLabel="Duplicate" title="Duplicate (Cmd/Ctrl+D)" />
            <IconBtn icon="trash" onClick={onDelete} ariaLabel="Delete" variant="danger" />
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            <ToggleBtn icon="bold" active={false} onActivate={() => onChange({ bold: true })} ariaLabel="Bold" />
            <ToggleBtn icon="italic" active={false} onActivate={() => onChange({ italic: true })} ariaLabel="Italic" />
            <ToggleBtn icon="highlighter" active={false} onActivate={() => onChange({ highlight: true })} ariaLabel="Highlight" />
            <div className="w-px h-6 bg-slate-200 mx-0.5" />
            <ToggleBtn icon="align-left" active={false} onActivate={() => onChange({ textAlign: "left" })} ariaLabel="Align left" />
            <ToggleBtn icon="align-center" active={false} onActivate={() => onChange({ textAlign: "center" })} ariaLabel="Align center" />
            <ToggleBtn icon="align-right" active={false} onActivate={() => onChange({ textAlign: "right" })} ariaLabel="Align right" />
          </div>
          <div className="flex items-center gap-1.5 px-1">
            <span className="text-[10px] uppercase tracking-wide text-slate-400 w-8 shrink-0">Fill</span>
            <div className="flex flex-wrap gap-1.5">
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  onClick={() => onChange({ fill: c })}
                  className="w-7 h-7 rounded-full border"
                  style={{ background: c }}
                  aria-label={`Fill ${c}`}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Inspector (non-image shapes) ----------

function Inspector({
  shape,
  onChange,
  onBump,
  onStyle,
  onDelete,
  onDuplicate,
  onEditText,
}: {
  shape: Shape;
  onChange: (p: Partial<Shape>) => void;
  onBump: (delta: number) => void;
  onStyle: (s: TextStyleKey) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onEditText: () => void;
}) {
  return (
    <div
      className="absolute left-2 right-2 bottom-0 z-10 pointer-events-none"
      style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}
    >
      <div className="flex justify-center">
        <div className="pointer-events-auto bg-white border shadow-lg rounded-2xl p-2 w-full max-w-md flex flex-col gap-2">
          {shape.kind === "text" && (
            <div className="flex items-center gap-1">
              <TextStyleRow shape={shape} onStyle={onStyle} onToggle={onChange} />
              <div className="flex-1" />
            </div>
          )}
          <div className="flex items-center gap-1 flex-wrap">
            <ToggleBtn icon="bold" active={!!shape.bold} onActivate={() => onChange({ bold: !shape.bold })} ariaLabel="Bold" />
            <ToggleBtn icon="italic" active={!!shape.italic} onActivate={() => onChange({ italic: !shape.italic })} ariaLabel="Italic" />
            <ToggleBtn icon="highlighter" active={!!shape.highlight} onActivate={() => onChange({ highlight: !shape.highlight })} ariaLabel="Highlight" />
            <div className="w-px h-6 bg-slate-200 mx-0.5" />
            <AlignRow shape={shape} onToggle={onChange} />
            <div className="w-px h-6 bg-slate-200 mx-0.5" />
            {/* Keep A- / size / A+ together as one wrap-unit */}
            <div className="flex items-center gap-1">
              <IconBtn icon="a-arrow-down" onClick={() => onBump(-FONT_STEP)} ariaLabel="Smaller text" />
              <div className="px-1 text-xs text-slate-500 tabular-nums w-8 text-center">{effFontSize(shape)}</div>
              <IconBtn icon="a-arrow-up" onClick={() => onBump(FONT_STEP)} ariaLabel="Larger text" />
            </div>
            <div className="flex-1" />
            <IconBtn icon="pencil" onClick={onEditText} ariaLabel="Edit text" />
            <IconBtn icon="copy" onClick={onDuplicate} ariaLabel="Duplicate" title="Duplicate (Cmd/Ctrl+D)" />
            <IconBtn icon="trash" onClick={onDelete} ariaLabel="Delete shape" variant="danger" />
          </div>
          <div className="flex items-center gap-1.5 px-1">
            <span className="text-[10px] uppercase tracking-wide text-slate-400 w-8 shrink-0">Fill</span>
            <div className="flex flex-wrap gap-1.5">
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  onClick={() => onChange({ fill: c })}
                  className={`w-7 h-7 rounded-full border ${shape.fill === c ? "ring-2 ring-slate-900 ring-offset-1" : ""}`}
                  style={{ background: c }}
                  aria-label={`Fill ${c}`}
                />
              ))}
            </div>
          </div>
          {shape.highlight && (
            <div className="flex items-center gap-1.5 px-1">
              <span className="text-[10px] uppercase tracking-wide text-slate-400 w-8 shrink-0">Hi</span>
              <div className="flex flex-wrap gap-1.5">
                {HIGHLIGHT_SWATCHES.map((c) => (
                  <button
                    key={c}
                    onClick={() => onChange({ highlightColor: c })}
                    className={`w-7 h-7 rounded-full border ${effHighlightColor(shape) === c ? "ring-2 ring-slate-900 ring-offset-1" : ""}`}
                    style={{ background: c }}
                    aria-label={`Highlight ${c}`}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- ImageInspector ----------

function ImageInspector({
  onDuplicate,
  onDelete,
}: {
  shape: Shape;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="absolute left-2 right-2 bottom-0 z-10 pointer-events-none"
      style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}
    >
      <div className="flex justify-center">
        <div className="pointer-events-auto bg-white border shadow-lg rounded-2xl p-2 flex items-center gap-1">
          <div className="px-3 text-xs text-slate-500 flex items-center gap-1.5">
            <Icon name="image" size={14} />
            Image
          </div>
          <div className="w-px h-6 bg-slate-200 mx-0.5" />
          <IconBtn icon="copy" onClick={onDuplicate} ariaLabel="Duplicate" title="Duplicate (Cmd/Ctrl+D)" />
          <IconBtn icon="trash" onClick={onDelete} ariaLabel="Delete image" variant="danger" />
        </div>
      </div>
    </div>
  );
}

function LinkInspector({
  shape,
  onOpen,
  onDuplicate,
  onDelete,
}: {
  shape: Shape;
  onOpen: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="absolute left-2 right-2 bottom-0 z-10 pointer-events-none"
      style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}
    >
      <div className="flex justify-center">
        <div className="pointer-events-auto bg-white border shadow-lg rounded-2xl p-2 flex items-center gap-1 max-w-md w-full">
          <div className="px-3 text-xs text-slate-500 flex items-center gap-1.5 min-w-0 flex-1">
            <Icon name="link" size={14} />
            <span className="truncate">{shape.linkProvider || "Link"}</span>
          </div>
          <button
            onClick={onOpen}
            className="h-11 px-3 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 flex items-center gap-1.5"
            disabled={!shape.href}
          >
            <Icon name="external-link" size={16} />
            Open
          </button>
          <IconBtn icon="copy" onClick={onDuplicate} ariaLabel="Duplicate" title="Duplicate (Cmd/Ctrl+D)" />
          <IconBtn icon="trash" onClick={onDelete} ariaLabel="Delete link" variant="danger" />
        </div>
      </div>
    </div>
  );
}
