# 🔐 Oasis Pulse — QR Access Control System

Admin-controlled QR gate. Visitors **must scan a valid QR code** issued by an administrator before they can register or sign in. Anyone without a code sees an "Access by Invitation Only" wall.

---

## How It Works

```
Visitor opens the site
       ↓
  gate.html  ──── has valid QR session? ──→ register.html / login.html
       ↓ no
  validate.html  (camera auto-starts)
       ↓ scans QR code
  POST /api/qr/validate
       ↓ valid
  session_token stored in sessionStorage (15 min)
       ↓
  register.html  or  login.html
```

**Admin flow:**
- Admin signs in at `/admin-login.html` (via private link — not linked from the gate)
- Admin opens an attendance session for a venue
- Admin generates QR codes (linked to the active session)
- Admin shares the QR image or the validation URL with students
- Students scan the QR → validated → register or sign in

---

## File Structure

```
qr-access/
├── api/
│   ├── _db.js               ← Supabase client
│   ├── _auth.js             ← Admin JWT middleware
│   ├── admin/
│   │   ├── login.js         ← POST /api/admin/login
│   │   └── setup.js         ← POST /api/admin/setup  (one-time)
│   └── qr/
│       ├── create.js        ← POST /api/qr/create    (admin)
│       ├── list.js          ← GET  /api/qr/list      (admin)
│       ├── revoke.js        ← PATCH /api/qr/revoke   (admin)
│       └── validate.js      ← POST /api/qr/validate  (public)
├── public/
│   ├── js/
│   │   └── config.js        ← shared client config + session helpers
│   ├── gate.html            ← invitation-only wall
│   ├── validate.html        ← QR scanner (camera + manual)
│   ├── register.html        ← QR-gated registration
│   ├── login.html           ← QR-gated sign-in
│   ├── admin.html           ← admin dashboard
│   └── admin-login.html     ← admin sign-in
├── schema.sql               ← Supabase DB tables
├── .env.example             ← environment variable template
├── package.json
└── vercel.json              ← Vercel routing config
```

---

## Deployment (Vercel — free tier)

### Step 1 — Set up Supabase

1. Go to **https://supabase.com** → create a free project
2. Open **SQL Editor** → paste the contents of `schema.sql` → click **Run**
3. Go to **Settings → API** → copy:
   - `Project URL`
   - `service_role` key (click Reveal)

### Step 2 — Deploy to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# From the qr-access/ folder:
cd qr-access
npm install
vercel
```

When prompted, set the following **Environment Variables** in Vercel dashboard  
(*Project → Settings → Environment Variables*):

| Variable | Value |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Your service_role key |
| `JWT_SECRET` | Any long random string (32+ chars) |
| `APP_URL` | Your Vercel deployment URL, e.g. `https://yoursite.vercel.app` |
| `ADMIN_SETUP_KEY` | A secret string you choose (used once) |

### Step 3 — Create your admin account

After deploy, call this endpoint **once**:

```bash
curl -X POST https://yoursite.vercel.app/api/admin/setup \
  -H "Content-Type: application/json" \
  -d '{
    "full_name": "Your Name",
    "email": "admin@yourschool.com",
    "password": "YourSecurePassword",
    "setup_key": "the-value-you-set-in-ADMIN_SETUP_KEY"
  }'
```

Or use Postman / Insomnia. **Do this only once.**

### Step 4 — Share admin login URL privately

The admin login page is at:
```
https://yoursite.vercel.app/admin-login.html
```

**Do not link this from the public gate.** Share it only with administrators via a private channel (email, WhatsApp, etc.).

### Step 5 — Students / visitors access the gate

Your public gate URL is:
```
https://yoursite.vercel.app/gate.html
```

Or set `gate.html` as the site root with a Vercel redirect rule.

---

## Local Development

```bash
cd qr-access

# Copy env file
cp .env.example .env
# Fill in your values in .env

# Install dependencies
npm install

# Run locally with Vercel CLI (handles /api routes)
npx vercel dev
```

Then open: **http://localhost:3000/gate.html**

---

## QR Code Behaviour

| Setting | Description |
|---|---|
| `one_time_use: true` | Code is revoked after the first successful scan |
| `max_uses: N` | Code allows up to N scans before auto-revoke |
| `expires_in_hours` | Code expires after this many hours (min 1, max 8760) |
| `redirect_to` | After validation, send visitor to `register` or `login` |

Every scan attempt (valid or invalid) is recorded in `qr_access_log` with the IP address and result.

---

## Security Notes

- The `service_role` key **must never** be exposed to the browser. It is only used server-side in `/api/*.js` functions.
- QR session tokens expire in **15 minutes**. If the visitor doesn't register/login within 15 minutes after scanning, they must scan again.
- All admin routes require a JWT with `role: "qr_admin"`. The token expires in 12 hours.
- The admin login page is not linked from the public gate — it is accessible only via a direct URL you share privately.

---

## Cloudflare Pages (alternative)

Cloudflare Pages supports Functions (`/functions` folder) instead of Vercel's `/api`. To deploy on Cloudflare Pages:

1. Move files from `/api` into `/functions` (same structure)
2. Change the exported handler format from `module.exports = async (req, res)` to Cloudflare Workers syntax
3. Set environment variables in Cloudflare Pages dashboard
4. The `vercel.json` routing file is not needed — remove it

For simplicity, **Vercel is recommended** as it supports Node.js serverless functions out of the box with zero config changes.
