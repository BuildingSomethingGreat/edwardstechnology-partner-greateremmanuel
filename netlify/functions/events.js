// Netlify serverless function: returns calendar events for the home page.
// GET /api/events -> { ok: true, events: [...] }
//
// Source of truth is the church's existing Clover calendar (the same feed that
// powers greaterefwc.com/events). Clover does not send CORS headers, so the
// browser cannot read it directly; this function fetches it server-side and
// trims each event down to the fields the calendar needs.
//
// The feed already expands recurring events (Sunday worship, Tuesday Bible
// study, DEVELOP classes) into individual dated entries.

const {
  CLOVER_CALENDAR_URL = 'https://almanac.cloversites.com/v1/calendars/greateremmanuelfamilyworshipcenter',
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

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

// Event name -> the kind key the calendar uses for coloring.
const kindOf = (name) => {
  const n = (name || '').toLowerCase();
  if (n.includes('worship')) return 'worship';
  if (/(study|develop|education|class)/.test(n)) return 'study';
  return 'special';
};

// Clover timestamps are local church time with no offset, e.g.
// "2026-11-15T10:00:00". Read the parts directly so no timezone math is needed.
const parseLocal = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s || '');
  return m ? { date: `${m[1]}-${m[2]}-${m[3]}`, h: +m[4], min: +m[5] } : null;
};
const clock = (t) => `${((t.h + 11) % 12) + 1}:${pad(t.min)} ${t.h < 12 ? 'AM' : 'PM'}`;

// First line of the description, kept short enough for the event card.
const blurb = (text) => {
  const line = String(text || '').replace(/<[^>]+>/g, ' ').split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '';
  return line.length > 90 ? line.slice(0, 87).trimEnd() + '…' : line;
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'Method not allowed' });

  try {
    // Window: start of last month through twelve months ahead.
    const now = new Date();
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 13, 0));

    const url = new URL(`${CLOVER_CALENDAR_URL}/events`);
    url.searchParams.set('filter[start_date]', ymd(from));
    url.searchParams.set('filter[end_date]', ymd(to));

    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      console.error('Clover calendar error:', res.status, (await res.text()).slice(0, 300));
      return json(502, { ok: false, error: 'Could not load events.' });
    }
    const data = await res.json();
    const rows = Array.isArray(data) ? data : [];

    const out = [];
    for (const ev of rows) {
      if (!ev || ev.canceled_at || (ev.status && ev.status !== 'active')) continue;
      const start = parseLocal(ev.starting_at);
      const title = (ev.name || '').trim();
      if (!start || !title) continue;
      const end = parseLocal(ev.ending_at);

      let time = 'All Day';
      if (!ev.all_day) {
        time = clock(start);
        if (end && end.date === start.date && (end.h !== start.h || end.min !== start.min)) {
          time += ' – ' + clock(end);
        }
      }

      // Only keep links the church set by hand (e.g. Facebook Live). The
      // auto-generated Clover detail pages stop working once the old site is retired.
      const link = /^https?:\/\//i.test(ev.custom_url || '') ? ev.custom_url : '';

      out.push({ date: start.date, time, title, min: blurb(ev.description), kind: kindOf(title), link, sort: ev.starting_at });
    }
    out.sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0));
    for (const e of out) delete e.sort;

    return json(200, { ok: true, events: out }, {
      // Browsers re-check every 5 minutes; Netlify's CDN keeps a copy for 15
      // and keeps serving the last good copy while it refreshes.
      'Cache-Control': 'public, max-age=300',
      'Netlify-CDN-Cache-Control': 'public, s-maxage=900, stale-while-revalidate=86400',
    });
  } catch (err) {
    console.error('events function failed:', err);
    return json(502, { ok: false, error: 'Could not load events.' });
  }
};
