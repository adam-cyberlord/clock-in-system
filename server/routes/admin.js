const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const {
  createLocation,
  updateLocation,
  getLocations,
  openSession,
  closeSession,
  getTodaySession,
  getActiveSession,
  generateDailyQR,
  getTodayQR,
  getAllStudents,
  toggleStudentStatus,
  getDashboardStats,
  getWorkingDays,
  updateWorkingDays
} = require('../controllers/adminController');

// All routes here require admin auth
router.use(requireAuth, requireAdmin);

// Dashboard
router.get('/stats', getDashboardStats);

// Locations
router.get('/locations',       getLocations);
router.post('/locations',      createLocation);
router.patch('/locations/:id', updateLocation);

// Sessions (admin-authenticated)
router.post('/session/open',   openSession);
router.post('/session/close',  closeSession);
router.get('/session/today',   getTodaySession);

// QR Codes
router.post('/qr/generate', generateDailyQR);
router.get('/qr/today',     getTodayQR);

// Students
router.get('/students',        getAllStudents);
router.patch('/students/:id',  toggleStudentStatus);

// Working days
router.get('/working-days',    getWorkingDays);
router.put('/working-days',    updateWorkingDays);

module.exports = router;
