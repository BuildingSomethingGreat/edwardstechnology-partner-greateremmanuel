# Netlify setup — Gathered form → Airtable + email

The "Gathered" contact/subscribe form posts to a serverless function that saves
the submission to Airtable and sends two emails (a styled confirmation to the
visitor and a notification to the church).

## 1. Airtable
1. Create a base with a table named **Subscribers** (or set `AIRTABLE_TABLE_NAME`).
2. Add these fields (types in parentheses):
   - `First Name` (Single line text)
   - `Last Name` (Single line text)
   - `Email` (Email or Single line text)
   - `Reason` (Single line text or Single select)
   - `Message` (Long text)
   - `Source` (Single line text)
3. Create a Personal Access Token at https://airtable.com/create/tokens with the
   `data.records:write` scope, granted access to this base.
4. Copy the token → `AIRTABLE_TOKEN`, and the base ID (`app…`) → `AIRTABLE_BASE_ID`.

## 2. Resend (email)
1. Sign up at https://resend.com and verify your sending domain
   (e.g. `greateremmanuel.org`).
2. Create an API key → `RESEND_API_KEY`.
3. Set `MAIL_FROM` to an address on the verified domain and `OWNER_EMAIL` to
   wherever the church wants notifications.

## 3. Environment variables
Locally: copy `.env.example` to `.env` and fill it in (`.env` is gitignored).
On Netlify: **Site settings → Environment variables** — add the same keys.
Do not upload the `.env` file itself.

## 4. Run / deploy
```bash
npm install -g netlify-cli   # once
netlify dev                  # local test at http://localhost:8888
netlify deploy --prod        # or connect the GitHub repo in the Netlify UI
```

Netlify auto-detects `netlify.toml`: it serves the static `.dc.html` pages and
builds the function in `netlify/functions/`. The form calls `/api/subscribe`,
which redirects to the function.

## Notes
- The form includes a hidden honeypot field for basic spam protection. For more,
  add Cloudflare Turnstile.
- If a submission saves to Airtable but an email fails, the request still returns
  success (the lead is not lost) and the email error is logged in the function.
