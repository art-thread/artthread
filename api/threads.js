// v28 - Require Wikipedia fallback matches to be categorized as an actual artwork, not just pass title/artist checks — catches homonym pages (e.g. a town's article matching a painting of the same name)

function normalizeTitle(s) {
if (!s) return '';
return s.toLowerCase()
.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
.replace(/[^a-z0-9 ]/g, ' ')
.replace(/\b(the|a|an|of|le|la|les|el|il|der|die|das)\b/g, ' ')
.replace(/\s+/g, ' ')
.trim();
}

function titleMatches(query, candidate) {
const a = normalizeTitle(query);
const b = normalizeTitle(candidate);
if (!a || !b) return false;
if (a === b) return true;
// allow exact containment only if lengths are close (avoids "raft medusa" matching "rescue survivors raft medusa")
const shorter = a.length <= b.length ? a : b;
const longer = a.length <= b.length ? b : a;
if (longer.includes(shorter) && shorter.length / longer.length >= 0.7) return true;
return false;
}

function titleTokens(s) {
return normalizeTitle(s).split(' ').filter(w => w.length >= 3);
}

function titleOverlaps(query, candidate) {
const qTokens = new Set(titleTokens(query));
const cTokens = new Set(titleTokens(candidate));
if (!qTokens.size || !cTokens.size) return false;
let shared = 0;
for (const t of qTokens) if (cTokens.has(t)) shared++;
// Require meaningful shared vocabulary, not just one common short/generic word — this is what
// catches a hallucinated title matching an unrelated search result (no real title exists to
// compare against, so a genuine title has essentially nothing in common with it).
return shared / Math.min(qTokens.size, cTokens.size) >= 0.4;
}

function cleanCommonsTitle(t) {
return (t || '').replace(/^File:/i, '').replace(/\.(jpe?g|png|tiff?|gif)$/i, '');
}

async function logEvent(event) {
try {
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return;
await fetch(process.env.SUPABASE_URL + '/rest/v1/thread_events', {
method: 'POST',
headers: {
'Content-Type': 'application/json',
'apikey': process.env.SUPABASE_SERVICE_KEY,
'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_KEY,
'Prefer': 'return=minimal'
},
body: JSON.stringify(event)
});
} catch (e) { /* logging must never break the product */ }
}

function titleVariants(title) {
if (!title) return [title];
const variants = [title];
const parenMatch = title.match(/\(([^)]+)\)/);
const stripped = title.replace(/\([^)]*\)/g, '').trim();
if (stripped && stripped !== title && stripped.length > 3) variants.push(stripped);
if (parenMatch) {
const inside = parenMatch[1].trim();
if (inside && inside !== title && inside.length > 3) variants.push(inside);
}
return variants.slice(0, 3);
}

function isArtworkPage(categories) {
if (!categories) return false;
return categories.some(cat => /\b(paintings?|artworks?|drawings?|prints?|sculptures?|lithographs?|watercolou?rs?|engravings?|etchings?|tapestries)\b/i.test(cat.title || ''));
}

async function tryWikipediaSearch(queryText, artistLast, titleForCompare) {
try {
const q = encodeURIComponent(queryText);
const res = await fetch('https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=' + q + '&gsrlimit=3&prop=pageimages|extracts|categories&piprop=thumbnail&pithumbsize=400&exintro=1&explaintext=1&exchars=500&cllimit=50&clshow=!hidden&format=json&origin=*');
const data = await res.json();
const pages = data && data.query && data.query.pages;
if (!pages) return null;
for (const page of Object.values(pages)) {
if (!page || !page.thumbnail) continue;
const extract = (page.extract || '').toLowerCase();
const pageTitle = (page.title || '').toLowerCase();
if (!artistLast || extract.includes(artistLast) || pageTitle.includes(artistLast)) {
if (titleForCompare && !titleOverlaps(titleForCompare, page.title)) continue;
// A page can pass both the artist-mention and title-overlap checks by coincidence when
// the title is also a real place, person, or event name (e.g. Winslow Homer's painting
// "Long Branch, New Jersey" vs. the actual town's Wikipedia article, which may mention
// Homer in passing). Require the page to actually be categorized as an artwork.
if (!isArtworkPage(page.categories)) continue;
return page.thumbnail.source;
}
}
return null;
} catch(e) { return null; }
}

