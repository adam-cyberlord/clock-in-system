-- ═══════════════════════════════════════════════════════════════
--  Oasis Pulse — Migration: attendance_sessions + location columns
--
--  Run this in your Supabase SQL Editor:
--  1. Go to https://supabase.com → your project → SQL Editor
--  2. Paste this entire file and click Run
-- ═══════════════════════════════════════════════════════════════

-- Add width_m and length_m to locations if they don't exist
ALTER TABLE locations ADD COLUMN IF NOT EXISTS width_m  DECIMAL(8,2) DEFAULT 0;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS length_m DECIMAL(8,2) DEFAULT 0;

-- Create attendance_sessions table
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

-- Index for fast daily lookup
CREATE INDEX IF NOT EXISTS idx_sessions_date_active
  ON attendance_sessions(session_date, is_active);

-- Confirm
SELECT 'attendance_sessions table ready' AS status;
