export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { query, imageBase64, imageType } = req.body;

  if (!query && !imageBase64) {
    return res.status(400).json({ error: 'No query or image provided' });
  }

  const userContent = [];

  if (imageBase64) {
    userContent.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: imageType || 'image/jpeg',
        data: imageBase64,
      },
    });
  }

  const textPrompt = imageBase64
    ? `The user has uploaded a photo taken at a museum. First, identify what artwork this likely is (title, artist, date, medium). Then find 3 real artworks from major museum collections that share deep thematic or visual connections with it. ${query ? 'Additional context: ' + query : ''}`
    : `The user is asking about: "${query}". Identify the most likely matching artwork in a major museum collection (title, artist, date). Then find 3 real artworks from major museum collections that share deep thematic or visual DNA connections with it.`;

  userContent.push({ type: 'text', text: textPrompt });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: `You are ArtThread's art intelligence engine. You only reference REAL, verifiable artworks from major museum collections (Met, Tate, Rijksmuseum, Uffizi, KHM, Albertina, Louvre etc). Never invent artworks.

Respond ONLY with a JSON object. No preamble, no markdown, no backticks. Structure:
{
  "anchor": {
    "title": "exact artwork title",
    "artist": "artist name",
    "date": "year or period",
    "museum": "museum name",
    "metId": "Met object ID if Met artwork, else null"
  },
  "connections": [
    {
      "title": "exact artwork title",
      "artist": "artist name",
      "date": "year or period",
      "museum": "museum name",
      "thread": "light|grief|power|nature|chaos|time|identity",
      "throughline": "One evocative sentence explaining the deep connection — what invisible thread links these two works across time",
      "metId": "Met object ID if Met artwork, else null"
    }
  ]
}

Only use real artworks. Thread must be one of: light, grief, power, nature, chaos, time, identity. Throughlines should be poetic and insightful.`,
        messages: [{ role: 'user', content: userContent }],
      }),
    });

    const data = await response.json();

    if (data.error) {
      return res.status(500).json({ error: data.error.message });
    }

    const text = data.content.map((i) => i.text || '').join('');
    const clean = text.replace(/```json|```/g, '').trim();
    const result = JSON.parse(clean);

    return res.status(200).json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Something went wrong' });
  }
}