function extractMuseumFromCategories(categories) {
if (!categories) return null;
for (const cat of categories) {
const name = (cat.title || '').replace(/^Category:/, '');
// Commons category convention: "Paintings by X in the Y Museum, City" / "... at the Y Gallery".
const m = name.match(/\b(?:in|at) the (.+)$/i);
if (m && /(museum|gallery|galleries|institute|gallerie|kunsthistorisches|pinacoteca|uffizi|hermitage|rijksmuseum|prado|louvre|\bmet\b)/i.test(m[1])) {
return m[1].trim();
}
}
return null;
}

async function tryCommonsSearch(queryText, artistLast, titleForCompare) {
try {
const q = encodeURIComponent(queryText);
const res = await fetch('https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=' + q + '&gsrlimit=3&prop=imageinfo|categories&iiprop=extmetadata|url&iiurlwidth=500&cllimit=50&clshow=!hidden&format=json&origin=*');
const data = await res.json();
const pages = data && data.query && data.query.pages;
if (!pages) return null;
for (const page of Object.values(pages)) {
const info = page.imageinfo && page.imageinfo[0];
if (!info) continue;
const meta = info.extmetadata || {};
const artistField = ((meta.Artist && meta.Artist.value) || '').toLowerCase();
const descField = ((meta.ImageDescription && meta.ImageDescription.value) || '').toLowerCase();
const pageTitle = (page.title || '').toLowerCase();
if (!artistLast || artistField.includes(artistLast) || descField.includes(artistLast) || pageTitle.includes(artistLast)) {
if (titleForCompare && !titleOverlaps(titleForCompare, cleanCommonsTitle(page.title) + ' ' + descField)) continue;
return {
primaryImage: info.thumburl || info.url,
museum: extractMuseumFromCategories(page.categories)
};
}
}
return null;
} catch(e) { return null; }
}

async function fetchWikimediaImage(title, artist) {
const artistLast = artist ? artist.trim().split(/\s+/).pop().toLowerCase() : '';
for (const t of titleVariants(title)) {
const queryText = t + ' ' + (artist || '');
const wikiHit = await tryWikipediaSearch(queryText, artistLast, t);
if (wikiHit) return { primaryImage: wikiHit, museum: null };
const commonsHit = await tryCommonsSearch(queryText, artistLast, t);
if (commonsHit) return commonsHit;
}
return null;
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
if (!titleMatches(title, obj.title)) return null;
return { metId: obj.objectID, primaryImage: image, museum: obj.repository || 'Metropolitan Museum of Art, New York' };
} catch(e) { return null; }
}

async function fetchAICData(title, artist) {
try {
const q = encodeURIComponent(title + ' ' + artist);
const res = await fetch('https://api.artic.edu/api/v1/artworks/search?q=' + q + '&limit=3&fields=id,title,image_id');
const data = await res.json();
const works = data && data.data;
if (!works || !works.length) return null;
const work = works.find(w => w.image_id && titleMatches(title, w.title));
if (!work) return null;
return { primaryImage: 'https://www.artic.edu/iiif/2/' + work.image_id + '/full/800,/0/default.jpg', museum: 'Art Institute of Chicago' };
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
if (!titleMatches(title, work.title)) return null;
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
const candTitle = record._primaryTitle || (record.titles && record.titles[0] && record.titles[0].title) || '';
if (!titleMatches(title, candTitle)) return null;
return { primaryImage: 'https://framemark.vam.ac.uk/collections/' + imageId + '/full/800,/0/default.jpg', museum: 'Victoria and Albert Museum, London' };
} catch(e) { return null; }
}

async function fetchClevelandData(title, artist) {
try {
const q = encodeURIComponent(title + ' ' + artist);
const res = await fetch('https://openaccess-api.clevelandart.org/api/artworks/?q=' + q + '&has_image=1&limit=3');
const data = await res.json();
const works = data && data.data;
if (!works || !works.length) return null;
const work = works.find(w => titleMatches(title, w.title) && w.images && (w.images.web || w.images.print));
if (!work) return null;
const image = work.images.web || work.images.print;
return { primaryImage: image.url, museum: 'Cleveland Museum of Art' };
} catch(e) { return null; }
}

