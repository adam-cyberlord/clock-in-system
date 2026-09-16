# 🕒 NAUB TimeMark — Project Specification

> **Version:** 1.2.0
> **Last Updated:** September 3, 2026
> **Author:** Sandlip Oasis IT Internship Team

---

## 📌 Table of Contents

1. [Project Overview](#1-project-overview)
2. [How It Works — System Flow](#2-how-it-works--system-flow)
3. [User Roles & Permissions](#3-user-roles--permissions)
4. [Core Features](#4-core-features)
5. [Security & Device Binding](#5-security--device-binding)
6. [Tech Stack](#6-tech-stack)
7. [Database Design (PostgreSQL / Supabase)](#7-database-design)
8. [API Integrations](#8-api-integrations)
9. [QR Code & Barcode](#9-qr-code--barcode)
10. [Frontend Architecture](#10-frontend-architecture)
11. [Backend Architecture](#11-backend-architecture)
12. [Calendar & Attendance Sync](#12-calendar--attendance-sync)
13. [Open Questions & Decisions](#13-open-questions--decisions)

---

## 1. Project Overview

**NAUB TimeMark** is a web-based attendance management system built for student IT interns at Sandlip Oasis.

Students can mark their attendance by either:
- **Scanning a QR code** at the designated location, OR
- **Visiting the web portal** and clocking in using their unique **Tracking ID** (also called Clock-In ID).

**Login is split by role — there is no shared credential form:**
- **Admin** signs in with **username + password only**.
- **Students / users** sign in with their **Tracking ID only**. Students never have a password and cannot use the admin form.

The system enforces strict **one-clock-in-per-day** and **device-binding** rules to prevent buddy punching (a friend clocking in on your behalf).

---

## 2. How It Works — System Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        ATTENDANCE FLOW                          │
│                                                                 │
│  Student opens website / scans QR Code                         │
│             │                                                   │
│             ▼                                                   │
│  System validates IP Address + MAC Address                      │
│             │                                                   │
│     ┌───────┴───────┐                                           │
│     ▼               ▼                                           │
│  ✅ Match         ❌ No Match                                   │
│  Allowed          Blocked + Alert                               │
│     │                                                           │
│     ▼                                                           │
│  Student enters Tracking ID                                     │
│             │                                                   │
│     ┌───────┴───────┐                                           │
│     ▼               ▼                                           │
│  Already            Not Clocked In Today                        │
│  Clocked In  →  ✅ Attendance Recorded in DB                   │
│  ❌ Blocked                                                     │
└─────────────────────────────────────────────────────────────────┘
```

**Step-by-step breakdown:**

1. **Admin** creates a location and generates a QR code (once per day).
2. **Student** visits the website or scans the QR code.
3. The system automatically **captures and validates** the student's IP address and MAC address.
4. If the device matches the registered device, the student is allowed to proceed.
5. The student enters their **Tracking ID** (Clock-In ID). That ID is their only login credential — no username or password.
6. Attendance is saved in **PostgreSQL (Supabase)** and synced with the live calendar.

---

## 3. User Roles & Permissions

### 👑 Admin

| Permission | Description |
|---|---|
| Create Location | Admin sets the physical attendance location |
| Generate QR Code | One QR code per day, tied to the current location |
| Update Location | Admin can change the location at any time |
| View All Attendance | Full access to all student records |
| Manage Students | Add, edit, or deactivate student accounts |
| Override Attendance | Manually correct or add attendance records |

> ⚠️ **Rule:** Only **one QR code** can be active per day. If the admin generates a new one, the old one is invalidated.

> 🔐 **Login:** Admin authenticates with **username + password only**. Admin cannot sign in with a Tracking ID.

---

### 🎓 Student

| Permission | Description |
|---|---|
| Register Account | Student registers with their personal details |
| Clock In | Mark attendance once per day |
| Clock Out | Mark end of session (optional or required — see [Open Questions](#13-open-questions--decisions)) |
| View Own Attendance | Student sees their own attendance history and calendar |

> ⚠️ **Rule:** A student can only clock in **once per day**. Any second attempt is blocked.

> 🔐 **Login:** A student authenticates with their **Tracking ID only**. Students cannot use username/password. The registered device (IP + browser fingerprint) is the second factor.

---

### 🔐 Authentication (mandatory split)

| Role | Allowed credentials | Not allowed |
|---|---|---|
| **Admin** | Username + password | Tracking ID, student email, student Clock-In ID |
| **Student / user** | Tracking ID (Clock-In ID) + registered device | Username, password, admin credentials |

**Home page (`index.html`) has two separate portals — never one mixed form:**
1. **Student Portal** — Tracking ID field only (punch / dashboard login).
2. **Admin Portal** — Username and password fields only.

Backend enforces the same split:
- `POST /api/auth/admin/login` — username + password. Rejects Tracking IDs.
- `POST /api/auth/student/login` — Tracking ID only. Rejects password-based student login.
- There is **no** combined `POST /api/auth/login` that accepts both roles.

---

## 4. Core Features

### 4.1 Student Registration
- Student provides: full name, student ID, email, phone number.
- **No password is collected.** Students never set or use a password.
- On registration, the system **captures and stores**:
  - IP Address of the device used to register
  - Browser fingerprint (see MAC-address note below)
- A unique **Tracking ID** (Clock-In ID, format `OT-XXXXXXXX`) is generated and issued to the student.
- This Tracking ID is **permanently tied to the registered device** (IP + fingerprint).
- The Tracking ID is the student's **only login key** for dashboard access and clock-in.

> 💡 **Note on MAC Address capture:** MAC addresses cannot be captured directly from a browser for security reasons. This will require either a **dedicated desktop/mobile app**, a **browser extension**, or **network-level capture (via router/admin tools)**. This needs a final decision — see [Open Questions](#13-open-questions--decisions).

---

### 4.2 Clock-In (Attendance Marking)
- Student visits the portal or scans the daily QR code and enters their **Tracking ID** (not a password).
- System validates:
  1. IP Address matches registered device.
  2. MAC Address matches registered device (if applicable).
  3. No prior clock-in exists for today.
- On success → attendance is recorded with a timestamp.
- On failure → the student is shown a clear error message.

---

### 4.3 QR Code (Admin-Generated)
- Admin generates **one QR code per day**.
- The QR code encodes:
  - Location ID
  - Date
  - A short-lived security token (to prevent replay attacks)
- Scanning the QR code auto-fills the attendance form on the student's device.

---

### 4.4 Attendance Dashboard
- **Admin Dashboard:** Full table view of all students, dates, clock-in/out times, and location.
- **Student Dashboard:** Personal attendance history with a calendar view showing attended days.

---

## 5. Security & Device Binding

This is the core anti-fraud mechanism of Oasis TimeMark.

| Check | How It Works | Result if Fails |
|---|---|---|
| IP Address Match | Compares current IP to registered IP | Access Denied |
| MAC Address Match | Compares current MAC to registered MAC | Access Denied |
| One Clock-In Per Day | Checks DB for existing record today | Blocked |
| QR Code Token Expiry | Token is time-limited (e.g., valid for 5 minutes) | QR Rejected |
| Tracking ID Validation | Must match a registered student record | Invalid ID Error |
| Role-separated login | Admin form never accepts Tracking IDs; student form never accepts passwords | Access Denied |

> 🔒 **Design Decision:** The Tracking ID alone is not enough to clock in — the device must also match. This means even if someone else knows your Tracking ID, they cannot use it from a different device.

> 🔒 **Design Decision:** Passwords are an **admin-only** credential. Users (students) must not be able to log in with username/password.

---

## 6. Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| **Frontend (Option 1)** | HTML, CSS, JavaScript | Simple, lightweight client |
| **Frontend (Option 2)** | Svelte + JavaScript | Reactive, component-based UI |
| **Backend** | Node.js + Express | REST API server |
| **Database** | PostgreSQL via Supabase | Hosted, real-time capable |
| **QR/Barcode** | bwip-js | Barcode & QR code generation |
| **Location API** | OpenStreetMap / LocationIQ | Free-tier geolocation APIs |
| **Authentication** | Custom JWT, role-split | Admin: username + password. Student: Tracking ID + device. |

> 💡 **Frontend Decision Needed:** Will both frontends (HTML/CSS/JS and Svelte) be used together, or is one the primary choice? For example, Svelte could power the student-facing app while plain HTML/CSS/JS handles a simpler admin panel. See [Open Questions](#13-open-questions--decisions).

---

## 7. Database Design

### Tables (PostgreSQL / Supabase)

#### `admins`
| Column | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `full_name` | VARCHAR | Admin display name |
| `username` | VARCHAR | Unique login username (email may be used as username) |
| `email` | VARCHAR | Admin email |
| `password_hash` | VARCHAR | bcrypt hash — **admins only** |
| `is_active` | BOOLEAN | Account enabled flag |
| `created_at` | TIMESTAMP | Creation date |

#### `students`
| Column | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `full_name` | VARCHAR | Student's full name |
| `student_id` | VARCHAR | Unique student ID number |
| `email` | VARCHAR | Student email (identity only — **not used to log in**) |
| `clock_in_id` | VARCHAR | Tracking ID — the student's **only** login credential |
| `password_hash` | VARCHAR | Unused placeholder; students **do not** authenticate with a password |
| `registered_ip` | VARCHAR | IP at time of registration |
| `registered_mac` | VARCHAR | MAC address at registration (if applicable) |
| `created_at` | TIMESTAMP | Registration date |
| `is_active` | BOOLEAN | Admin can deactivate a student |

#### `locations`
| Column | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `name` | VARCHAR | Location name (e.g., "Main Lab") |
| `address` | TEXT | Physical address |
| `latitude` | DECIMAL | Geo-coordinate |
| `longitude` | DECIMAL | Geo-coordinate |
| `created_by` | UUID | Admin who created it |
| `created_at` | TIMESTAMP | Creation timestamp |

#### `qr_codes`
| Column | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `location_id` | UUID | FK → locations |
| `token` | VARCHAR | Short-lived security token |
| `valid_date` | DATE | The day this QR code is valid |
| `expires_at` | TIMESTAMP | Expiry time (e.g., end of day or 5 min) |
| `created_by` | UUID | Admin who generated it |
| `is_active` | BOOLEAN | Only one active per day |

#### `attendance`
| Column | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `student_id` | UUID | FK → students |
| `location_id` | UUID | FK → locations |
| `clock_in_time` | TIMESTAMP | When student clocked in |
| `clock_out_time` | TIMESTAMP | When student clocked out (nullable) |
| `ip_address` | VARCHAR | IP used during clock-in |
| `mac_address` | VARCHAR | MAC used during clock-in |
| `date` | DATE | Attendance date (for quick daily queries) |
| `qr_used` | BOOLEAN | Was a QR code used? |

---

## 8. API Integrations

### 8.1 OpenStreetMap (Free)
- **Purpose:** Display the intern location on a map in the admin panel.
- **Library:** Leaflet.js with OpenStreetMap tiles.
- **Cost:** Free, no API key required.
- **Docs:** [https://www.openstreetmap.org](https://www.openstreetmap.org)

### 8.2 LocationIQ (Free Tier)
- **Purpose:** Geocoding (convert address → coordinates) and reverse geocoding.
- **Cost:** Free tier — 5,000 requests/day.
- **Docs:** [https://locationiq.com](https://locationiq.com)
- **Note:** API key must be stored in `.env` file and never committed to git.

---

## 9. QR Code & Barcode

### Library: `bwip-js`
- **Usage:** Generate QR codes on the backend (Node.js) and render them in the browser.
- **Why bwip-js:** Supports QR codes, barcodes, and over 100 other symbologies. Works in both Node.js and the browser.
- **Docs:** [https://github.com/metafloor/bwip-js](https://github.com/metafloor/bwip-js)

**QR Code payload example:**
```json
{
  "location_id": "uuid-here",
  "date": "2026-08-31",
  "token": "xyz123abc",
  "expires_at": "2026-08-31T23:59:59Z"
}
```

---

## 10. Frontend Architecture

### Option A — HTML / CSS / JavaScript (Simpler)
Best suited for the **Admin Portal** or as a lightweight fallback.

**Pages:**
- `/` (`index.html`) — Split portals: **Student = Tracking ID only**, **Admin = username + password only**
- `/register` — Student registration (no password fields)
- `/dashboard` — Student personal attendance + calendar (session from Tracking ID login)
- `/admin` — Admin panel (session from username + password only)
- `/clock-in` — Clock-in page (manual or via QR redirect)

---

### Option B — Svelte + JavaScript (Recommended for Student Portal)
Best suited for the **Student-facing app** — reactive and fast.

**Components:**
- `Auth.svelte` — Role-split: admin username/password vs student Tracking ID
- `ClockIn.svelte` — QR scan or manual clock-in
- `Calendar.svelte` — Visual attendance calendar
- `Dashboard.svelte` — Summary stats
- `AdminPanel.svelte` — Admin-only view

---

## 11. Backend Architecture

### Stack: Node.js + Express

**Suggested folder structure:**
```
/server
  /routes
    auth.js          ← student Tracking ID login, admin username/password login, register
    attendance.js    ← clock-in, clock-out
    admin.js         ← location, QR code management
    students.js      ← student CRUD
  /middleware
    auth.js          ← JWT verification
    deviceCheck.js   ← IP + MAC validation
  /controllers
    attendanceController.js
    adminController.js
    studentController.js
  /utils
    qrGenerator.js   ← bwip-js wrapper
    tokenHelper.js   ← JWT / token helpers
  /db
    supabase.js      ← Supabase client setup
  index.js           ← App entry point
  .env               ← Secrets (never commit!)
```

### Key API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Student registration (no password) |
| `POST` | `/api/auth/student/login` | Student login — **Tracking ID only** |
| `POST` | `/api/auth/admin/login` | Admin login — **username + password only** |
| `POST` | `/api/attendance/clock-in` | Record clock-in |
| `POST` | `/api/attendance/clock-out` | Record clock-out |
| `GET` | `/api/attendance/:studentId` | Get student attendance history |
| `GET` | `/api/attendance/today` | Admin: get today's attendance |
| `POST` | `/api/admin/location` | Create/update location |
| `POST` | `/api/admin/qr/generate` | Generate daily QR code |
| `GET` | `/api/admin/students` | List all students |

---

## 12. Calendar & Attendance Sync

- The student dashboard displays a **monthly calendar view**.
- Days where the student clocked in are **highlighted green**.
- Days where the student was absent are **highlighted red** (only for days the office was open).
- The calendar always reflects the **current real-world date** — no manual sync needed.
- Admin can define **working days** (e.g., Mon–Fri) so weekends are excluded from the absent count.

**Suggested library:** `FullCalendar.js` (open source) or a custom Svelte calendar component.

---

## 13. Open Questions & Decisions

All questions have been resolved as of v1.1:

| # | Question | Decision | Status |
|---|---|---|---|
| 1 | **MAC Address Capture** — Browsers block direct MAC access. | ✅ **C) Browser fingerprint** — canvas + WebGL + audio + font + hardware fingerprint via `client/js/fingerprint.js` using SubtleCrypto SHA-256. | ✅ Resolved |
| 2 | **Clock-Out** — Is clock-out required, or is clock-in only enough? | ✅ **B) Both** — clock-out is supported and optional. Students see a live session timer and a confirmation dialog before clocking out. | ✅ Resolved |
| 3 | **Frontend** — Will both HTML/CSS/JS and Svelte be used, or just one? | ✅ **C) HTML/CSS/JS only** — all five pages use vanilla JS with a shared design system (`css/style.css`) and two shared JS modules (`js/api.js`, `js/fingerprint.js`). | ✅ Resolved |
| 4 | **Authentication** — Custom JWT or Supabase Auth? Split credentials? | ✅ **B) Custom JWT** — `jsonwebtoken` + bcryptjs. **Admin = username + password only. Student = Tracking ID only.** Tokens in `localStorage` (`tm_token`, `tm_user`). 401s auto-redirect to login. | ✅ Resolved |
| 5 | **QR Code Expiry** — How long is a QR code valid? | ✅ **A) End of business day** — QR tokens expire at `23:59:59` of the generation date. Configurable in `adminController.js`. | ✅ Resolved |
| 6 | **Offline Support** — What happens if the internet is down? | ✅ **A) No offline support** — a network error is shown to the user. Offline queuing is out of scope for this internship project. | ✅ Resolved |

---

## 🗂 Implemented Features (v1.2)

### Backend
- ✅ Express + Node.js REST API with helmet, CORS, rate limiting
- ✅ Supabase (PostgreSQL) — all 6 tables, indexes, RLS, triggers
- ✅ Custom JWT authentication with **role-split login** (admin username+password vs student Tracking ID)
- ✅ Student registration with browser fingerprint + IP device binding (no student password)
- ✅ Clock-in with QR token validation, device check, duplicate prevention
- ✅ Clock-out with duration calculation
- ✅ Admin: location CRUD, daily QR generation, student management
- ✅ Attendance stats with **real absent count** using `working_days` table
- ✅ **Streak counter** — consecutive working days attended
- ✅ Working days config API (`GET/PUT /api/admin/working-days`)
- ✅ Paginated attendance history with filters
- ✅ Admin attendance override endpoint

### Frontend
- ✅ `client/js/api.js` — HTTP client with auth headers, 401 redirect, `showAlert`, `clearAlert`, `showToast`, `setLoading`, `escapeHTML`, `formatTime`, `formatDate`, `calcDuration`
- ✅ `client/js/fingerprint.js` — canvas + WebGL + audio + font + screen fingerprint → SHA-256 hex
- ✅ `index.html` — two portals: student Tracking ID punch/login, admin username + password (no shared form)
- ✅ `register.html` — 3-step wizard, no password, Tracking ID QR (client-side), download-as-txt
- ✅ `clock-in.html` — live session timer, pulse ring, clock-out confirmation dialog, late warning, QR scanner
- ✅ `dashboard.html` — streak badge, attendance rate bar with colour coding, calendar tooltips, show-all history toggle, CSV export
- ✅ `admin.html` — 7-day bar chart, student detail modal (stats + mini records table), working-days config UI, duration column in tables, per-student attendance rate bars, print-safe QR area

---

## ✅ Next Steps

- [x] Answer all Open Questions
- [x] Finalize the frontend choice (HTML/CSS/JS)
- [ ] **Set up Supabase project** — run `database/schema.sql` in the Supabase SQL editor
- [ ] **Configure `.env`** — copy `server/.env.example` → `server/.env` and fill in all values including `ADMIN_SETUP_KEY`
- [ ] **Install dependencies** — `cd server && npm install`
- [ ] **Create first admin** — POST to `/api/auth/admin/register` with the `ADMIN_SETUP_KEY`
- [ ] **Start the server** — `npm run dev` (or `npm start` in production)
- [ ] **Open the app** — point browser at `client/index.html` (or serve via a static file server)
- [ ] Test full end-to-end flow: register student → generate QR → clock in → verify dashboard
- [ ] Deploy (e.g., Render/Railway for backend, Netlify/Vercel for frontend, or serve client from Express)

---

*Oasis TimeMark — Built by Sandlip Oasis IT Interns* 🚀
