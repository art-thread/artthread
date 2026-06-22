function slugify(s) {
return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

module.exports = async function handler(req, res) {
res.setHeader('Access-Control-Allow-Origin', '*');
res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
if (req.method === 'OPTIONS') return res.status(200).end();
if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

if (process.env.ADMIN_SECRET && req.body.secret !== process.env.ADMIN_SECRET) {
return res.status(401).json({ error: 'Unauthorized' });
}

const { title, artist, date, museum, primaryImage, tags, notes } = req.body;
if (!title) return res.status(400).json({ error: 'title is required' });

const tagArray = Array.isArray(tags) ? tags : (tags ? String(tags).split(',').map(t => t.trim()).filter(Boolean) : []);
const sourceId = slugify(title + '-' + (artist || ''));

try {
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
return res.status(500).json({ error: 'Supabase not configured' });
}
const upstream = await fetch(process.env.SUPABASE_URL + '/rest/v1/artworks?on_conflict=source,source_id', {
method: 'POST',
headers: {
'Content-Type': 'application/json',
'apikey': process.env.SUPABASE_SERVICE_KEY,
'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_KEY,
'Prefer': 'resolution=merge-duplicates,return=representation'
},
body: JSON.stringify({
source: 'manual',
source_id: sourceId,
title,
artist: artist || null,
date_display: date || null,
museum: museum || null,
primary_image: primaryImage || null,
tags: tagArray,
notes: notes || null
})
});
const data = await upstream.json();
if (!upstream.ok) return res.status(500).json({ error: data });
return res.status(200).json({ ok: true, artwork: data[0] || data });
} catch (err) {
return res.status(500).json({ error: err.message });
}
};