async function fetchSmithsonianData(title, artist) {
try {
const key = process.env.SMITHSONIAN_API_KEY;
if (!key) return null;
const q = encodeURIComponent(title + ' ' + artist);
const res = await fetch('https://api.si.edu/openaccess/api/v1.0/search?q=' + q + '&api_key=' + key + '&rows=3&media.type=Images');
const data = await res.json();
const rows = data && data.response && data.response.rows;
if (!rows || !rows.length) return null;
const row = rows.find(r => titleMatches(title, r.title));
if (!row) return null;
const media = row.content && row.content.descriptiveNonRepeating && row.content.descriptiveNonRepeating.online_media && row.content.descriptiveNonRepeating.online_media.media;
if (!media || !media[0]) return null;
const imageUrl = media[0].content || media[0].thumbnail;
if (!imageUrl) return null;
const museumName = row.content && row.content.descriptiveNonRepeating && row.content.descriptiveNonRepeating.data_source || 'Smithsonian Institution';
return { primaryImage: imageUrl, museum: museumName };
} catch(e) { return null; }
}

async function fetchNGAData(title, artist) {
try {
const res = await fetch('https://api.nga.gov/art/tms/objects?title=' + encodeURIComponent(title) + '&artist=' + encodeURIComponent(artist) + '&hasimage=1&limit=3&offset=0');
const data = await res.json();
const works = data && data.data;
if (!works || !works.length) return null;
const work = works.find(w => w.primaryimage && titleMatches(title, w.title));
if (!work) return null;
const imageUrl = 'https://api.nga.gov/iiif/' + work.primaryimage + '/full/!800,800/0/default.jpg';
return { primaryImage: imageUrl, museum: 'National Gallery of Art, Washington DC' };
} catch(e) { return null; }
}

async function fetchEuropeanaData(title, artist) {
try {
const key = process.env.EUROPEANA_API_KEY;
if (!key) return null;
const q = encodeURIComponent('"' + title + '" "' + artist + '"');
const res = await fetch('https://api.europeana.eu/record/v2/search.json?wskey=' + key + '&query=' + q + '&qf=TYPE%3AIMAGE&rows=5&profile=rich');
const data = await res.json();
const items = data && data.items;
if (!items || !items.length) return null;
const item = items.find(it => {
const t = (it.title && it.title[0]) || (it.dcTitleLangAware && Object.values(it.dcTitleLangAware)[0] && Object.values(it.dcTitleLangAware)[0][0]) || '';
return (it.edmIsShownBy && it.edmIsShownBy[0] || it.edmPreview && it.edmPreview[0]) && titleMatches(title, t);
});
if (!item) return null;
const imageUrl = (item.edmIsShownBy && item.edmIsShownBy[0]) || item.edmPreview[0];
const museum = item.dataProvider && item.dataProvider[0] || 'Europeana';
return { primaryImage: imageUrl, museum: museum };
} catch(e) { return null; }
}

async function fetchMiaData(title, artist) {
try {
const q = encodeURIComponent(title + ' ' + artist);
const res = await fetch('https://search.artsmia.org/?' + q + '&size=3');
const data = await res.json();
const hits = data && data.hits && data.hits.hits;
if (!hits || !hits.length) return null;
const hit = hits.find(h => h._source && h._source.image && titleMatches(title, h._source.title));
if (!hit) return null;
const id = hit._source.id;
const imageUrl = 'https://cdn.dx.artsmia.org/thumbs/iiif/' + id + '/full/800,/0/default.jpg';
return { primaryImage: imageUrl, museum: 'Minneapolis Institute of Art' };
} catch(e) { return null; }
}

