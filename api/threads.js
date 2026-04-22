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
  userContent.push({ type: "text", text: imageBase64 ? `Identify this artwork then find 3 connected works. ${query || ""}` : `Find connections for: "${query}"` });

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 4096,
        system: `You are ArtThread. Only use REAL verifiable artworks. Respond with ONLY valid JSON, nothing else, no markdown:
{"anchor":{"title":"title","artist":"artist","date":"date","museum":"museum","metId":null},"connections":[{"title":"title","artist":"artist","date":"date","museum":"museum","thread":"light","throughline":"sentence","metId":null},{"title":"title","artist":"artist","date":"date","museum":"museum","thread":"power","throughline":"sentence","metId":null},{"title":"title","artist":"artist","date":"date","museum":"museum","thread":"time","throughline":"sentence","metId":null}]}`,
        messages: [{ role: "user", content: userContent }]
      })
    });

    const data = await response.json();
    
    if (!data.content || !data.content[0]) {
      return res.status(500).json({ error: "No response from API: " + JSON.stringify(data) });
    }

    const text = data.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(500).json({ error: "No JSON found in: " + text.substring(0, 200) });
    
    return res.status(200).json(JSON.parse(jsonMatch[0]));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
