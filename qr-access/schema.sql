-- ═══════════════════════════════════════════════════════════════
--  QR Access Control — Supabase Schema
--  Paste into: https://supabase.com/dashboard/project/_/sql/new
--  and click Run.
-- ═══════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── QR admin accounts ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qr_admins (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name     VARCHAR(255) NOT NULL,
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Invite codes ─────────────────────────────────────────────────
-- Each row is one QR code the admin generates.
CREATE TABLE IF NOT EXISTS qr_invites (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code          VARCHAR(128) UNIQUE NOT NULL,   -- secret token embedded in the QR
  label         TEXT,                            -- admin note, e.g. "Batch A – 10 students"
  created_by    UUID REFERENCES qr_admins(id) ON DELETE SET NULL,
  expires_at    TIMESTAMPTZ NOT NULL,            -- hard expiry
  one_time_use  BOOLEAN DEFAULT true,            -- if true, first scan consumes the code
  max_uses      INTEGER DEFAULT 1,               -- max scans before auto-revoke (1 = one-time)
  use_count     INTEGER DEFAULT 0,               -- incremented on every successful scan
  is_active     BOOLEAN DEFAULT true,            -- admin can revoke instantly
  redirect_to   VARCHAR(20) DEFAULT 'register',  -- 'register' | 'login'
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Scan audit log ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qr_access_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invite_id   UUID REFERENCES qr_invites(id) ON DELETE SET NULL,
  code        VARCHAR(128),
  ip_address  VARCHAR(100),
  user_agent  TEXT,
  result      VARCHAR(20) NOT NULL
              CHECK (result IN ('granted','expired','used_up','revoked','invalid')),
  scanned_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_qr_invites_code      ON qr_invites(code);
CREATE INDEX IF NOT EXISTS idx_qr_invites_active    ON qr_invites(is_active, expires_at);
CREATE INDEX IF NOT EXISTS idx_qr_access_log_invite ON qr_access_log(invite_id);

-- ── Disable RLS (backend uses service_role key which bypasses it anyway) ─
ALTER TABLE qr_admins      DISABLE ROW LEVEL SECURITY;
ALTER TABLE qr_invites     DISABLE ROW LEVEL SECURITY;
ALTER TABLE qr_access_log  DISABLE ROW LEVEL SECURITY;

GRANT ALL ON ALL TABLES    IN SCHEMA public TO anon, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, service_role;

SELECT 'QR Access Control schema ready ✅' AS status;
