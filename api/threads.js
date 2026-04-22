export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { query, imageBase64, imageType } = req.body;

  const userContent = [];
  if (imageBase64) {
    userContent.push({ type: "image", source: { type: "base64", media_type: imageType || "image/jpeg", data: imageBase64 }});
  }
  userContent.push({ type: "text", text: imageBase64 ? `Identify this museum artwork then find 3 real connected works. ${query || ""}` : `About "${query}": identify it in a major museum then find 3 real connected works.` });

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2048,
        system: `You are ArtThread. Only use REAL verifiable artworks. Respond ONLY with JSON, no markdown:
{"anchor":{"title":"","artist":"","date":"","museum":"","metId":null},"connections":[{"title":"","artist":"","date":"","museum":"","thread":"light|grief|power|nature|chaos|time|identity","throughline":"","metId":null}]}`,
        messages: [{ role: "user", content: userContent }]
      })
    });

    const data = await response.json();
    const text = (data.content || []).map(b => b.text || "").join("");
    return res.status(200).json(JSON.parse(text.replace(/```json|```/g, "").trim()));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
