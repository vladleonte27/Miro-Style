"use client";

import { useState } from "react";
import type { MindmapNode } from "@/lib/mindmap";

interface Props {
  open: boolean;
  onClose: () => void;
  onGenerated: (root: MindmapNode) => void;
}

export default function AIMindmapDialog({ open, onClose, onGenerated }: Props) {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function submit() {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/mindmap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      const data = (await res.json()) as { mindmap: MindmapNode };
      onGenerated(data.mindmap);
      setPrompt("");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-1">Generate a mindmap</h2>
        <p className="text-sm text-slate-500 mb-4">
          Describe a topic. Claude will build a tree you can edit.
        </p>
        <textarea
          autoFocus
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
          placeholder="e.g. Launch plan for a meal-prep startup"
          rows={4}
          className="w-full border rounded-md p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
        />
        {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-md hover:bg-slate-100"
            disabled={loading}
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={loading || !prompt.trim()}
            className="px-4 py-1.5 text-sm rounded-md bg-slate-900 text-white disabled:opacity-50"
          >
            {loading ? "Generating…" : "Generate"}
          </button>
        </div>
        <p className="text-xs text-slate-400 mt-3">⌘/Ctrl + Enter to submit</p>
      </div>
    </div>
  );
}
