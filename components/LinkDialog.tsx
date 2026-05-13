"use client";

import { useState } from "react";
import { Icon } from "./icons";

export interface LinkPreview {
  href: string;
  title: string;
  thumbnail?: string;
  provider: "YouTube" | "Instagram" | "Web";
  domain: string;
}

function detectProvider(host: string): LinkPreview["provider"] {
  const h = host.toLowerCase();
  if (h.includes("youtube.com") || h === "youtu.be" || h.endsWith(".youtube.com")) return "YouTube";
  if (h.includes("instagram.com")) return "Instagram";
  return "Web";
}

export function getYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
    if (u.hostname.includes("youtube.com")) {
      if (u.pathname === "/watch") return u.searchParams.get("v");
      const m = u.pathname.match(/\/(?:shorts|embed|v|live)\/([^/?]+)/);
      if (m) return m[1];
    }
    return null;
  } catch {
    return null;
  }
}

export async function fetchLinkPreview(rawUrl: string): Promise<LinkPreview> {
  const url = new URL(rawUrl);
  const host = url.hostname;
  const provider = detectProvider(host);
  const out: LinkPreview = {
    href: url.href,
    title: url.href,
    domain: host.replace(/^www\./, ""),
    provider,
  };

  if (provider === "YouTube") {
    const id = getYouTubeId(url.href);
    if (id) {
      out.thumbnail = `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
      // Try oEmbed for the title (CORS-friendly on YouTube)
      try {
        const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url.href)}&format=json`);
        if (r.ok) {
          const data = await r.json();
          if (data?.title) out.title = data.title;
          if (data?.thumbnail_url) out.thumbnail = data.thumbnail_url;
        }
      } catch {}
      // Fallback title if oEmbed failed
      if (out.title === url.href) out.title = "YouTube video";
      return out;
    }
  }

  // Generic / Instagram: ask the server for Open Graph tags
  try {
    const r = await fetch(`/api/link-preview?url=${encodeURIComponent(url.href)}`);
    if (r.ok) {
      const data = await r.json();
      if (data?.title) out.title = data.title;
      if (data?.image) out.thumbnail = data.image;
    }
  } catch {}
  if (out.title === url.href) out.title = out.domain;
  return out;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCommit: (preview: LinkPreview) => void;
}

export default function LinkDialog({ open, onClose, onCommit }: Props) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  function validUrl(s: string): URL | null {
    const trimmed = s.trim();
    if (!trimmed) return null;
    try {
      let candidate = trimmed;
      if (!/^https?:\/\//i.test(candidate)) candidate = "https://" + candidate;
      const u = new URL(candidate);
      if (!["http:", "https:"].includes(u.protocol)) return null;
      return u;
    } catch {
      return null;
    }
  }

  async function load() {
    const u = validUrl(url);
    if (!u) {
      setError("That doesn't look like a valid URL.");
      return;
    }
    setError(null);
    setLoading(true);
    setPreview(null);
    try {
      const p = await fetchLinkPreview(u.href);
      setPreview(p);
    } catch {
      setError("Couldn't fetch a preview. You can still add the link.");
    } finally {
      setLoading(false);
    }
  }

  async function paste() {
    try {
      const t = await navigator.clipboard.readText();
      setUrl(t);
      setError(null);
    } catch {
      setError("Clipboard blocked — long-press the box and paste manually.");
    }
  }

  function commit() {
    const u = validUrl(url);
    if (!u) {
      setError("That doesn't look like a valid URL.");
      return;
    }
    if (preview) {
      onCommit(preview);
    } else {
      onCommit({
        href: u.href,
        title: u.hostname.replace(/^www\./, ""),
        domain: u.hostname.replace(/^www\./, ""),
        provider: detectProvider(u.hostname),
      });
    }
    setUrl("");
    setPreview(null);
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
            <h2 className="text-lg font-semibold">Add a link</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              YouTube, Instagram, or any URL — we&apos;ll grab the thumbnail.
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

        <div className="flex gap-2">
          <input
            value={url}
            onChange={(e) => { setUrl(e.target.value); setPreview(null); setError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") load(); }}
            placeholder="https://…"
            className="flex-1 border rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
            autoFocus
            inputMode="url"
          />
          <button
            onClick={paste}
            className="px-3 rounded-lg bg-slate-100 hover:bg-slate-200"
            aria-label="Paste from clipboard"
            title="Paste"
          >
            <Icon name="clipboard" size={18} />
          </button>
        </div>
        {error && <p className="text-sm text-red-600 mt-2">{error}</p>}

        <div className="mt-3">
          {loading && (
            <div className="border rounded-lg p-3 text-sm text-slate-500">Fetching preview…</div>
          )}
          {preview && (
            <div className="border rounded-lg overflow-hidden">
              {preview.thumbnail && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={preview.thumbnail}
                  alt=""
                  className="block w-full max-h-48 object-cover"
                />
              )}
              <div className="p-3">
                <div className="text-sm font-semibold line-clamp-2">{preview.title}</div>
                <div className="text-xs text-slate-500 uppercase tracking-wide mt-1">
                  {preview.provider} · {preview.domain}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-2 mt-4">
          {!preview && !loading && (
            <button
              onClick={load}
              disabled={!url.trim()}
              className="flex-1 px-4 py-3 text-sm rounded-lg bg-slate-100 hover:bg-slate-200 font-medium disabled:opacity-50"
            >
              Fetch preview
            </button>
          )}
          <button
            onClick={commit}
            disabled={!url.trim()}
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