async function fetchGettyData(title, artist) {
try {
const q = encodeURIComponent(title + ' ' + artist);
const res = await fetch('https://data.getty.edu/museum/collection/search?q=' + q + '&limit=1');
const data = await res.json();
const item = data && data.items && data.items[0];
if (!item || !item.id) return null;
const objRes = await fetch(item.id);
const obj = await objRes.json();
const objTitle = obj && obj._label || (obj && obj.identified_by && obj.identified_by[0] && obj.identified_by[0].content) || '';
if (!titleMatches(title, objTitle)) return null;
const imageId = obj && obj.subject_of && obj.subject_of[0] && obj.subject_of[0].digitally_shown_by && obj.subject_of[0].digitally_shown_by[0] && obj.subject_of[0].digitally_shown_by[0].access_point && obj.subject_of[0].digitally_shown_by[0].access_point[0] && obj.subject_of[0].digitally_shown_by[0].access_point[0].id;
if (!imageId) return null;
return { primaryImage: imageId, museum: 'J. Paul Getty Museum, Los Angeles' };
} catch(e) { return null; }
}

async function fetchTateData(title, artist) {
try {
const q = encodeURIComponent(title + ' ' + artist);
const res = await fetch('https://www.tate.org.uk/api/v1/artworks?query=' + q + '&size=3');
const data = await res.json();
const works = data && data.results;
if (!works || !works.length) return null;
const work = works.find(w => titleMatches(title, w.title));
if (!work) return null;
const imageUrl = work.thumbnailUrl || (work.acno ? 'https://www.tate.org.uk/art/images/' + work.acno.substring(0,2) + '/' + work.acno + '_10.jpg' : null);
if (!imageUrl) return null;
return { primaryImage: imageUrl, museum: 'Tate, London' };
} catch(e) { return null; }
}

const MEDIUM_CATEGORIES = {
painting: ['oil', 'painting', 'tempera', 'fresco', 'panel', 'canvas', 'acrylic', 'gouache'],
print: ['lithograph', 'engraving', 'etching', 'woodcut', 'linocut', 'print', 'intaglio', 'screenprint', 'aquatint'],
drawing: ['drawing', 'watercolor', 'watercolour', 'pastel', 'charcoal', 'pencil', 'chalk'],
sculpture: ['sculpture', 'bronze', 'marble', 'terracotta', 'carving', 'statue'],
photograph: ['photograph', 'photography', 'daguerreotype'],
textile: ['tapestry', 'textile', 'embroidery'],
ceramic: ['ceramic', 'porcelain', 'pottery']
};

function mediumCategory(text) {
if (!text) return null;
const lower = text.toLowerCase();
for (const cat in MEDIUM_CATEGORIES) {
if (MEDIUM_CATEGORIES[cat].some(kw => lower.includes(kw))) return cat;
}
return null;
}

