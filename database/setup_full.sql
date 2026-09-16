-- ═══════════════════════════════════════════════════════════════
--  Oasis Pulse — FULL SETUP SQL
--  Run this ONCE in Supabase SQL Editor:
--  https://supabase.com/dashboard/project/jxbeqceudskxjnfniyqm/sql/new
--
--  This creates all tables AND disables RLS so the anon key works.
-- ═══════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── admins ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admins (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name     VARCHAR(255) NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── students ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS students (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name          VARCHAR(255) NOT NULL,
  student_number     VARCHAR(100) UNIQUE NOT NULL,
  email              VARCHAR(255) UNIQUE NOT NULL,
  phone              VARCHAR(50),
  password_hash      VARCHAR(255),
  clock_in_id        VARCHAR(20) UNIQUE NOT NULL,
  registered_ip      VARCHAR(100),
  registered_mac     VARCHAR(17),
  device_fingerprint TEXT,
  device_address     TEXT,
  is_active          BOOLEAN DEFAULT true,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ── locations ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS locations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            VARCHAR(255) NOT NULL,
  address         TEXT,
  latitude        DECIMAL(10,7),
  longitude       DECIMAL(10,7),
  geofence_radius DECIMAL(8,2) DEFAULT 50.00,
  width_m         DECIMAL(8,2) DEFAULT 0,
  length_m        DECIMAL(8,2) DEFAULT 0,
  created_by      UUID REFERENCES admins(id),
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE locations ADD COLUMN IF NOT EXISTS width_m  DECIMAL(8,2) DEFAULT 0;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS length_m DECIMAL(8,2) DEFAULT 0;

-- ── attendance_sessions ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance_sessions (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  location_id  UUID REFERENCES locations(id) ON DELETE CASCADE,
  session_date DATE NOT NULL,
  opened_by    UUID REFERENCES admins(id),
  is_active    BOOLEAN DEFAULT true,
  opened_at    TIMESTAMPTZ DEFAULT NOW(),
  closed_at    TIMESTAMPTZ,
  note         TEXT,
  UNIQUE (session_date)
);
CREATE INDEX IF NOT EXISTS idx_sessions_date_active ON attendance_sessions(session_date, is_active);

-- ── qr_codes ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qr_codes (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  location_id UUID REFERENCES locations(id),
  token       VARCHAR(255) UNIQUE NOT NULL,
  valid_date  DATE NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_by  UUID REFERENCES admins(id),
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── attendance ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id         UUID REFERENCES students(id) ON DELETE CASCADE,
  location_id        UUID REFERENCES locations(id),
  clock_in_time      TIMESTAMPTZ,
  clock_out_time     TIMESTAMPTZ,
  ip_address         VARCHAR(100),
  mac_address        VARCHAR(17),
  device_fingerprint TEXT,
  latitude           DECIMAL(10,7),
  longitude          DECIMAL(10,7),
  location_accuracy  DECIMAL(10,2),
  date               DATE NOT NULL,
  qr_used            BOOLEAN DEFAULT false,
  status             VARCHAR(20) DEFAULT 'present' CHECK (status IN ('present','late','absent')),
  created_at         TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS mac_address        VARCHAR(17);
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS latitude           DECIMAL(10,7);
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS longitude          DECIMAL(10,7);
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS location_accuracy  DECIMAL(10,2);

-- ── working_days ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS working_days (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  is_working  BOOLEAN DEFAULT true,
  UNIQUE(day_of_week)
);
INSERT INTO working_days (day_of_week, is_working) VALUES
  (0,false),(1,true),(2,true),(3,true),(4,true),(5,true),(6,false)
ON CONFLICT (day_of_week) DO NOTHING;

-- ── Indexes ──────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_attendance_student_date    ON attendance(student_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_date            ON attendance(date);
CREATE INDEX IF NOT EXISTS idx_qr_codes_valid_date        ON qr_codes(valid_date);
CREATE INDEX IF NOT EXISTS idx_students_clock_in_id       ON students(clock_in_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_one_per_day
  ON attendance(student_id, date) WHERE clock_in_time IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_students_device_fingerprint
  ON students(device_fingerprint)
  WHERE device_fingerprint IS NOT NULL AND device_fingerprint <> '';

-- ── updated_at trigger ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ language 'plpgsql';
DROP TRIGGER IF EXISTS update_locations_updated_at ON locations;
CREATE TRIGGER update_locations_updated_at
  BEFORE UPDATE ON locations FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ── DISABLE RLS so anon key works from backend ───────────────────
-- (Use service_role key in production to re-enable this properly)
ALTER TABLE admins            DISABLE ROW LEVEL SECURITY;
ALTER TABLE students          DISABLE ROW LEVEL SECURITY;
ALTER TABLE locations         DISABLE ROW LEVEL SECURITY;
ALTER TABLE qr_codes          DISABLE ROW LEVEL SECURITY;
ALTER TABLE attendance        DISABLE ROW LEVEL SECURITY;
ALTER TABLE working_days      DISABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_sessions DISABLE ROW LEVEL SECURITY;

-- ── Grant full access to anon role ───────────────────────────────
GRANT ALL ON ALL TABLES    IN SCHEMA public TO anon;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon;

SELECT 'All tables created and RLS disabled — ready to use!' AS status;
