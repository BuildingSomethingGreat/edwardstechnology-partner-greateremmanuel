// Netlify serverless function: receives the Gathered contact/subscribe form,
// writes a record to Airtable, emails a styled confirmation to the subscriber,
// and emails a transactional notification to the church.
//
// Zero npm dependencies — uses the global fetch built into Netlify's Node 18+.
// Secrets come from environment variables (see .env / Netlify env settings).

const {
  AIRTABLE_TOKEN,
  AIRTABLE_BASE_ID,
  AIRTABLE_TABLE_NAME = 'Subscribers',
  RESEND_API_KEY,
  MAIL_FROM = 'Greater Emmanuel <hello@greateremmanuel.org>',
  OWNER_EMAIL,
  ALLOWED_ORIGIN = '*',
} = process.env;

const CORS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', ...CORS },
  body: JSON.stringify(body),
});

const esc = (s = '') =>
  String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

const isEmail = (s = '') => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { ok: false, error: 'Invalid JSON' });
  }

  // Honeypot — bots fill hidden fields. Pretend success, do nothing.
  if (data.company) return json(200, { ok: true });

  const firstName = (data.firstName || '').trim();
  const lastName = (data.lastName || '').trim();
  const email = (data.email || '').trim();
  const reason = (data.reason || 'General question').trim();
  const message = (data.message || '').trim();

  if (!firstName) return json(400, { ok: false, error: 'Please enter your first name.' });
  if (!isEmail(email)) return json(400, { ok: false, error: 'Please enter a valid email address.' });

  const fullName = [firstName, lastName].filter(Boolean).join(' ');

  // ---- 1. Write to Airtable ----
  try {
    const res = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${AIRTABLE_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          typecast: true,
          records: [
            {
              fields: {
                'First Name': firstName,
                'Last Name': lastName,
                Email: email,
                Reason: reason,
                Message: message,
                Source: 'Gathered — website',
              },
            },
          ],
        }),
      }
    );
    if (!res.ok) {
      const detail = await res.text();
      console.error('Airtable error:', res.status, detail);
      return json(502, { ok: false, error: 'Could not save your details. Please try again.' });
    }
  } catch (err) {
    console.error('Airtable request failed:', err);
    return json(502, { ok: false, error: 'Could not save your details. Please try again.' });
  }

  // ---- 2. Emails (best-effort — a save already succeeded) ----
  try {
    await Promise.all([
      sendEmail({
        to: email,
        subject: 'Welcome to Greater Emmanuel ✦',
        html: confirmationHtml({ firstName }),
      }),
      OWNER_EMAIL &&
        sendEmail({
          to: OWNER_EMAIL,
          reply_to: email,
          subject: `New message — ${fullName} (${reason})`,
          html: ownerHtml({ fullName, email, reason, message }),
        }),
    ]);
  } catch (err) {
    console.error('Email send failed (record was still saved):', err);
    // Don't fail the request — the submission is safely in Airtable.
  }

  return json(200, { ok: true });
};

async function sendEmail({ to, subject, html, reply_to }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: MAIL_FROM, to, subject, html, ...(reply_to ? { reply_to } : {}) }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

// Stylized, email-client-safe confirmation (inline styles, table layout).
function confirmationHtml({ firstName }) {
  return `<!doctype html><html><body style="margin:0;background:#ECE3D0;font-family:Georgia,'Times New Roman',serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ECE3D0;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:#ECE3D0;border:2px solid #1A1613">
        <tr><td style="background:#1A1613;padding:20px 28px">
          <div style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#E0531E">Greater Emmanuel</div>
          <div style="font-family:Arial,sans-serif;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#ECE3D0;margin-top:4px">Family Worship Center</div>
        </td></tr>
        <tr><td style="padding:36px 28px 8px">
          <h1 style="margin:0 0 6px;font-family:Arial,sans-serif;font-weight:800;font-size:34px;line-height:1;text-transform:uppercase;color:#1A1613">You're<br>Connected.</h1>
        </td></tr>
        <tr><td style="padding:8px 28px 24px;color:#3A332B;font-size:16px;line-height:1.6">
          <p style="margin:0 0 16px">Hi ${esc(firstName)},</p>
          <p style="margin:0 0 16px">Thank you for reaching out to Greater Emmanuel. We've received your note and a member of our team will get back to you <strong>within 48 hours</strong>.</p>
          <p style="margin:0 0 16px">In the meantime, you're always welcome to gather with us:</p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 8px">
            <tr><td style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#7A6F5E;padding:2px 16px 2px 0">Sundays</td><td style="font-size:15px;color:#1A1613">10:00 AM Worship</td></tr>
            <tr><td style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#7A6F5E;padding:2px 16px 2px 0">Wednesdays</td><td style="font-size:15px;color:#1A1613">7:00 PM Bible Study</td></tr>
            <tr><td style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#7A6F5E;padding:2px 16px 2px 0">Location</td><td style="font-size:15px;color:#1A1613">3915 Kelley Street, Houston, TX 77026</td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:0 28px 36px">
          <a href="https://pushpay.com/g/greaterefwc" style="display:inline-block;background:#E0531E;color:#ECE3D0;font-family:Arial,sans-serif;font-weight:800;font-size:14px;letter-spacing:1px;text-transform:uppercase;text-decoration:none;padding:14px 26px;border:2px solid #1A1613">Give Online &rarr;</a>
        </td></tr>
        <tr><td style="background:#1A1613;padding:18px 28px;font-family:Arial,sans-serif;font-size:11px;line-height:1.7;color:#ECE3D0">
          Bishop Titus &amp; Lady Tammy Stewart, Senior Pastors<br>(713) 671-9994 &middot; info@greateremmanuel.org
        </td></tr>
      </table>
      <div style="font-family:Arial,sans-serif;font-size:10px;color:#7A6F5E;margin-top:14px">You received this because you contacted Greater Emmanuel via our website.</div>
    </td></tr>
  </table></body></html>`;
}

// Plain internal notification for the church.
function ownerHtml({ fullName, email, reason, message }) {
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#1A1613;font-size:15px;line-height:1.6">
  <h2 style="margin:0 0 12px">New website message</h2>
  <table cellpadding="0" cellspacing="0">
    <tr><td style="color:#7A6F5E;padding:2px 16px 2px 0">Name</td><td><strong>${esc(fullName)}</strong></td></tr>
    <tr><td style="color:#7A6F5E;padding:2px 16px 2px 0">Email</td><td><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>
    <tr><td style="color:#7A6F5E;padding:2px 16px 2px 0">Reason</td><td>${esc(reason)}</td></tr>
  </table>
  <p style="margin:16px 0 6px;color:#7A6F5E">Message</p>
  <div style="border-left:3px solid #E0531E;padding:4px 0 4px 14px;white-space:pre-wrap">${esc(message) || '<em>(no message)</em>'}</div>
  <p style="margin-top:20px;color:#7A6F5E;font-size:13px">Reply directly to this email to respond to ${esc(fullName)}.</p>
  </body></html>`;
}
