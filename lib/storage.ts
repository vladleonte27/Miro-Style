"use client";

import type { Board } from "./types";
import { newId } from "./id";

const KEY = "miro-style:boards:v1";

function read(): Board[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(boards: Board[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(boards));
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
