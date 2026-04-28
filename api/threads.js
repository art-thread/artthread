// v7 - Multi-museum: Met + Art Institute Chicago + Rijksmuseum + V&A + Wikimedia + Cooper Hewitt

async function fetchWikimediaImage(title, artist) {
    try {
          const q = encodeURIComponent(title + ' ' + artist);
          const res = await fetch('https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=' + q + '&gsrlimit=1&prop=pageimages&piprop=thumbnail&pithumbsize=400&format=json&origin=*');
          const data = await res.json();
          const pages = data && data.query && data.query.pages;
          if (!pages) return null;
          const page = Object.values(pages)[0];
          return page && page.thumbnail ? page.thumbnail.source : null;
    } catch(e) { return null; }
}

async function fetchMetData(title, artist) {
    try {
          const q = encodeURIComponent(title + ' ' + artist);
          const searchRes = await fetch('https://collectionapi.metmuseum.org/public/collection/v1/search?q=' + q + '&hasImages=true');
          const searchData = await searchRes.json();
          if (!searchData.objectIDs || !searchData.objectIDs.length) return null;
          const objRes = await fetch('https://collectionapi.metmuseum.org/public/collection/v1/objects/' + searchData.objectIDs[0]);
          const obj = await objRes.json();
          const image = obj.primaryImage || obj.primaryImageSmall || null;
          if (!image) return null;
          return { metId: obj.objectID, primaryImage: image, museum: obj.repository || 'Metropolitan Museum of Art, New York' };
    } catch(e) { return null; }
}

async function fetchAICData(title, artist) {
    try {
          const q = encodeURIComponent(title + ' ' + artist);
          const res = await fetch('https://api.artic.edu/api/v1/artworks/search?q=' + q + '&limit=1&fields=id,title,image_id');
          const data = await res.json();
          const work = data && data.data && data.data[0];
          if (!work || !work.image_id) return null;
          return { primaryImage: 'https://www.artic.edu/iiif/2/' + work.image_id + '/full/400,/0/default.jpg', museum: 'Art Institute of Chicago' };
    } catch(e) { return null; }
}

async function fetchRijksData(title, artist) {
    try {
          const key = process.env.RIJKSMUSEUM_API_KEY;
          if (!key) return null;
          const q = encodeURIComponent(title + ' ' + artist);
          const res = await fetch('https://www.rijksmuseum.nl/api/en/collection?key=' + key + '&q=' + q + '&imgonly=true&ps=1&format=json');
          const data = await res.json();
          const work = data && data.artObjects && data.artObjects[0];
          if (!work || !work.webImage || !work.webImage.url) return null;
          return { primaryImage: work.webImage.url, museum: 'Rijksmuseum, Amsterdam' };
    } catch(e) { return null; }
}

async function fetchVAData(title, artist) {
    try {
          const q = encodeURIComponent(title + ' ' + artist);
          const res = await fetch('https://api.vam.ac.uk/v2/objects/search?q=' + q + '&images_exist=1&page_size=1');
          const data = await res.json();
          const record = data && data.records && data.records[0];
          if (!record) return null;
          const imageId = record._primaryImageId;
          if (!imageId) return null;
          return { primaryImage: 'https://framemark.vam.ac.uk/collections/' + imageId + '/full/400,/0/default.jpg', museum: 'Victoria and Albert Museum, London' };
    } catch(e) { return null; }
}

async function fetchCooperHewittData(title, artist) {
    try {
          const key = process.env.COOPER_HEWITT_API_KEY;
          if (!key) return null;
          const q = encodeURIComponent(title + ' ' + artist);
          const res = await fetch('https://api.collection.cooperhewitt.org/rest/?method=cooperhewitt.search.objects&access_token=' + key + '&query=' + q + '&has_images=1&per_page=1');
          const data = await res.json();
          const objects = data && data.objects;
          if (!objects || !objects.length) return null;
          const obj = objects[0];
          const images = obj.images;
          if (!images || !images.length) return null;
          const img = images[0].b || images[0].z || images[0].n;
          if (!img || !img.url) return null;
          return { primaryImage: img.url, museum: 'Cooper Hewitt, Smithsonian Design Museum, New York' };
    } catch(e) { return null; }
}

