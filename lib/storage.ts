"use client";

import type { Anchor, Board, Edge, Shape, ShapeKind } from "./types";
import { newId } from "./id";

const KEY = "miro-style:boards:v1";
const VALID_KINDS: ShapeKind[] = ["rect", "ellipse", "diamond", "text"];
const VALID_ANCHORS: Anchor[] = ["top", "right", "bottom", "left"];

function isNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function sanitizeShape(raw: unknown): Shape | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<Shape>;
  if (typeof s.id !== "string" || !s.id) return null;
  if (typeof s.kind !== "string" || !VALID_KINDS.includes(s.kind as ShapeKind)) return null;
  if (!isNumber(s.x) || !isNumber(s.y) || !isNumber(s.w) || !isNumber(s.h)) return null;
  if (s.w < 1 || s.h < 1) return null;
  return {
    id: s.id,
    kind: s.kind as ShapeKind,
    x: s.x,
    y: s.y,
    w: s.w,
    h: s.h,
    text: typeof s.text === "string" ? s.text : "",
    fill: typeof s.fill === "string" ? s.fill : "#ffffff",
    stroke: typeof s.stroke === "string" ? s.stroke : "#1f2937",
    fontSize: isNumber(s.fontSize) ? s.fontSize : undefined,
    bold: typeof s.bold === "boolean" ? s.bold : undefined,
    italic: typeof s.italic === "boolean" ? s.italic : undefined,
    highlight: typeof s.highlight === "boolean" ? s.highlight : undefined,
    highlightColor: typeof s.highlightColor === "string" ? s.highlightColor : undefined,
  };
}

function sanitizeEdge(raw: unknown, ids: Set<string>): Edge | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Partial<Edge>;
  if (typeof e.id !== "string" || !e.id) return null;
  if (typeof e.from !== "string" || typeof e.to !== "string") return null;
  if (!ids.has(e.from) || !ids.has(e.to)) return null;
  if (e.from === e.to) return null;
  const fromAnchor = typeof e.fromAnchor === "string" && VALID_ANCHORS.includes(e.fromAnchor as Anchor)
    ? (e.fromAnchor as Anchor)
    : undefined;
  const toAnchor = typeof e.toAnchor === "string" && VALID_ANCHORS.includes(e.toAnchor as Anchor)
    ? (e.toAnchor as Anchor)
    : undefined;
  return { id: e.id, from: e.from, to: e.to, fromAnchor, toAnchor };
}

function sanitizeBoard(raw: unknown): Board | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Partial<Board>;
  if (typeof b.id !== "string" || !b.id) return null;
  const name = typeof b.name === "string" ? b.name : "Untitled board";
  const shapes = Array.isArray(b.shapes)
    ? (b.shapes.map(sanitizeShape).filter(Boolean) as Shape[])
    : [];
  const ids = new Set(shapes.map((s) => s.id));
  const edges = Array.isArray(b.edges)
    ? (b.edges.map((e) => sanitizeEdge(e, ids)).filter(Boolean) as Edge[])
    : [];
  // Dedupe edges by (from, to) — defensive.
  const seen = new Set<string>();
  const uniqueEdges: Edge[] = [];
  for (const e of edges) {
    const k = `${e.from}|${e.to}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniqueEdges.push(e);
  }
  return {
    id: b.id,
    name,
    shapes,
    edges: uniqueEdges,
    createdAt: isNumber(b.createdAt) ? b.createdAt : Date.now(),
    updatedAt: isNumber(b.updatedAt) ? b.updatedAt : Date.now(),
  };
}

function read(): Board[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitizeBoard).filter(Boolean) as Board[];
  } catch {
    return [];
  }
}

function write(boards: Board[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(boards));
  } catch (err) {
    // Quota exceeded or storage disabled — fail soft.
    console.error("Miro-Style: failed to persist boards", err);
  }
}

export function listBoards(): Board[] {
  return read().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getBoard(id: string): Board | null {
  return read().find((b) => b.id === id) ?? null;
}

export function createBoard(name = "Untitled board"): Board {
  const now = Date.now();
  const board: Board = {
    id: newId("b_"),
    name,
    shapes: [],
    edges: [],
    createdAt: now,
    updatedAt: now,
  };
  write([board, ...read()]);
  return board;
}

export function saveBoard(board: Board) {
  const boards = read();
  const i = boards.findIndex((b) => b.id === board.id);
  const next = { ...board, updatedAt: Date.now() };
  if (i >= 0) boards[i] = next;
  else boards.push(next);
  write(boards);
}

export function renameBoard(id: string, name: string) {
  const boards = read();
  const i = boards.findIndex((b) => b.id === id);
  if (i < 0) return;
  boards[i] = { ...boards[i], name, updatedAt: Date.now() };
  write(boards);
}

export function deleteBoard(id: string) {
  write(read().filter((b) => b.id !== id));
}
