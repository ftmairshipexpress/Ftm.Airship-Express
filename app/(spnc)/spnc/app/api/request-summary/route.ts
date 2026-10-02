import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing GROQ_API_KEY" }, { status: 500 });
  }

  try {
    const {
      name, department, providerType, description, requestSent,
      existingSameType = 0, existingNames = [],
    } = await req.json();

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
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You help a logistics network controller review department requests for new service providers.
Reply with ONLY a JSON object: {"summary":"one short sentence","providersNeeded":number,"reason":"one short sentence explaining the count","priority":"urgent|normal|low"}
Rules: providersNeeded is the number of NEW providers to onboard (at least 1). Use more than 1 only if the description implies multiple lanes, regions, cargo types or backup/redundancy. In "reason", mention the existing active providers of that type when there are any. Mark urgent only if the text says urgent, ASAP, or has a tight deadline. No markdown.`,
          },
          {
            role: "user",
            content: `Requester: ${name}
Department: ${department}
Provider type: ${providerType}
Sent: ${requestSent}
Description: ${description}
Existing active providers of this type: ${existingSameType}${existingNames.length ? ` (${existingNames.join(", ")})` : ""}`,
          },
        ],
      }),
    });

    if (!res.ok) {
      console.error("Groq error", res.status, await res.text());
      return NextResponse.json({ error: `Groq returned ${res.status}` }, { status: 502 });
    }

    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());

    return NextResponse.json({
      summary: String(parsed.summary ?? ""),
      providersNeeded: Math.max(1, Number(parsed.providersNeeded) || 1),
      reason: String(parsed.reason ?? ""),
      priority: ["urgent", "normal", "low"].includes(parsed.priority) ? parsed.priority : "normal",
    });
  } catch (err) {
    console.error("request-summary failed", err);
    return NextResponse.json({ error: "Request failed" }, { status: 502 });
  }
}