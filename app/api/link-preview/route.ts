import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Preview {
  title?: string;
  image?: string;
  description?: string;
  siteName?: string;
}

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
  // <meta property="og:title" content="..."> or content="..." property="og:title">
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

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get("url");
  if (!url) return NextResponse.json({ error: "url required" }, { status: 400 });

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return NextResponse.json({ error: "invalid protocol" }, { status: 400 });
  }
  if (!isSafeHost(parsed.hostname)) {
    return NextResponse.json({ error: "blocked host" }, { status: 400 });
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    const r = await fetch(parsed.href, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MiroStyleBot/1.0; +https://miro-style)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timer);
    if (!r.ok) {
      return NextResponse.json({ error: `upstream ${r.status}` }, { status: 502 });
    }
    const contentType = r.headers.get("content-type") || "";
    if (!contentType.includes("html") && !contentType.includes("xml")) {
      return NextResponse.json({ error: "not html" }, { status: 415 });
    }
    // Read up to ~100KB
    const reader = r.body?.getReader();
    if (!reader) return NextResponse.json({ error: "empty body" }, { status: 502 });
    const decoder = new TextDecoder();
    let html = "";
    let bytes = 0;
    while (bytes < 120_000) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      html += decoder.decode(value, { stream: true });
    }
    try { await reader.cancel(); } catch {}

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
    // Resolve relative image URLs against the final URL.
    if (preview.image) {
      try {
        preview.image = new URL(preview.image, parsed.href).href;
      } catch {}
    }
    return NextResponse.json({
      title: preview.title?.slice(0, 220),
      image: preview.image,
      description: preview.description?.slice(0, 400),
      siteName: preview.siteName?.slice(0, 80),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "fetch error";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
