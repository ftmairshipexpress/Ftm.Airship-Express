// Save as: app/api/anomaly-explain/route.ts
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing GROQ_API_KEY" }, { status: 500 });
  }

  try {
    const { title, subject, expected, current } = await req.json();

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-20b",
        reasoning_effort: "low",
        include_reasoning: false,
        max_completion_tokens: 1500, // reasoning tokens count too, so leave headroom
        messages: [
          {
            role: "system",
            content:
              "You are a logistics network control assistant. Reply in 2 short sentences: the likely cause, then one recommended action. No markdown.",
          },
          {
            role: "user",
            content: `Alert: ${title}\nSubject: ${subject}\nExpected: ${expected}\nCurrent: ${current}`,
          },
        ],
      }),
    });

    if (!res.ok) {
      const detail = await res.text(); // shows the real reason in your server terminal
      console.error("Groq error", res.status, detail);
      return NextResponse.json({ error: `Groq returned ${res.status}` }, { status: 502 });
    }

    const data = await res.json();
    const advice = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!advice) {
      console.error("Groq returned empty content", JSON.stringify(data));
      return NextResponse.json({ error: "Empty response from model" }, { status: 502 });
    }
    return NextResponse.json({ advice });
  } catch (err) {
    console.error("anomaly-explain failed", err);
    return NextResponse.json({ error: "Request failed" }, { status: 502 });
  }
}