async function fetchWikidataImage(title, artist, medium) {
try {
const artistLast = artist ? artist.trim().split(/\s+/).pop().toLowerCase() : '';
const expectedCategory = mediumCategory(medium);

// Wikidata labels/aliases exist per-language, so a title search only in English can miss a
// work whose canonical Wikidata label is French, German, Dutch, etc. Try a few major languages
// in turn and stop at the first one that returns candidates.
const languages = ['en', 'fr', 'de', 'nl', 'it', 'es'];
let candidates = [];
for (const lang of languages) {
const searchQ = encodeURIComponent(title);
const searchRes = await fetch('https://www.wikidata.org/w/api.php?action=wbsearchentities&search=' + searchQ + '&language=' + lang + '&type=item&limit=5&format=json&origin=*');
const searchData = await searchRes.json();
candidates = (searchData && searchData.search) || [];
if (candidates.length) break;
}
if (!candidates.length) return null;

// wbsearchentities candidates already carry a .label — use it to reject entities whose own
// title doesn't actually resemble what was queried, without any extra API call. This is what
// catches a hallucinated title landing on an unrelated same-artist entity.
const candidateLabels = {};
for (const c of candidates) candidateLabels[c.id] = c.label || (c.match && c.match.text) || '';

const ids = candidates.map(c => c.id).join('|');
const entRes = await fetch('https://www.wikidata.org/w/api.php?action=wbgetentities&ids=' + ids + '&props=claims&languages=en&format=json&origin=*');
const entData = await entRes.json();
const entities = (entData && entData.entities) || {};

// Batch-resolve every referenced creator (P170), collection (P195), instance-of (P31), and
// material-used (P186) QID into an English label in one extra call — needed to verify the
// artist, read the museum name, and (critically) tell apart two works that share a title and
// artist but are different objects in different media (e.g. Manet's oil vs. lithograph of the
// same "Execution of Emperor Maximilian" subject).
const refIds = new Set();
const claimIds = (claim) => (claim || []).map(c => c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value && c.mainsnak.datavalue.value.id).filter(Boolean);
for (const ent of Object.values(entities)) {
const claims = ent.claims || {};
[...claimIds(claims.P170), ...claimIds(claims.P195), ...claimIds(claims.P31), ...claimIds(claims.P186)].forEach(id => refIds.add(id));
}
let refLabels = {};
if (refIds.size) {
const refRes = await fetch('https://www.wikidata.org/w/api.php?action=wbgetentities&ids=' + Array.from(refIds).join('|') + '&props=labels&languages=en&format=json&origin=*');
const refData = await refRes.json();
const refEntities = (refData && refData.entities) || {};
for (const qid in refEntities) {
const ent = refEntities[qid];
refLabels[qid] = ent.labels && ent.labels.en && ent.labels.en.value;
}
}

for (const ent of Object.values(entities)) {
const claims = ent.claims || {};
const creatorClaim = claims.P170 && claims.P170[0] && claims.P170[0].mainsnak && claims.P170[0].mainsnak.datavalue;
const creatorId = creatorClaim && creatorClaim.value && creatorClaim.value.id;
const creatorLabel = creatorId ? (refLabels[creatorId] || '') : '';
// Reject candidates that are a different, named artist's work of the same title.
if (artistLast && creatorLabel && !creatorLabel.toLowerCase().includes(artistLast)) continue;

// Reject candidates whose own Wikidata label doesn't actually resemble the queried title.
if (!titleOverlaps(title, candidateLabels[ent.id])) continue;

// Reject candidates whose medium category conflicts with the one read off the wall label.
// Only rejects on an actual conflict (both sides classified but different) — sparse Wikidata
// metadata never causes a false rejection, it just means no extra disambiguation happened.
if (expectedCategory) {
const claimIdsFor = (key) => claimIds(claims[key]).map(id => refLabels[id]).filter(Boolean).join(' ');
const candidateMediumText = claimIdsFor('P31') + ' ' + claimIdsFor('P186');
const candidateCategory = mediumCategory(candidateMediumText);
if (candidateCategory && candidateCategory !== expectedCategory) continue;
}

const imageClaim = claims.P18 && claims.P18[0] && claims.P18[0].mainsnak && claims.P18[0].mainsnak.datavalue;
const filename = imageClaim && imageClaim.value;
if (!filename) continue;

const collectionClaim = claims.P195 && claims.P195[0] && claims.P195[0].mainsnak && claims.P195[0].mainsnak.datavalue;
const collectionId = collectionClaim && collectionClaim.value && collectionClaim.value.id;
const museum = collectionId ? (refLabels[collectionId] || null) : null;

const imageUrl = 'https://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(filename.replace(/ /g, '_')) + '?width=500';
return { primaryImage: imageUrl, museum: museum, qid: ent.id };
}
return null;
} catch(e) { return null; }
}

async function fetchArtworkImage(title, artist, medium) {
if (!title || title === 'Unknown work') return null;
const results = await Promise.allSettled([
fetchAICData(title, artist),
fetchRijksData(title, artist),
fetchVAData(title, artist),
fetchClevelandData(title, artist),
fetchSmithsonianData(title, artist),
fetchNGAData(title, artist),
fetchEuropeanaData(title, artist),
fetchMiaData(title, artist),
fetchGettyData(title, artist),
fetchTateData(title, artist),
fetchMetData(title, artist)
]);
for (const r of results) {
if (r.status === 'fulfilled' && r.value && r.value.primaryImage) return r.value;
}
// Wikidata is structured-entity matching (creator/collection are linked data, not text guesses,
// and the image comes straight from P18) so it's tried before the fuzzier Wikipedia/Commons
// title-string search below.
const wikidata = await fetchWikidataImage(title, artist, medium);
if (wikidata && wikidata.primaryImage) return wikidata;
const wiki = await fetchWikimediaImage(title, artist);
if (wiki && wiki.primaryImage) return wiki;
return null;
}

