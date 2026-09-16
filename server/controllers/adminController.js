const supabase = require('../db/supabase');
const { generateQRToken } = require('../utils/tokenHelper');
const { generateQRCode }  = require('../utils/qrGenerator');

// ─────────────────────────────────────────────────────────────────
// Helper: resolve admin ID — handles stale JWTs from old DB
// If the id from the token doesn't exist, look up by email instead.
// ─────────────────────────────────────────────────────────────────
async function _resolveAdminId(tokenId, tokenEmail) {
  // First try the ID from token directly
  const { data: byId } = await supabase
    .from('admins').select('id').eq('id', tokenId).eq('is_active', true).maybeSingle();
  if (byId) return byId.id;

  // Fallback: look up by email (stale token from old Supabase project)
  if (tokenEmail) {
    const { data: byEmail } = await supabase
      .from('admins').select('id').eq('email', tokenEmail).eq('is_active', true).maybeSingle();
    if (byEmail) return byEmail.id;
  }

  // Return original id — let DB throw its own FK error with context
  return tokenId;
}

// ─────────────────────────────────────────────────────────────────
// LOCATIONS
// ─────────────────────────────────────────────────────────────────

async function createLocation(req, res) {
  try {
    const { name, address, latitude, longitude, geofence_radius, width_m, length_m } = req.body;
    if (!name) return res.status(400).json({ error: 'Location name is required' });

    const radius  = Math.max(30, parseFloat(geofence_radius) || 50);
    const widthM  = Math.max(0, parseFloat(width_m)  || 0);
    const lengthM = Math.max(0, parseFloat(length_m) || 0);

    // Verify the admin id exists — if not, look up by email (handles stale tokens)
    const adminId = await _resolveAdminId(req.user.id, req.user.email);

    const { data, error } = await supabase.from('locations')
      .insert({ name, address, latitude, longitude,
                geofence_radius: radius,
                width_m: widthM, length_m: lengthM,
                created_by: adminId })
      .select().single();

    if (error) {
      console.error('createLocation DB error:', error);
      return res.status(500).json({ error: 'Failed to create location: ' + error.message });
    }
    return res.status(201).json({ message: 'Location created', location: data });
  } catch (err) {
    console.error('createLocation error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateLocation(req, res) {
  try {
    const { id } = req.params;
    const { name, address, latitude, longitude, is_active, geofence_radius, width_m, length_m } = req.body;

    const updates = {};
    if (name        !== undefined) updates.name             = name;
    if (address     !== undefined) updates.address          = address;
    if (latitude    !== undefined) updates.latitude         = latitude;
    if (longitude   !== undefined) updates.longitude        = longitude;
    if (is_active   !== undefined) updates.is_active        = is_active;
    if (geofence_radius !== undefined) updates.geofence_radius = Math.max(30, parseFloat(geofence_radius) || 50);
    if (width_m     !== undefined) updates.width_m          = Math.max(0, parseFloat(width_m)  || 0);
    if (length_m    !== undefined) updates.length_m         = Math.max(0, parseFloat(length_m) || 0);

    const { data, error } = await supabase.from('locations')
      .update(updates).eq('id', id).select().single();

    if (error) return res.status(500).json({ error: 'Failed to update location' });
    return res.json({ message: 'Location updated', location: data });
  } catch (err) {
    console.error('updateLocation error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getLocations(req, res) {
  try {
    const { data, error } = await supabase.from('locations')
      .select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: 'Failed to fetch locations' });
    return res.json({ locations: data || [] });
  } catch (err) {
    console.error('getLocations error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ─────────────────────────────────────────────────────────────────
// ATTENDANCE SESSIONS
// Admin opens a session for a venue; students can only clock in
// while a session is active today.
// ─────────────────────────────────────────────────────────────────

async function openSession(req, res) {
  try {
    const { location_id, note } = req.body;
    if (!location_id) return res.status(400).json({ error: 'location_id is required' });

    const today = new Date().toISOString().split('T')[0];

    const { data: loc } = await supabase.from('locations')
      .select('id, name').eq('id', location_id).eq('is_active', true).single();
    if (!loc) return res.status(404).json({ error: 'Location not found or inactive' });

    const adminId = await _resolveAdminId(req.user.id, req.user.email);

    // Close existing open session for today
    await supabase.from('attendance_sessions')
      .update({ is_active: false, closed_at: new Date().toISOString() })
      .eq('session_date', today).eq('is_active', true);

    // Upsert: if a row exists for today replace it, otherwise insert
    const { data: session, error } = await supabase.from('attendance_sessions')
      .upsert({
        location_id,
        session_date: today,
        opened_by:   adminId,
        is_active:   true,
        opened_at:   new Date().toISOString(),
        closed_at:   null,
        note:        note || null
      }, { onConflict: 'session_date' })
      .select('*, locations(id, name, address, latitude, longitude, width_m, length_m, geofence_radius)')
      .single();

    if (error) {
      const missing = error.message?.includes('does not exist') || error.message?.includes('schema cache') || error.code === '42P01';
      if (missing) {
        return res.status(503).json({
          error: 'The attendance_sessions table does not exist yet. Please run the schema SQL in your Supabase SQL Editor. See database/schema.sql in the project.',
          code: 'TABLE_MISSING'
        });
      }
      return res.status(500).json({ error: 'Failed to open session: ' + error.message });
    }

    return res.status(201).json({
      message: `Session opened for ${loc.name}. Students can now clock in.`,
      session
    });
  } catch (err) {
    console.error('openSession error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function closeSession(req, res) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const { data, error } = await supabase.from('attendance_sessions')
      .update({ is_active: false, closed_at: new Date().toISOString() })
      .eq('session_date', today).eq('is_active', true)
      .select().maybeSingle();

    if (error) {
      const missing = error.message?.includes('does not exist') || error.message?.includes('schema cache') || error.code === '42P01';
      if (missing) return res.status(503).json({ error: 'attendance_sessions table missing. Run schema.sql first.', code: 'TABLE_MISSING' });
      return res.status(500).json({ error: 'Failed to close session' });
    }
    if (!data) return res.status(404).json({ error: 'No active session found for today' });
    return res.json({ message: 'Session closed. Clock-in is now disabled.', session: data });
  } catch (err) {
    console.error('closeSession error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getTodaySession(req, res) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const { data, error } = await supabase.from('attendance_sessions')
      .select('*, locations(id, name, address, latitude, longitude, width_m, length_m, geofence_radius)')
      .eq('session_date', today)
      .maybeSingle();

    if (error) {
      const missing = error.message?.includes('does not exist') || error.message?.includes('schema cache') || error.code === '42P01';
      if (missing) return res.json({ session: null, table_missing: true });
      return res.status(500).json({ error: 'Failed to fetch session' });
    }
    return res.json({ session: data || null });
  } catch (err) {
    console.error('getTodaySession error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getActiveSession(req, res) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const { data, error } = await supabase.from('attendance_sessions')
      .select('id, session_date, is_active, opened_at, locations(id, name, address, latitude, longitude, width_m, length_m, geofence_radius)')
      .eq('session_date', today)
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      // Table missing — return no session (non-blocking for students)
      return res.json({ session: null });
    }
    return res.json({ session: data || null });
  } catch (err) {
    console.error('getActiveSession error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ─────────────────────────────────────────────────────────────────
// QR CODES
// ─────────────────────────────────────────────────────────────────

async function generateDailyQR(req, res) {
  try {
    const { location_id } = req.body;
    const today = new Date().toISOString().split('T')[0];
    if (!location_id) return res.status(400).json({ error: 'location_id is required' });

    const { data: location } = await supabase.from('locations')
      .select('id, name').eq('id', location_id).eq('is_active', true).single();
    if (!location) return res.status(404).json({ error: 'Location not found or inactive' });

    await supabase.from('qr_codes').update({ is_active: false }).eq('valid_date', today);

    const token      = generateQRToken();
    const expiresAt  = new Date(`${today}T23:59:59`).toISOString();

    const adminId2 = await _resolveAdminId(req.user.id, req.user.email);
    const { data: qrRecord, error } = await supabase.from('qr_codes')
      .insert({ location_id, token, valid_date: today, expires_at: expiresAt,
                created_by: adminId2, is_active: true })
      .select().single();

    if (error) return res.status(500).json({ error: 'Failed to generate QR code' });

    const qrPayload = JSON.stringify({ token, location_id, date: today });
    const qrImage   = await generateQRCode(qrPayload);

    return res.status(201).json({
      message: 'QR code generated successfully',
      qr: { id: qrRecord.id, token, valid_date: today, expires_at: expiresAt,
            location: location.name, image: qrImage }
    });
  } catch (err) {
    console.error('generateDailyQR error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getTodayQR(req, res) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const { data, error } = await supabase.from('qr_codes')
      .select('id, token, valid_date, expires_at, is_active, locations(name, address)')
      .eq('valid_date', today).eq('is_active', true).single();

    if (error || !data) return res.status(404).json({ error: 'No QR code generated for today yet.' });

    const qrPayload = JSON.stringify({ token: data.token, location_id: data.locations?.id, date: today });
    const qrImage   = await generateQRCode(qrPayload);
    return res.json({ qr: { ...data, image: qrImage } });
  } catch (err) {
    console.error('getTodayQR error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ─────────────────────────────────────────────────────────────────
// STUDENTS
// ─────────────────────────────────────────────────────────────────

async function getAllStudents(req, res) {
  try {
    const { search, is_active, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    let query = supabase.from('students')
      .select('id, full_name, student_number, email, phone, clock_in_id, registered_ip, registered_mac, is_active, created_at',
              { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (search)    query = query.or(`full_name.ilike.%${search}%,student_number.ilike.%${search}%,email.ilike.%${search}%`);
    if (is_active !== undefined) query = query.eq('is_active', is_active === 'true');

    const { data, error, count } = await query;
    if (error) return res.status(500).json({ error: 'Failed to fetch students' });
    return res.json({ total: count, page: Number(page), limit: Number(limit), students: data || [] });
  } catch (err) {
    console.error('getAllStudents error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function toggleStudentStatus(req, res) {
  try {
    const { id } = req.params;
    const { is_active } = req.body;
    const { data, error } = await supabase.from('students')
      .update({ is_active }).eq('id', id)
      .select('id, full_name, is_active').single();
    if (error) return res.status(500).json({ error: 'Failed to update student' });
    return res.json({ message: `Student ${is_active ? 'activated' : 'deactivated'} successfully`, student: data });
  } catch (err) {
    console.error('toggleStudentStatus error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getDashboardStats(req, res) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const [studentsRes, todayRes, totalAttRes] = await Promise.all([
      supabase.from('students').select('id', { count: 'exact' }).eq('is_active', true),
      supabase.from('attendance').select('id', { count: 'exact' }).eq('date', today),
      supabase.from('attendance').select('id', { count: 'exact' })
    ]);
    return res.json({
      stats: {
        total_active_students:    studentsRes.count  || 0,
        present_today:            todayRes.count     || 0,
        total_attendance_records: totalAttRes.count  || 0
      }
    });
  } catch (err) {
    console.error('getDashboardStats error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ─────────────────────────────────────────────────────────────────
// WORKING DAYS
// ─────────────────────────────────────────────────────────────────

async function getWorkingDays(req, res) {
  try {
    const { data, error } = await supabase.from('working_days').select('*').order('day_of_week');
    if (error) return res.status(500).json({ error: 'Failed to fetch working days' });
    return res.json({ working_days: data });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateWorkingDays(req, res) {
  try {
    const { working_days } = req.body;
    if (!Array.isArray(working_days)) return res.status(400).json({ error: 'working_days must be an array' });
    for (const day of working_days) {
      await supabase.from('working_days').update({ is_working: day.is_working }).eq('day_of_week', day.day_of_week);
    }
    return res.json({ message: 'Working days updated successfully' });
  } catch (err) {
    console.error('updateWorkingDays error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  createLocation, updateLocation, getLocations,
  openSession, closeSession, getTodaySession, getActiveSession,
  generateDailyQR, getTodayQR,
  getAllStudents, toggleStudentStatus,
  getDashboardStats,
  getWorkingDays, updateWorkingDays
};
