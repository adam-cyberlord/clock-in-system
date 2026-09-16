const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin, requireStudent } = require('../middleware/auth');
const { validateDevice } = require('../middleware/deviceCheck');
const {
  clockIn, clockOut, clockPunch,
  getMyAttendance, getTodayAttendance, getAllAttendance,
  overrideAttendance, getStats
} = require('../controllers/attendanceController');
const { getActiveSession } = require('../controllers/adminController');

// ── Public session check (students poll this before punching) ──
router.get('/session/active', getActiveSession);

// ── Student routes ─────────────────────────────────────────────
router.post('/clock-in',  requireAuth, requireStudent, validateDevice, clockIn);
router.post('/clock-out', requireAuth, requireStudent, clockOut);
router.post('/punch',     clockPunch);
router.get('/my',         requireAuth, requireStudent, getMyAttendance);
router.get('/stats/me',   requireAuth, requireStudent, (req, res, next) => { req.params.studentId = req.user.id; next(); }, getStats);

// ── Admin routes ───────────────────────────────────────────────
router.get('/today',             requireAuth, requireAdmin, getTodayAttendance);
router.get('/all',               requireAuth, requireAdmin, getAllAttendance);
router.patch('/:id',             requireAuth, requireAdmin, overrideAttendance);
router.get('/stats/:studentId',  requireAuth, requireAdmin, getStats);

module.exports = router;
