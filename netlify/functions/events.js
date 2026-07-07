// Netlify serverless function: returns calendar events from Airtable for the
// Gathered theme. Keeps the Airtable token server-side (never exposed to the
// browser). GET /api/events -> { ok: true, events: [...] }
//
// Recurring Sunday worship / Wednesday Bible study are generated in the page
// itself; this endpoint only serves the one-off / special events table.

const {
  AIRTABLE_TOKEN,
  AIRTABLE_BASE_ID,
  AIRTABLE_EVENTS_TABLE = 'Events',
  ALLOWED_ORIGIN = '*',
} = process.env;

const CORS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const json = (statusCode, body, extra = {}) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', ...CORS, ...extra },
  body: JSON.stringify(body),
});

// Airtable "Type" single-select -> the kind key the calendar uses for coloring.
const kindOf = (type) => {
  const t = (type || '').toLowerCase();
  if (t.includes('worship')) return 'worship';
  if (t.includes('study')) return 'study';
  return 'special';
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'Method not allowed' });

  try {
    const out = [];
    let offset;
    // Page through all records (Airtable returns 100 at a time).
    do {
      const url = new URL(
        `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_EVENTS_TABLE)}`
      );
      url.searchParams.set('pageSize', '100');
      if (offset) url.searchParams.set('offset', offset);

      const res = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
      if (!res.ok) {
        console.error('Airtable events error:', res.status, await res.text());
        return json(502, { ok: false, error: 'Could not load events.' });
      }
      const data = await res.json();
      for (const rec of data.records || []) {
        const f = rec.fields || {};
        if (!f.Date || !f.Title) continue; // skip incomplete rows
        out.push({
          date: f.Date, // ISO "YYYY-MM-DD"
          title: f.Title,
          time: f.Time || '',
          min: f.Ministry || '',
          kind: kindOf(f.Type),
          link: f.Link || '',
        });
      }
      offset = data.offset;
    } while (offset);

    // Cache at the edge for a minute so the calendar loads fast.
    return json(200, { ok: true, events: out }, { 'Cache-Control': 'public, max-age=60' });
  } catch (err) {
    console.error('events function failed:', err);
    return json(502, { ok: false, error: 'Could not load events.' });
  }
};