async function catalogueQuery(params) {
try {
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return [];
const res = await fetch(process.env.SUPABASE_URL + '/rest/v1/artworks?' + params, {
headers: {
'apikey': process.env.SUPABASE_SERVICE_KEY,
'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_KEY
}
});
if (!res.ok) return [];
return await res.json();
} catch (e) { return []; }
}

// Catalogue sift #1: does this anchor already exist in our own catalogue (manual adds or past finds)?
// If so, its image/tags/notes take priority over a fresh museum-API lookup.
async function fetchCatalogueMatch(title, artist) {
if (!title) return null;
const rows = await catalogueQuery(
'title=ilike.*' + encodeURIComponent(title) + '*&select=*&limit=1'
);
return rows && rows[0] ? rows[0] : null;
}

// Catalogue sift #2: broaden beyond what the LLM proposed. Pull catalogued works that share an
// artist with the anchor or any LLM connection, or share a tag with the anchor's catalogue match —
// surfaces things you've manually added or found before that the LLM wouldn't think to suggest.
async function fetchCatalogueBroaden(artistNames, tags, excludeTitles) {
const seen = new Set();
const out = [];
const clauses = [];
for (const a of (artistNames || []).filter(Boolean)) {
clauses.push('artist.ilike.*' + encodeURIComponent(a) + '*');
}
for (const t of (tags || []).filter(Boolean)) {
clauses.push('tags.cs.{' + encodeURIComponent(t) + '}');
}
if (!clauses.length) return out;
const rows = await catalogueQuery('or=(' + clauses.join(',') + ')&select=*&limit=6');
const excludeLower = new Set((excludeTitles || []).map(t => (t || '').toLowerCase()));
for (const row of rows) {
const key = (row.title || '').toLowerCase();
if (!key || excludeLower.has(key) || seen.has(key)) continue;
seen.add(key);
out.push(row);
if (out.length >= 2) break;
}
return out;
}

const ALBERTINA = ''

module.exports = async function handler(req, res) {
res.setHeader('Access-Control-Allow-Origin', '*');
res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
if (req.method === 'OPTIONS') return res.status(200).end();
if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

const { query, imageBase64, imageType, anonId, depth, edgeType, lat, lng } = req.body;
const userContent = [];
if (imageBase64) {
userContent.push({ type: 'image', source: { type: 'base64', media_type: imageType || 'image/jpeg', data: imageBase64 }});
}
const geoHint = (typeof lat === 'number' && typeof lng === 'number')
? ' The visitor\'s approximate location is latitude ' + lat.toFixed(3) + ', longitude ' + lng.toFixed(3) + '. Some artists painted multiple original versions of the same title at different museums (e.g. Panini\'s "Modern Rome" exists at the Louvre, the Met, and the MFA Boston) — when that\'s the case, use this location to identify which museum\'s version this actually is, rather than defaulting to the most famous one.'
: '';
userContent.push({ type: 'text', text: imageBase64
? 'Identify this artwork then find 3 connected works. Ignore glass reflections and people in foreground. If you cannot confidently identify the work set title to Unknown work. ' + geoHint + ' ' + (query || '')
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
system: 'You are ArtThread. Only use REAL verifiable artworks. Ignore reflections and people in photos. If a wall label or caption is visible in the photo, read the medium directly off it (e.g. "Oil on canvas", "Lithograph", "Marble") — this matters because some artists made multiple works with the same title in different media (e.g. Manet\'s several versions of "The Execution of Emperor Maximilian" — an oil painting and a lithograph are different objects). If you cannot confidently identify a work set title to Unknown work and artist to Unknown artist. Respond with ONLY valid JSON nothing else:\n{"anchor":{"title":"title","artist":"artist","date":"date","museum":"museum","medium":"medium or empty string if unknown","metId":null},"connections":[{"title":"title","artist":"artist","date":"date","museum":"museum","medium":"medium or empty string if unknown","thread":"light","throughline":"one sentence"},{"title":"title","artist":"artist","date":"date","museum":"museum","medium":"medium or empty string if unknown","thread":"power","throughline":"one sentence"},{"title":"title","artist":"artist","date":"date","museum":"museum","medium":"medium or empty string if unknown","thread":"time","throughline":"one sentence"}]}\n\n' + ALBERTINA,
messages: [{ role: 'user', content: userContent }]
})
});

