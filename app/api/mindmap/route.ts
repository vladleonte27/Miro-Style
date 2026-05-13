import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { sanitizeMindmap } from "@/lib/mindmap";

export const runtime = "nodejs";

const SYSTEM = `You generate mindmaps as JSON.

Output rules:
- Return ONLY a JSON object, no prose, no markdown fences.
- Schema: { "label": string, "children": Node[] }, where Node has the same shape.
- The root label is the topic.
- 3 to 6 top-level branches.
- Each branch has 2 to 5 children, optionally one more level of grandchildren when useful.
- Labels are concise (max 8 words). No trailing punctuation.
- Keep it practical and structured.`;

function extractJson(text: string): unknown | null {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // try to find first { ... } block
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function POST(req: Request) {
  let prompt: string;
  try {
    const body = await req.json();
    prompt = String(body?.prompt ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!prompt) {
    return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured on the server." },
      { status: 500 },
    );
  }

  const client = new Anthropic();

  try {
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });

    const first = msg.content[0];
    const text = first && first.type === "text" ? first.text : "";
    const parsed = extractJson(text);
    const mindmap = sanitizeMindmap(parsed);
    if (!mindmap) {
      return NextResponse.json(
        { error: "Model did not return a valid mindmap." },
        { status: 502 },
      );
    }
    return NextResponse.json({ mindmap });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
