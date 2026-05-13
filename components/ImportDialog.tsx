"use client";

import { useState } from "react";
import { sanitizeMindmap, type MindmapNode } from "@/lib/mindmap";
import { Icon } from "./icons";

interface Props {
  open: boolean;
  onClose: () => void;
  onImport: (root: MindmapNode) => void;
}

function extractJson(raw: string): unknown | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const body = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(body);
  } catch {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(body.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export default function ImportDialog({ open, onClose, onImport }: Props) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function paste() {
    try {
      const t = await navigator.clipboard.readText();
      setText(t);
      setError(null);
    } catch {
      setError("Clipboard blocked — long-press the box and paste manually.");
    }
  }

  function submit() {
    const parsed = extractJson(text);
    const mindmap = sanitizeMindmap(parsed);
    if (!mindmap) {
      setError("That doesn't look like a valid mindmap JSON. Need { \"label\": …, \"children\": […] }.");
      return;
    }
    onImport(mindmap);
    setText("");
    setError(null);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full sm:max-w-lg sm:rounded-xl rounded-t-2xl shadow-xl p-5"
        style={{ paddingBottom: "max(20px, env(safe-area-inset-bottom))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-3">
          <div>
            <h2 className="text-lg font-semibold">Import mindmap</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Paste the JSON Claude gave you in chat.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 p-2 -mt-1"
            aria-label="Close"
          >
            <Icon name="x" size={20} />
          </button>
        </div>

        <textarea
          autoFocus
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          placeholder='{"label":"Topic","children":[{"label":"Branch","children":[]}]}'
          rows={8}
          className="w-full border rounded-lg p-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-slate-900"
        />
        {error && <p className="text-sm text-red-600 mt-2">{error}</p>}

        <div className="flex gap-2 mt-4">
          <button
            onClick={paste}
            className="flex-1 px-4 py-3 text-sm rounded-lg bg-slate-100 hover:bg-slate-200 font-medium flex items-center justify-center gap-2"
          >
            <Icon name="clipboard" size={18} />
            Paste
          </button>
          <button
            onClick={submit}
            disabled={!text.trim()}
            className="flex-1 px-4 py-3 text-sm rounded-lg bg-slate-900 text-white disabled:opacity-50 font-medium flex items-center justify-center gap-2"
          >
            <Icon name="check" size={18} />
            Add to board
          </button>
        </div>
      </div>
    </div>
  );
}
