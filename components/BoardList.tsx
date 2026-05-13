"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createBoard,
  deleteBoard,
  listBoards,
  renameBoard,
} from "@/lib/storage";
import type { Board } from "@/lib/types";

export default function BoardList() {
  const router = useRouter();
  const [boards, setBoards] = useState<Board[] | null>(null);

  useEffect(() => {
    setBoards(listBoards());
  }, []);

  function refresh() {
    setBoards(listBoards());
  }

  function onCreate() {
    const b = createBoard("Untitled board");
    router.push(`/board/${b.id}`);
  }

  function onRename(id: string, current: string) {
    const next = window.prompt("Rename board", current);
    if (next && next.trim()) {
      renameBoard(id, next.trim());
      refresh();
    }
  }

  function onDelete(id: string) {
    if (window.confirm("Delete this board? This cannot be undone.")) {
      deleteBoard(id);
      refresh();
    }
  }

  if (boards === null) {
    return <p className="text-slate-500">Loading…</p>;
  }

  return (
    <section>
      <div className="flex justify-end mb-4">
        <button
          onClick={onCreate}
          className="px-4 py-2 rounded-md bg-slate-900 text-white text-sm font-medium hover:bg-slate-700"
        >
          + New board
        </button>
      </div>

      {boards.length === 0 ? (
        <div className="border border-dashed rounded-lg p-12 text-center text-slate-500">
          <p className="mb-3">No boards yet.</p>
          <button onClick={onCreate} className="underline">
            Create your first board
          </button>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {boards.map((b) => (
            <li
              key={b.id}
              className="group bg-white border rounded-lg p-4 hover:shadow-md transition-shadow"
            >
              <Link href={`/board/${b.id}`} className="block">
                <h3 className="font-medium truncate">{b.name}</h3>
                <p className="text-xs text-slate-500 mt-1">
                  {b.shapes.length} shapes · updated{" "}
                  {new Date(b.updatedAt).toLocaleString()}
                </p>
              </Link>
              <div className="flex gap-3 text-xs mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => onRename(b.id, b.name)}
                  className="text-slate-600 hover:text-slate-900"
                >
                  Rename
                </button>
                <button
                  onClick={() => onDelete(b.id)}
                  className="text-red-600 hover:text-red-800"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