const data = await response.json();
if (!data.content || !data.content[0]) return res.status(500).json({ error: 'No API response: ' + JSON.stringify(data) });

const text = data.content[0].text;
const jsonMatch = text.match(/\{[\s\S]*\}/);
if (!jsonMatch) return res.status(500).json({ error: 'No JSON found: ' + text.substring(0, 200) });

const result = JSON.parse(jsonMatch[0]);

// Sift #1: check our own catalogue for this anchor before falling back to live museum APIs.
const catalogueMatch = await fetchCatalogueMatch(result.anchor.title, result.anchor.artist);
if (catalogueMatch) {
if (catalogueMatch.primary_image) result.anchor.primaryImage = catalogueMatch.primary_image;
if (catalogueMatch.museum) result.anchor.museum = catalogueMatch.museum;
if (catalogueMatch.notes) result.anchor.catalogueNotes = catalogueMatch.notes;
}

const isMetWork = result.anchor.museum && result.anchor.museum.toLowerCase().includes('metropolitan');
if (isMetWork) {
const anchorMet = await fetchMetData(result.anchor.title, result.anchor.artist);
if (anchorMet) {
result.anchor.metId = anchorMet.metId;
result.anchor.primaryImage = result.anchor.primaryImage || anchorMet.primaryImage;
}
}
if (!result.anchor.primaryImage) {
const anchorImg = await fetchArtworkImage(result.anchor.title, result.anchor.artist, result.anchor.medium);
if (anchorImg && anchorImg.primaryImage) result.anchor.primaryImage = anchorImg.primaryImage;
// A museum API match is authoritative on location — correct the LLM's free-text guess.
// (Wiki/Commons fallback returns museum: null, so this never overwrites with another guess.)
if (anchorImg && anchorImg.museum) result.anchor.museum = anchorImg.museum;
}

if (result.connections && result.connections.length) {
await Promise.all(result.connections.map(async (conn) => {
const connCatalogueMatch = await fetchCatalogueMatch(conn.title, conn.artist);
if (connCatalogueMatch && connCatalogueMatch.primary_image) {
conn.primaryImage = connCatalogueMatch.primary_image;
}
const img = await fetchArtworkImage(conn.title, conn.artist, conn.medium);
if (img && img.primaryImage) {
conn.primaryImage = conn.primaryImage || img.primaryImage;
if (img.metId) conn.metId = img.metId;
if (img.museum) conn.museum = img.museum;
}
}));
}

// Sift #2: broaden beyond the LLM's 3 picks with anything catalogued (manual adds, past finds)
// that shares an artist or theme tag — so works outside the LLM's general knowledge can surface.
const knownArtists = [result.anchor.artist, ...(result.connections || []).map(c => c.artist)];
const knownTitles = [result.anchor.title, ...(result.connections || []).map(c => c.title)];
const broadened = await fetchCatalogueBroaden(
knownArtists,
catalogueMatch && catalogueMatch.tags,
knownTitles
);
const KNOWN_THREADS = ['light','grief','power','nature','chaos','time','identity'];
for (const row of broadened) {
const rowTag = (row.tags || []).find(t => KNOWN_THREADS.includes(t));
result.connections.push({
title: row.title,
artist: row.artist,
date: row.date_display,
museum: row.museum,
thread: rowTag || 'time',
throughline: row.notes || 'From your own catalogue.',
primaryImage: row.primary_image
});
}

await logEvent({
anon_id: anonId || null,
event_type: imageBase64 ? 'image_upload' : ((depth || 0) > 0 ? 'connection_followed' : 'text_search'),
edge_type: edgeType || null,
query: query || (result.anchor && result.anchor.title) || null,
depth: depth || 0,
payload: {
anchor_title: result.anchor && result.anchor.title,
anchor_artist: result.anchor && result.anchor.artist,
threads: (result.connections || []).map(c => c.thread)
}
});

return res.status(200).json(result);
} catch (err) {
return res.status(500).json({ error: err.message });
}
}