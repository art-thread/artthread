// v6 - Multi-museum: Met + Art Institute Chicago + Rijksmuseum + V&A + Wikimedia

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

async function fetchArtworkImage(title, artist) {
if (!title || title === 'Unknown work') return null;
// Run all sources in parallel — Wikimedia + museum APIs
const [wiki, ...museumResults] = await Promise.allSettled([
fetchWikimediaImage(title, artist),
fetchAICData(title, artist),
fetchRijksData(title, artist),
fetchVAData(title, artist),
fetchMetData(title, artist)
]);
// Wikimedia first if it found something
if (wiki.status === 'fulfilled' && wiki.value) return { primaryImage: wiki.value, museum: null };
// Then museum APIs in order (Met last)
for (const r of museumResults) {
if (r.status === 'fulfilled' && r.value && r.value.primaryImage) return r.value;
}
return null;
}

const ALBERTINA = ''

module.exports = async function handler(req, res) {
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
system: 'You are ArtThread. Only use REAL verifiable artworks. Ignore reflections and people in photos. If you cannot confidently identify a work set title to Unknown work and artist to Unknown artist. Respond with ONLY valid JSON nothing else:\n{"anchor":{"title":"title","artist":"artist","date":"date","museum":"museum","metId":null},"connections":[{"title":"title","artist":"artist","date":"date","museum":"museum","thread":"light","throughline":"one sentence"},{"title":"title","artist":"artist","date":"date","museum":"museum","thread":"power","throughline":"one sentence"},{"title":"title","artist":"artist","date":"date","museum":"museum","thread":"time","throughline":"one sentence"}]}\n\n' + ALBERTINA,
messages: [{ role: 'user', content: userContent }]
})
});

const data = await response.json();
if (!data.content || !data.content[0]) return res.status(500).json({ error: 'No API response: ' + JSON.stringify(data) });

const text = data.content[0].text;
const jsonMatch = text.match(/\{[\s\S]*\}/);
if (!jsonMatch) return res.status(500).json({ error: 'No JSON found: ' + text.substring(0, 200) });

const result = JSON.parse(jsonMatch[0]);

// Anchor image: only try Met if it's actually a Met work
const isMetWork = result.anchor.museum && result.anchor.museum.toLowerCase().includes('metropolitan');
if (isMetWork) {
const anchorMet = await fetchMetData(result.anchor.title, result.anchor.artist);
if (anchorMet) {
result.anchor.metId = anchorMet.metId;
result.anchor.primaryImage = anchorMet.primaryImage;
}
}
if (!result.anchor.primaryImage) {
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