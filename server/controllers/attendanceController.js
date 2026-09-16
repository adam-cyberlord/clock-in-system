const supabase = require('../db/supabase');
const { getClientIP, getClientMAC } = require('../middleware/deviceCheck');

// ─────────────────────────────────────────────────────────────────
// Haversine — distance in metres between two GPS coords
// ─────────────────────────────────────────────────────────────────
function haversineMetres(lat1, lon1, lat2, lon2) {
  const R    = 6371000;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dPhi = ((lat2 - lat1) * Math.PI) / 180;
  const dLam = ((lon2 - lon1) * Math.PI) / 180;
  const a    = Math.sin(dPhi / 2) ** 2 +
               Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLam / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─────────────────────────────────────────────────────────────────
// Rectangular geofence check.
// Returns true if (lat, lng) is inside the rectangle centred at
// (cLat, cLng) with the given half-widths in metres.
// halfWidth  = width_m  / 2  (east-west)
// halfLength = length_m / 2  (north-south)
// Falls back to circular check (geofence_radius) when no rectangle defined.
// ─────────────────────────────────────────────────────────────────
function isInsideVenue(studentLat, studentLng, loc) {
  const cLat = parseFloat(loc.latitude);
  const cLng = parseFloat(loc.longitude);

  if (!Number.isFinite(cLat) || !Number.isFinite(cLng)) return true; // no coords → allow

  const hasRect = loc.width_m > 0 && loc.length_m > 0;

  if (hasRect) {
    // Convert degree offsets to metres (approximate, valid for small distances)
    const metersPerDegLat = 111320;
    const metersPerDegLng = 111320 * Math.cos(cLat * Math.PI / 180);

    const dNorth = (studentLat - cLat) * metersPerDegLat;   // + = north
    const dEast  = (studentLng - cLng) * metersPerDegLng;   // + = east

    const halfLen = parseFloat(loc.length_m) / 2;  // north-south
    const halfWid = parseFloat(loc.width_m)  / 2;  // east-west

    return Math.abs(dNorth) <= halfLen && Math.abs(dEast) <= halfWid;
  }

  // Fallback: circular
  const radius = Math.max(30, parseFloat(loc.geofence_radius) || 50);
  const dist   = haversineMetres(studentLat, studentLng, cLat, cLng);
  return dist <= radius;
}

// ─────────────────────────────────────────────────────────────────
// POST /api/attendance/clock-in  (legacy — kept for compat)
// ─────────────────────────────────────────────────────────────────
async function clockIn(req, res) {
  try {
    const studentId = req.user.id;
    const { clock_in_id, qr_token, fingerprint, latitude, longitude, accuracy } = req.body;
    const clientIP  = req.clientIP;
    const clientMAC = req.clientMAC;
    const today     = new Date().toISOString().split('T')[0];

    const { data: student, error: studentErr } = await supabase
      .from('students').select('id, full_name, clock_in_id').eq('id', studentId).single();
    if (studentErr || !student) return res.status(404).json({ error: 'Student not found' });
    if (student.clock_in_id !== clock_in_id) return res.status(400).json({ error: 'Invalid Clock-In ID' });

    const { data: existing, error: existingErr } = await supabase
      .from('attendance').select('id, clock_in_time, clock_out_time')
      .eq('student_id', studentId).eq('date', today).maybeSingle();
    if (existingErr) return res.status(500).json({ error: 'Failed to check existing attendance' });
    if (existing?.clock_in_time) return res.status(409).json({ error: 'You have already clocked in today.', code: 'ALREADY_CLOCKED_IN' });

    let locationId = null;
    if (qr_token) {
      const { data: qr } = await supabase.from('qr_codes')
        .select('id, location_id, expires_at, is_active').eq('token', qr_token).eq('valid_date', today).single();
      if (!qr?.is_active || new Date(qr.expires_at) < new Date())
        return res.status(400).json({ error: 'Invalid or expired QR code', code: 'INVALID_QR' });
      locationId = qr.location_id;
    }

    const now    = new Date();
    const status = now.getHours() >= 9 ? 'late' : 'present';

    const { data: record, error: insertErr } = await supabase.from('attendance').insert({
      student_id: studentId, location_id: locationId,
      clock_in_time: now.toISOString(), ip_address: clientIP, mac_address: clientMAC,
      device_fingerprint: fingerprint || null,
      latitude: Number.isFinite(latitude) ? latitude : null,
      longitude: Number.isFinite(longitude) ? longitude : null,
      location_accuracy: Number.isFinite(accuracy) ? accuracy : null,
      date: today, qr_used: !!qr_token, status
    }).select().single();
    if (insertErr) return res.status(500).json({ error: 'Failed to record attendance' });
    return res.status(201).json({ message: `Clocked in! Status: ${status}`, attendance: record });
  } catch (err) {
    console.error('clockIn error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ─────────────────────────────────────────────────────────────────
// POST /api/attendance/clock-out  (legacy)
// ─────────────────────────────────────────────────────────────────
async function clockOut(req, res) {
  try {
    const studentId = req.user.id;
    const today     = new Date().toISOString().split('T')[0];
    const { data: record, error } = await supabase.from('attendance')
      .select('id, clock_in_time, clock_out_time').eq('student_id', studentId).eq('date', today).maybeSingle();
    if (error) return res.status(500).json({ error: 'Failed to fetch today\'s attendance' });
    if (!record) return res.status(404).json({ error: 'No clock-in found for today.' });
    if (record.clock_out_time) return res.status(409).json({ error: 'Already clocked out today.' });
    const now = new Date().toISOString();
    const { data: updated, error: updateErr } = await supabase.from('attendance')
      .update({ clock_out_time: now }).eq('id', record.id).select().single();
    if (updateErr) return res.status(500).json({ error: 'Failed to record clock-out' });
    const ms   = new Date(now) - new Date(record.clock_in_time);
    const hrs  = Math.floor(ms / 3600000);
    const mins = Math.floor((ms % 3600000) / 60000);
    return res.json({ message: `Clocked out! You worked ${hrs}h ${mins}m.`, attendance: updated });
  } catch (err) {
    console.error('clockOut error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ─────────────────────────────────────────────────────────────────
// GET /api/attendance/my
// ─────────────────────────────────────────────────────────────────
async function getMyAttendance(req, res) {
  try {
    const studentId = req.user.id;
    const { month, year } = req.query;
    let query = supabase.from('attendance')
      .select('id, date, clock_in_time, clock_out_time, status, qr_used, locations(name, address)')
      .eq('student_id', studentId).order('date', { ascending: false });
    if (month && year) {
      const start = `${year}-${String(month).padStart(2,'0')}-01`;
      const end   = new Date(year, month, 0).toISOString().split('T')[0];
      query = query.gte('date', start).lte('date', end);
    }
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: 'Failed to fetch attendance' });
    return res.json({ attendance: data || [] });
  } catch (err) {
    console.error('getMyAttendance error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ─────────────────────────────────────────────────────────────────
// GET /api/attendance/today  — Admin
// ─────────────────────────────────────────────────────────────────
async function getTodayAttendance(req, res) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const { data, error } = await supabase.from('attendance').select(`
      id, date, clock_in_time, clock_out_time, status, qr_used,
      ip_address, mac_address, device_fingerprint, latitude, longitude, location_accuracy,
      students(id, full_name, student_number, clock_in_id),
      locations(name)
    `).eq('date', today).order('clock_in_time', { ascending: true });
    if (error) return res.status(500).json({ error: 'Failed to fetch attendance' });
    return res.json({ date: today, count: data.length, attendance: data || [] });
  } catch (err) {
    console.error('getTodayAttendance error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ─────────────────────────────────────────────────────────────────
// GET /api/attendance/all  — Admin
// ─────────────────────────────────────────────────────────────────
async function getAllAttendance(req, res) {
  try {
    const { date, student_id, month, year, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;
    let query = supabase.from('attendance').select(`
      id, date, clock_in_time, clock_out_time, status, qr_used,
      ip_address, mac_address, device_fingerprint, latitude, longitude, location_accuracy,
      students(id, full_name, student_number, clock_in_id),
      locations(name)
    `, { count: 'exact' })
      .order('date', { ascending: false })
      .order('clock_in_time', { ascending: false })
      .range(offset, offset + limit - 1);
    if (date)       query = query.eq('date', date);
    if (student_id) query = query.eq('student_id', student_id);
    if (month && year) {
      const start = `${year}-${String(month).padStart(2,'0')}-01`;
      const end   = new Date(year, month, 0).toISOString().split('T')[0];
      query = query.gte('date', start).lte('date', end);
    }
    const { data, error, count } = await query;
    if (error) return res.status(500).json({ error: 'Failed to fetch attendance' });
    return res.json({ total: count, page: Number(page), limit: Number(limit), attendance: data || [] });
  } catch (err) {
    console.error('getAllAttendance error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ─────────────────────────────────────────────────────────────────
// PATCH /api/attendance/:id  — Admin override
// ─────────────────────────────────────────────────────────────────
async function overrideAttendance(req, res) {
  try {
    const { id } = req.params;
    const { clock_in_time, clock_out_time, status } = req.body;
    const updates = {};
    if (clock_in_time)  updates.clock_in_time  = clock_in_time;
    if (clock_out_time) updates.clock_out_time = clock_out_time;
    if (status)         updates.status         = status;
    const { data, error } = await supabase.from('attendance').update(updates).eq('id', id).select().single();
    if (error) return res.status(500).json({ error: 'Failed to update attendance record' });
    return res.json({ message: 'Attendance record updated', attendance: data });
  } catch (err) {
    console.error('overrideAttendance error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ─────────────────────────────────────────────────────────────────
// GET /api/attendance/stats/:studentId
// ─────────────────────────────────────────────────────────────────
async function getStats(req, res) {
  try {
    const studentId = req.params.studentId || req.user.id;
    if (req.user.role !== 'admin' && studentId !== req.user.id)
      return res.status(403).json({ error: 'Forbidden' });

    const { data: records, error: attErr } = await supabase.from('attendance')
      .select('date, status, clock_in_time, clock_out_time')
      .eq('student_id', studentId).order('date', { ascending: false });
    if (attErr) return res.status(500).json({ error: 'Failed to fetch stats' });

    const { data: workingDays } = await supabase.from('working_days').select('day_of_week, is_working');
    const DEFAULT_WORKING_DAYS = new Set([1,2,3,4,5]);
    const workingDaySet = (workingDays?.length > 0)
      ? new Set(workingDays.filter(d => d.is_working).map(d => d.day_of_week))
      : DEFAULT_WORKING_DAYS;

    const present       = records.filter(r => r.status === 'present').length;
    const late          = records.filter(r => r.status === 'late').length;
    const attendedDates = new Set(records.map(r => r.date));

    let absent = 0;
    if (records.length > 0) {
      const firstDate = new Date(records[records.length - 1].date + 'T00:00:00');
      const todayStr  = new Date().toISOString().split('T')[0];
      const cursor    = new Date(firstDate);
      while (true) {
        const dateStr = cursor.toISOString().split('T')[0];
        if (dateStr >= todayStr) break;
        if (workingDaySet.has(cursor.getDay()) && !attendedDates.has(dateStr)) absent++;
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    let streak = 0;
    {
      const cursor = new Date(); cursor.setDate(cursor.getDate() - 1);
      for (let i = 0; i < 365; i++) {
        const dateStr = cursor.toISOString().split('T')[0];
        const dow     = cursor.getDay();
        if (!workingDaySet.has(dow)) { cursor.setDate(cursor.getDate() - 1); continue; }
        if (attendedDates.has(dateStr)) streak++;
        else break;
        cursor.setDate(cursor.getDate() - 1);
      }
    }

    return res.json({ total_days: records.length, present, late, absent, streak, records });
  } catch (err) {
    console.error('getStats error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ─────────────────────────────────────────────────────────────────
// POST /api/attendance/punch
//
// FLOW:
//  1. Authenticate student via clock_in_id
//  2. Check that an active session exists for today
//  3. GPS check against rectangular venue (optional — soft warning only)
//  4. Clock in or clock out
// ─────────────────────────────────────────────────────────────────
async function clockPunch(req, res) {
  try {
    const { clock_in_id, fingerprint, qr_token, latitude, longitude, accuracy } = req.body;
    const clientIP  = getClientIP(req);
    const clientMAC = getClientMAC(req);

    if (!clock_in_id) return res.status(400).json({ error: 'Clock-In ID is required' });

    // ── 1. Find student ──────────────────────────────────────────
    const { data: student, error: studentErr } = await supabase
      .from('students')
      .select('id, full_name, email, student_number, clock_in_id, registered_ip, registered_mac, device_fingerprint, is_active')
      .eq('clock_in_id', clock_in_id.trim().toUpperCase())
      .single();

    if (studentErr || !student)
      return res.status(401).json({ error: 'This Tracking ID is not registered. Check and try again.' });
    if (!student.is_active)
      return res.status(403).json({ error: 'Your account is deactivated. Contact admin.' });

    // ── 2. Device binding ────────────────────────────────────────
    if (!student.registered_ip && !student.registered_mac && !student.device_fingerprint) {
      await supabase.from('students')
        .update({ registered_ip: clientIP, registered_mac: clientMAC, device_fingerprint: fingerprint || null })
        .eq('id', student.id);
    } else {
      if (process.env.NODE_ENV === 'production') {
        const ipMatch  = student.registered_ip === clientIP;
        const macMatch = student.registered_mac && clientMAC ? student.registered_mac === clientMAC : false;
        const fpMatch  = student.device_fingerprint && fingerprint ? student.device_fingerprint === fingerprint : false;
        const deviceMatch = student.registered_mac ? macMatch : ipMatch || fpMatch;
        if (!deviceMatch) return res.status(403).json({
          error: 'This Tracking ID is registered to a different device.',
          code: 'DEVICE_MISMATCH'
        });
      }
    }

    const { signToken } = require('../utils/tokenHelper');
    const token = signToken({ id: student.id, email: student.email, role: 'student' });
    const today = new Date().toISOString().split('T')[0];

    // ── 3. Require an active session ─────────────────────────────
    let locationId = null;
    let loc        = null;

    const { data: session, error: sessErr } = await supabase
      .from('attendance_sessions')
      .select('id, location_id, locations(id, name, latitude, longitude, width_m, length_m, geofence_radius)')
      .eq('session_date', today)
      .eq('is_active', true)
      .maybeSingle();

    // If table is missing, fall back to no-session mode (allow clock-in without session)
    const tableMissing = sessErr &&
      (sessErr.code === '42P01' ||
       sessErr.message?.includes('does not exist') ||
       sessErr.message?.includes('schema cache'));

    if (!tableMissing && !session) {
      return res.status(403).json({
        error: 'No active session today. Ask your admin to open a session before you can clock in.',
        code:  'NO_ACTIVE_SESSION'
      });
    }

    if (session) {
      loc        = session.locations;
      locationId = session.location_id;
    }

    // ── 4. GPS venue check ───────────────────────────────────────
    // If venue has dimensions AND student provided GPS → enforce the boundary
    let gpsWarning = null;
    if (loc && Number.isFinite(latitude) && Number.isFinite(longitude)) {
      const cLat = parseFloat(loc.latitude);
      const cLng = parseFloat(loc.longitude);
      const hasCoords = Number.isFinite(cLat) && Number.isFinite(cLng);
      const hasRect   = loc.width_m > 0 && loc.length_m > 0;

      if (hasCoords) {
        const inside = isInsideVenue(latitude, longitude, loc);
        if (!inside) {
          if (hasRect) {
            const metersPerDegLat = 111320;
            const metersPerDegLng = 111320 * Math.cos(cLat * Math.PI / 180);
            const dN = Math.abs((latitude  - cLat) * metersPerDegLat).toFixed(1);
            const dE = Math.abs((longitude - cLng) * metersPerDegLng).toFixed(1);
            return res.status(403).json({
              error: `You are outside ${loc.name}. The venue is ${loc.width_m}m wide × ${loc.length_m}m long. You are approximately ${dN}m (N/S) and ${dE}m (E/W) from the centre. Move inside the venue and try again.`,
              code:  'OUTSIDE_VENUE'
            });
          } else {
            const dist = Math.round(haversineMetres(latitude, longitude, cLat, cLng));
            const radius = Math.max(30, parseFloat(loc.geofence_radius) || 50);
            return res.status(403).json({
              error: `You are ${dist}m from ${loc.name} (allowed radius: ${radius}m). Move closer and try again.`,
              code:  'OUTSIDE_VENUE',
              distance_metres: dist,
              radius_metres:   radius
            });
          }
        }
      }
    } else if (loc && loc.latitude && (loc.width_m > 0 || loc.geofence_radius > 0) &&
               (!Number.isFinite(latitude) || !Number.isFinite(longitude))) {
      // Location has boundaries but student didn't share GPS
      gpsWarning = `Location verification recommended. Enable GPS for accurate check-in at ${loc.name}.`;
    }

    // ── 5. Check existing record ─────────────────────────────────
    const { data: existing } = await supabase.from('attendance')
      .select('id, clock_in_time, clock_out_time, status')
      .eq('student_id', student.id).eq('date', today).maybeSingle();

    // ── 6. Clock IN ──────────────────────────────────────────────
    if (!existing || !existing.clock_in_time) {
      const now    = new Date();
      const status = now.getHours() >= 9 ? 'late' : 'present';

      const { data: record, error: insertErr } = await supabase.from('attendance').insert({
        student_id:         student.id,
        location_id:        locationId,
        clock_in_time:      now.toISOString(),
        clock_out_time:     now.toISOString(), // auto set; overwritten on explicit clock-out
        ip_address:         clientIP,
        mac_address:        clientMAC,
        device_fingerprint: fingerprint || null,
        latitude:           Number.isFinite(latitude)  ? latitude  : null,
        longitude:          Number.isFinite(longitude) ? longitude : null,
        location_accuracy:  Number.isFinite(accuracy)  ? accuracy  : null,
        date:               today,
        qr_used:            !!qr_token,
        status
      }).select('*, locations(name)').single();

      if (insertErr) {
        console.error('clockPunch insert error:', insertErr);
        return res.status(500).json({ error: 'Failed to record clock-in' });
      }

      return res.status(201).json({
        action:     'clocked_in',
        message:    `Attendance recorded for ${student.full_name}. Status: ${status}.${gpsWarning ? ' ⚠️ ' + gpsWarning : ''}`,
        gps_warning: gpsWarning,
        venue:      loc?.name || null,
        student:    { id: student.id, full_name: student.full_name, clock_in_id: student.clock_in_id, role: 'student' },
        attendance: record,
        token
      });
    }

    // ── 7. Clock OUT ─────────────────────────────────────────────
    if (!existing.clock_out_time || existing.clock_out_time === existing.clock_in_time) {
      const now = new Date().toISOString();
      const { data: updated, error: updateErr } = await supabase.from('attendance')
        .update({ clock_out_time: now }).eq('id', existing.id).select('*, locations(name)').single();
      if (updateErr) return res.status(500).json({ error: 'Failed to record clock-out' });

      const ms   = new Date(now) - new Date(existing.clock_in_time);
      const hrs  = Math.floor(ms / 3600000);
      const mins = Math.floor((ms % 3600000) / 60000);
      return res.json({
        action:     'clocked_out',
        message:    `Clocked out! You worked ${hrs}h ${mins}m today.`,
        student:    { id: student.id, full_name: student.full_name, clock_in_id: student.clock_in_id, role: 'student' },
        attendance: updated,
        token
      });
    }

    // ── 8. Already complete ──────────────────────────────────────
    const ci = new Date(existing.clock_in_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const co = new Date(existing.clock_out_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    return res.status(409).json({
      action:     'already_complete',
      error:      `Attendance already complete today (${ci} → ${co}).`,
      code:       'ALREADY_COMPLETE',
      attendance: existing,
      token
    });

  } catch (err) {
    console.error('clockPunch error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  clockIn, clockOut, clockPunch,
  getMyAttendance, getTodayAttendance, getAllAttendance,
  overrideAttendance, getStats
};