async function fetchArtworkImage(title, artist) {
    if (!title || title === 'Unknown work') return null;
    const results = await Promise.allSettled([
          fetchMetData(title, artist),
          fetchAICData(title, artist),
          fetchRijksData(title, artist),
          fetchVAData(title, artist),
          fetchCooperHewittData(title, artist)
        ]);
    for (const r of results) {
          if (r.status === 'fulfilled' && r.value && r.value.primaryImage) return r.value;
    }
    const wiki = await fetchWikimediaImage(title, artist);

  const ALBERTINA = `
  ALBERTINA MUSEUM Vienna - verified from sammlungenonline.albertina.at

  ALBRECHT DURER (shown in rotation):
  - Feldhase / Young Hare (1502) watercolour
  - Das grosse Rasenstuck / Large Piece of Turf (1503) watercolour
  - Betende Hande / Praying Hands (c.1508) pen and ink
  - Veilchenstrauss / Bunch of Violets (c.1495-1500) watercolour

  EGON SCHIELE (209 works - drawings):
  - Self-Portrait with Physalis, Nude Self-Portrait, Embrace, Edith Schiele

  GUSTAV KLIMT:
  - Nixen / Nymphs / Silver Fish (c.1899) painting - PERMANENT DISPLAY
  - Studies for The Kiss (1907-08) drawings

  REMBRANDT VAN RIJN:
  - Ein Elefant / An Elephant (1637) black chalk - shown in rotation

  ANSELM KIEFER (13 works - verified):
  - Der Rhein / The Rhine (1993) monumental woodcut - large scale, dark vertical forms, black and white, wood grain texture
  - Wege der Weltweisheit: die Hermannsschlacht (1993) woodcut
  - Merkaba (2006) mixed media - PERMANENT DISPLAY
  - Fur Paul Celan (2004/2005) prints

  ALBERTINA OWN COLLECTION:
  - The Enchanted Spot (1953) Rene Magritte - PERMANENT
  - Mercedes-Benz W125 (1987) Andy Warhol
  - Mao Tse-Tung (1972) Andy Warhol
  - Abstract Painting (2001) Gerhard Richter
  - Nicolas Rubens with Coral Necklace (c.1619) Peter Paul Rubens - chalk
  - The Painter and the Buyer (c.1565) Pieter Bruegel the Elder - pen and ink
  - Los Caprichos series (c.1794-98) Francisco Goya

  TEMPORARY EXHIBITION (April-August 2026):
  - Richard Prince retrospective: Cowboys, Fashion, Gangs

  LEOPOLD MUSEUM Vienna:
  - Death and Life (1910-15) Gustav Klimt
  - Hope II (1907-08) Gustav Klimt
  - Self-Portrait with Physalis (1912) Egon Schiele
  - The Family (1918) Egon Schiele
  - Portrait of Wally (1912) Egon Schiele
  - Agony (1912) Egon Schiele
  - The Dancer (1916-18) Richard Gerstl
  - Self-Portrait Laughing (1908) Richard Gerstl

  RULES:
  - Match works to this list. Set museum field accordingly.
  - Kiefer monumental black-and-white woodcuts with vertical dark forms = Der Rhein or Wege der Weltweisheit at Albertina.
  - If you cannot confidently identify a work set title to Unknown work and artist to Unknown artist. Never guess.
  - Ignore glass reflections glare and people in foreground.
  `;

  export default async function handler(req, res) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') return res.status(200).end();
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

      const { query, imageBase64, imageType } = req.body;
      const userContent = [];
      if (imageBase64) {
            userContent.push({ type: 'image', source: { type: 'base64', media_type: imageType || 'image/jpeg', data: imageBase64 }});
      }
      userContent.push({ type: 'text', text: imageBase64
            ? 'Identify this artwork then find 3 connected works. Ignore glass reflections and people in foreground. If you cannot confidently identify the work set title to Unknown work. ' + (query || '')
            : 'Find connections for: "' + query + '"' });

      try {
            const response = await fetch('https://api.anthropic.com/v1/messages', {
                    method: 'POST',
                    headers: {
                              'Content-Type': 'application/json',
                              'x-api-key': process.env.ANTHROPIC_API_KEY,
                              'anthropic-version': '2023-06-01'
                    },
                    body: JSON.stringify({
                              model: 'claude-sonnet-4-6',
                              max_tokens: 4096,
                              system: 'You are ArtThread. Only use REAL verifiable artworks. Ignore reflections and people in photos. If you cannot confidently identify a work set title to Unknown work and artist to Unknown artist.' + ALBERTINA,
                              messages: [{ role: 'user', content: userContent }]
                    })
            });

            const data = await response.json();
            if (!data.content || !data.content[0]) return res.status(500).json({ error: 'No API response: ' + JSON.stringify(data) });

            const text = data.content[0].text;
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (!jsonMatch) return res.status(500).json({ error: 'No JSON found: ' + text.substring(0, 200) });

            const result = JSON.parse(jsonMatch[0]);

            const anchorMet = await fetchMetData(result.anchor.title, result.anchor.artist);
            if (anchorMet) {
                    result.anchor.metId = anchorMet.metId;
                    result.anchor.primaryImage = anchorMet.primaryImage;
            } else {
                    const anchorImg = await fetchArtworkImage(result.anchor.title, result.anchor.artist);
                    if (anchorImg && anchorImg.primaryImage) result.anchor.primaryImage = anchorImg.primaryImage;
            }

            if (result.connections && result.connections.length) {
                    await Promise.all(result.connections.map(async (conn) => {
                              const img = await fetchArtworkImage(conn.title, conn.artist);
                              if (img && img.primaryImage) {
                                          conn.primaryImage = img.primaryImage;
                                          if (img.metId) conn.metId = img.metId;
                              }
                    }));
            }

            return res.status(200).json(result);
      } catch (err) {
            return res.status(500).json({ error: err.message });
      }
  }
    
