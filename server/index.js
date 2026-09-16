require('dotenv').config();
const path    = require('path');
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const rateLimit = require('express-rate-limit');

const authRoutes       = require('./routes/auth');
const attendanceRoutes = require('./routes/attendance');
const adminRoutes      = require('./routes/admin');
const qrRoutes         = require('./routes/qr');
const qrAdminRoutes    = require('./routes/qrAdmin');
const supabase         = require('./db/supabase');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────────
// Auto-migrate: create tables if missing
// ─────────────────────────────────────────────
async function ensureTables() {
  try {
    // Create attendance_sessions if it doesn't exist by attempting a small select.
    // Supabase PostgREST returns an error with code 42P01 (undefined_table).
    const { error } = await supabase.from('attendance_sessions').select('id').limit(1);
    if (error && (error.code === '42P01' || error.message?.includes('does not exist') || error.message?.includes('schema cache'))) {
      console.log('⚙️  Creating attendance_sessions table…');
      // Use the Supabase REST SQL endpoint via the JS client's rpc
      const { error: rpcErr } = await supabase.rpc('exec_sql', {
        sql: `
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
          CREATE INDEX IF NOT EXISTS idx_sessions_date_active
            ON attendance_sessions(session_date, is_active);
        `
      });
      if (rpcErr) {
        // rpc not available — log clear instructions instead of crashing
        console.warn('⚠️  Could not auto-create attendance_sessions table.');
        console.warn('   Please run the following SQL in your Supabase SQL Editor:');
        console.warn('─'.repeat(60));
        console.warn(`CREATE TABLE IF NOT EXISTS attendance_sessions (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  location_id  UUID REFERENCES locations(id) ON DELETE CASCADE,
  session_date DATE NOT NULL,
  opened_by    UUID REFERENCES admins(id),
  is_active    BOOLEAN DEFAULT true,
  opened_at    TIMESTAMPTZ DEFAULT NOW(),
  closed_at    TIMESTAMPTZ,
  note         TEXT,
  UNIQUE (session_date)
);`);
        console.warn('─'.repeat(60));
      } else {
        console.log('✅  attendance_sessions table created.');
      }
    } else {
      console.log('✅  attendance_sessions table OK.');
    }
  } catch (e) {
    console.warn('⚠️  Table check skipped:', e.message);
  }
}

// Also add width_m / length_m columns to locations if missing
async function ensureLocationColumns() {
  try {
    const { data } = await supabase.from('locations').select('width_m, length_m').limit(1);
    if (data !== null) console.log('✅  locations columns OK.');
  } catch (e) {
    console.warn('⚠️  locations column check skipped:', e.message);
  }
}

// ─────────────────────────────────────────────
// Security Middleware
// ─────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false
}));

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (Postman, curl, etc.)
    if (!origin) return callback(null, true);
    // Allow any localhost or 127.0.0.1 origin on any port
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    // Allow the configured FRONTEND_URL
    if (origin === process.env.FRONTEND_URL) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-device-fingerprint', 'x-device-mac', 'x-client-mac']
}));

// Rate limiting applies to API traffic only; static frontend assets should not
// consume the request budget while the app loads.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'development' ? 300 : 100,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a moment and try again.', code: 'RATE_LIMITED' }
});

// Stricter limit for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'development' ? 60 : 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please wait a moment and try again.', code: 'AUTH_RATE_LIMITED' }
});

app.use('/api', limiter);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ─────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────
app.use('/api/auth',       authLimiter, authRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/admin',      adminRoutes);

// ─────────────────────────────────────────────
// Health Check
// ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Oasis TimeMark API',
    timestamp: new Date().toISOString()
  });
});

// Serve the client app from the same origin as the API
const clientDir = path.join(__dirname, '..', 'client');
app.use(express.static(clientDir));
app.get('/', (req, res) => {
  res.sendFile(path.join(clientDir, 'index.html'));
});

// ─────────────────────────────────────────────
// 404 Handler
// ─────────────────────────────────────────────
app.use((req, res) => {
  if (req.path.startsWith('/api') || req.path === '/health') {
    return res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
  }
  res.sendFile(path.join(clientDir, 'index.html'));
});

// ─────────────────────────────────────────────
// Global Error Handler
// ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Something went wrong on the server' });
});

// ─────────────────────────────────────────────
// Start — with EADDRINUSE recovery
// ─────────────────────────────────────────────
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Oasis TimeMark running on http://localhost:${PORT}`);
  console.log(`🕒 Login page:   http://localhost:${PORT}/`);
  console.log(`📋 Health check: http://localhost:${PORT}/health`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}\n`);
  // Run non-blocking table checks after server is up
  ensureTables().catch(() => {});
  ensureLocationColumns().catch(() => {});
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Port ${PORT} is already in use.`);
    console.error(`   Fix: open Task Manager → find "node.exe" → End Task`);
    console.error(`   Then run start-server.bat again.\n`);
    process.exit(1);
  } else {
    throw err;
  }
});

module.exports = app;
