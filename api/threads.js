import Anthropic from "@anthropic-ai/sdk";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { query, imageBase64, imageType } = req.body;
  if (!query && !imageBase64) return res.status(400).json({ error: "No input provided" });

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const userContent = [];
  if (imageBase64) {
    userContent.push({ type: "image", source: { type: "base64", media_type: imageType || "image/jpeg", data: imageBase64 }});
  }

  const textPrompt = imageBase64
    ? `The user uploaded a museum photo. Identify the artwork. Then find 3 real artworks from major collections sharing deep thematic connections. ${query ? "Context: " + query : ""}`
    : `About: "${query}". Identify the most likely artwork in a major museum. Then find 3 real artworks from major collections with deep thematic connections.`;

  userContent.push({ type: "text", text: textPrompt });

  try {
    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: `You are ArtThread's art intelligence engine. Only reference REAL verifiable artworks from major museums. Never invent artworks. Respond ONLY with a JSON object, no markdown:
{
  "anchor": { "title": "exact title", "artist": "artist name", "date": "year", "museum": "museum name", "metId": null },
  "connections": [
    { "title": "exact title", "artist": "artist name", "date": "year", "museum": "museum name", "thread": "light|grief|power|nature|chaos|time|identity", "throughline": "one evocative sentence", "metId": null }
  ]
}`,
      messages: [{ role: "user", content: userContent }]
    });

    const text = message.content.map(b => b.text || "").join("");
    const clean = text.replace(/```json|```/g, "").trim();
    return res.status(200).json(JSON.parse(clean));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
