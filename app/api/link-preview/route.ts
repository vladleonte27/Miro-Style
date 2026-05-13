import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Preview {
  title?: string;
  image?: string;
  description?: string;
  siteName?: string;
}

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function metaContent(html: string, name: string): string | undefined {
  const a = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']+)["']`, "i");
  const b = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${name}["']`, "i");
  const m = html.match(a) ?? html.match(b);
  return m ? decodeHtml(m[1]) : undefined;
}

function firstMeta(html: string, names: string[]): string | undefined {
  for (const n of names) {
    const v = metaContent(html, n);
    if (v) return v;
  }
  return undefined;
}

function isSafeHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h === "0.0.0.0" || h === "::1") return false;
  if (/^127\./.test(h)) return false;
  if (/^10\./.test(h)) return false;
  if (/^192\.168\./.test(h)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
  if (/^169\.254\./.test(h)) return false;
  if (h.startsWith("[fe80:") || h.startsWith("[fc00:") || h.startsWith("[fd00:")) return false;
  return true;
}

async function fetchHtml(url: string, ms = 7000): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    const r = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timer);
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") || "";
    if (!ct.includes("html") && !ct.includes("xml")) return null;
    const reader = r.body?.getReader();
    if (!reader) return null;
    const decoder = new TextDecoder();
    let html = "";
    let bytes = 0;
    while (bytes < 150_000) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      html += decoder.decode(value, { stream: true });
    }
    try { await reader.cancel(); } catch {}
    return html;
  } catch {
    return null;
  }
}

async function fetchJson(url: string, ms = 7000): Promise<unknown | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    const r = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timer);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function youTubeId(u: URL): string | null {
  if (u.hostname === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
  if (u.hostname.includes("youtube.com")) {
    if (u.pathname === "/watch") return u.searchParams.get("v");
    const m = u.pathname.match(/\/(?:shorts|embed|v|live)\/([^/?]+)/);
    if (m) return m[1];
  }
  return null;
}

function instagramShortcode(u: URL): { kind: string; id: string } | null {
  // /p/<id>, /reel/<id>, /tv/<id>
  const m = u.pathname.match(/\/(p|reel|tv)\/([^/]+)/);
  if (!m) return null;
  return { kind: m[1], id: m[2] };
}

function parsePreview(html: string, baseUrl: URL): Preview {
  const preview: Preview = {
    title: firstMeta(html, ["og:title", "twitter:title"]),
    image: firstMeta(html, ["og:image", "og:image:secure_url", "twitter:image", "twitter:image:src"]),
    description: firstMeta(html, ["og:description", "twitter:description", "description"]),
    siteName: firstMeta(html, ["og:site_name"]),
  };
  if (!preview.title) {
    const tm = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (tm) preview.title = decodeHtml(tm[1]).trim();
  }
  if (preview.image) {
    try { preview.image = new URL(preview.image, baseUrl.href).href; } catch {}
  }
  return {
    title: preview.title?.slice(0, 220),
    image: preview.image,
    description: preview.description?.slice(0, 400),
    siteName: preview.siteName?.slice(0, 80),
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get("url");
  if (!url) return NextResponse.json({ error: "url required" }, { status: 400 });

  let parsed: URL;
  try { parsed = new URL(url); } catch { return NextResponse.json({ error: "invalid url" }, { status: 400 }); }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return NextResponse.json({ error: "invalid protocol" }, { status: 400 });
  }
  if (!isSafeHost(parsed.hostname)) {
    return NextResponse.json({ error: "blocked host" }, { status: 400 });
  }

  const host = parsed.hostname.toLowerCase();

  // YouTube: oEmbed is the most reliable source for title + thumbnail.
  if (host.includes("youtube.com") || host === "youtu.be") {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(parsed.href)}&format=json`;
    const data = (await fetchJson(oembedUrl)) as { title?: string; thumbnail_url?: string; author_name?: string } | null;
    if (data && (data.title || data.thumbnail_url)) {
      const id = youTubeId(parsed);
      return NextResponse.json({
        title: data.title?.slice(0, 220) || "YouTube video",
        image: data.thumbnail_url || (id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : undefined),
        description: data.author_name,
        siteName: "YouTube",
      });
    }
    // fall through to HTML parse
  }

  // Instagram: their public embed page exposes OG tags without auth.
  if (host.includes("instagram.com")) {
    const shortcode = instagramShortcode(parsed);
    if (shortcode) {
      const embedUrl = `https://www.instagram.com/${shortcode.kind}/${shortcode.id}/embed/`;
      const html = await fetchHtml(embedUrl);
      if (html) {
        const p = parsePreview(html, new URL(embedUrl));
        if (p.title || p.image) {
          return NextResponse.json({
            title: p.title || "Instagram post",
            image: p.image,
            description: p.description,
            siteName: "Instagram",
          });
        }
      }
    }
    // fall through to root page parse
  }

  const html = await fetchHtml(parsed.href);
  if (!html) {
    return NextResponse.json({ error: "fetch failed" }, { status: 502 });
  }
  return NextResponse.json(parsePreview(html, parsed));
}
