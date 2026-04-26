async function fetchMetData(title, artist) {
    try {
          const q = encodeURIComponent(`${title} ${artist}`);
          const searchRes = await fetch(
                  `https://collectionapi.metmuseum.org/public/collection/v1/search?q=${q}&hasImages=true`
                );
          const searchData = await searchRes.json();
          if (!searchData.objectIDs || searchData.objectIDs.length === 0) return null;

      const objRes = await fetch(
              `https://collectionapi.metmuseum.org/public/collection/v1/objects/${searchData.objectIDs[0]}`
            );
          const obj = await objRes.json();
          return { metId: obj.objectID, primaryImage: obj.primaryImage || obj.primaryImageSmall || null };
    } catch {
          return null;
    }
}

const ALBERTINA_COLLECTION = `
ALBERTINA MUSEUM, Vienna — Key permanent collection works:h
- Young Hare (1502) by Albrecht Dürer. Watercolour. Albertina Graphic Art Collection. Shown in rotation.
- Praying Hands / Betende Hände (c.1508) by Albrecht Dürer. Pen and ink. Albertina Graphic Art Collection. Shown in rotation.
- The Water Lily Pond (1917-19) by Claude Monet. Oil on canvas. Batliner Collection. On permanent display.
- Two Dancers (c.1905) by Edgar Degas. Oil on canvas. Batliner Collection. On permanent display.
- Self-Portrait in Orange Jacket (1913) by Egon Schiele. Pencil/watercolour. Albertina permanent. Regularly displayed.
- Female Nude (Dodo) (c.1909) by Egon Schiele. Oil on canvas. Batliner Collection. On permanent display.
- Nymphs / Nixen (c.1899) by Gustav Klimt. Oil on canvas. Bank Austria permanent loan. On display.
- Standing Couple in Profile (1907-08) by Gustav Klimt. Study for The Kiss. Pencil/gold paint. Shown periodically.
- View of Vetheuil (1881) by Claude Monet. Oil on canvas. Batliner Collection. On permanent display.
- Farm in Normandy (c.1885-86) by Paul Cézanne. Oil on canvas. Batliner Collection. On permanent display.
- Young Woman in a Shirt (1918) by Amedeo Modigliani. Oil on canvas. Batliner Collection. On permanent display.
- Mediterranean Landscape (1952) by Pablo Picasso. Oil on wood. Batliner Collection. On permanent display.
- Man in a Suprematist Landscape (c.1930-31) by Kazimir Malevich. Oil on canvas. Batliner Collection. On permanent display.
- Winter Landscape (1915) by Edvard Munch. Oil on canvas. Batliner Collection. On permanent display.
- Woman with Cat (1942) by Pablo Picasso. Oil on canvas. Batliner Collection. On permanent display.
- On the Green Bank, Sanary (1911) by Henri Matisse. Oil on canvas. Batliner Collection. On permanent display.
- Moonlit Night (1914) by Emil Nolde. Oil on canvas. Batliner Collection. On permanent display.
- Inner Alliance (1929) by Wassily Kandinsky. Oil on cardboard. Batliner Collection. On permanent display.
- Girl in a Flowered Hat (1910) by Ernst Ludwig Kirchner. Oil on canvas. Batliner Collection. On permanent display.
- Woman in a Green Hat (1947) by Pablo Picasso. Oil on canvas. Batliner Collection. On permanent display.
- London, Small Thames Landscape (1926) by Oskar Kokoschka. Oil on canvas. Batliner Collection. On permanent display.
- An Elephant (1637) by Rembrandt van Rijn. Black chalk. Albertina Graphic Art Collection. Shown in rotation.
- The Painter and the Buyer (c.1565) by Pieter Bruegel the Elder. Pen and ink. Graphic Art Collection. Shown in rotation.
- Los Caprichos series (c.1794-98) by Francisco Goya. Aquatint/etching. Graphic Art Collection. Selections shown periodically.
- Nicolas Rubens with Coral Necklace (c.1619) by Peter Paul Rubens. Chalk. Graphic Art Collection. Shown in rotation.
- The Enchanted Spot (1953) by Rene Magritte. Oil on canvas. Albertina Collection. On permanent display.
- The Son of Man (1964) by Rene Magritte. Oil on canvas. Private collection / widely exhibited. Note: verify location before citing.
- Henri Lebasque works. Oil on canvas. Albertina Collection. On permanent display.
NOTE: If an image appears to show a work from the above list, identify it correctly and set museum to "Albertina Museum, Vienna".
`;

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
                          model: "claude-sonnet-4-6",
                          max_tokens: 4096,
                          system: `You are ArtThread. Only use REAL verifiable artworks. Respond with ONLY valid JSON, nothing else, no markdown:
                          {"anchor":{"title":"title","artist":"artist","date":"date","museum":"museum","metId":null},"connections":[{"title":"title","artist":"artist","date":"date","museum":"museum","thread":"light","throughline":"sentence","metId":null},{"title":"title","artist":"artist","date":"date","museum":"museum","thread":"power","throughline":"sentence","metId":null},{"title":"title","artist":"artist","date":"date","museum":"museum","thread":"time","throughline":"sentence","metId":null}]}

                          ${ALBERTINA_COLLECTION}`,
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

      const result = JSON.parse(jsonMatch[0]);

      const metData = await fetchMetData(result.anchor.title, result.anchor.artist);
        if (metData) {
                result.anchor.metId = metData.metId;
                result.anchor.primaryImage = metData.primaryImage;
        }

      return res.status(200).json(result);
  } catch (err) {
        return res.status(500).json({ error: err.message });
  }
}
