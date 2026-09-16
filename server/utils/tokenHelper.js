const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

/**
 * Signs a JWT for a user (admin or student).
 */
function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  });
}

/**
 * Generates a unique Clock-In ID for a student.
 * Format: OT-XXXXXXXX (8 uppercase alphanumeric characters)
 */
function generateClockInId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = 'OT-';
  for (let i = 0; i < 5; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Generates a secure random token for QR codes.
 */
function generateQRToken() {
  return uuidv4().replace(/-/g, '').substring(0, 32).toUpperCase();
}

module.exports = { signToken, generateClockInId, generateQRToken };
