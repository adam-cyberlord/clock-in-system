# 🔧 Oasis TimeMark — Troubleshooting Guide

## Common Issues & Solutions

### 1. Server Won't Start

**Error:** `Cannot find module 'express'`

**Solution:**
```bash
cd server
npm install
# Make sure all dependencies are installed
npm list
```

**Error:** `EADDRINUSE: address already in use :::3000`

**Solution:** Port 3000 is already in use
```bash
# Windows: Kill process on port 3000
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Mac/Linux:
lsof -ti:3000 | xargs kill -9

# Or use different port in .env:
PORT=3001
```

---

### 2. SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY Missing

**Error:** `Error: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env`

**Solution:**
1. Go to [supabase.com](https://supabase.com)
2. Create a project or open existing one
3. Go to **Settings → API**
4. Copy:
   - **Project URL** → `SUPABASE_URL`
   - **Service Role Key** → `SUPABASE_SERVICE_ROLE_KEY` (use the secret key, not the anon key)
5. Paste into `.env` file
6. Restart server

---

### 3. JWT_SECRET Not Set

**Error:** Tokens not being generated or verified

**Solution:**
In `.env`, make sure `JWT_SECRET` is set:
```env
JWT_SECRET=use-a-long-random-string-here-at-least-32-chars
```

Generate a random secret:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

### 4. CORS Error: "Not allowed by CORS"

**Error in browser:** `Cross-Origin Request Blocked`

**Solution:**
1. Check your frontend URL in `.env`
2. If using Live Server, it's typically `http://127.0.0.1:5500`
3. Update `FRONTEND_URL` in `.env`:
   ```env
   FRONTEND_URL=http://127.0.0.1:5500
   ```
4. Restart server
5. Hard refresh browser (Ctrl+Shift+R)

**Note:** Different ports (5500, 8000, 3001) are different origins!

---

### 5. Database Schema Not Working

**Error:** `relation "students" does not exist`

**Solution:**
1. Go to Supabase Dashboard
2. Open SQL Editor
3. Paste entire contents of `database/schema.sql`
4. Click "Run" button
5. Wait for completion (watch for green checkmarks)
6. Refresh page

**Common mistakes:**
- ❌ Only copying first few lines
- ❌ Running on wrong database
- ❌ Copy-paste into inline query editor instead of SQL Editor

---

### 6. "Invalid email or password" on Login

**Solution:**
1. Double-check email and password are correct
2. Make sure you're using the right account (admin vs student)
3. Try resetting password by contacting admin
4. Check browser console (F12 → Network) for actual error from server

**For first-time admin:**
```bash
curl -X POST http://localhost:3000/api/auth/admin/register \
  -H "Content-Type: application/json" \
  -d '{
    "full_name": "Your Name",
    "email": "your@email.com",
    "password": "YourPassword123!",
    "setup_key": "oasis-admin-setup-2026"
  }'
```

---

### 7. QR Code Not Scanning

**Problem:** Camera won't start on clock-in page

**Solution:**
1. Check browser permissions (allow camera when prompted)
2. Try different browser (Chrome/Edge work best)
3. Check if camera works in other apps
4. Hard refresh page (Ctrl+Shift+R)
5. Check console for errors (F12 → Console)

**For QR generation issues:**
1. Admin must create location first
2. Then generate daily QR for that location
3. QR expires at end of day (11:59:59 PM)

---

### 8. "Device not recognized" Error

**Error:** `Device not recognized. You must clock in from your registered device.`

**Solution:**
1. This happens in production mode when device fingerprint doesn't match
2. For development, set in `.env`:
   ```env
   NODE_ENV=development
   ```
   (This bypasses strict device checks)

3. First-time users should register from the device they'll use

4. If changing devices, contact admin to reset device binding

---

### 9. Can't Create Student Account

**Error:** `A student with this email already exists`

**Solution:**
- Each email can only be used once
- Use a unique email address
- Or ask admin to deactivate old account first

**Error:** `Student number already exists`

**Solution:**
- Each student number must be unique
- Use a different student ID
- Contact admin if you need to reset it

---

### 10. "You have already clocked in today"

**This is working correctly!** Students can only clock in once per day.

**Solution:**
- To test multiple clock-ins, use different dates
- Or wait until tomorrow
- Admin can override in attendance records

---

### 11. Frontend Won't Load

**Error:** `Connection refused` or blank page

**Solution:**
1. Make sure frontend server is running
2. Check you're using correct URL:
   - Live Server: `http://127.0.0.1:5500`
   - Python: `http://127.0.0.1:5000` or `http://127.0.0.1:8000`
3. Hard refresh (Ctrl+Shift+R)
4. Check console for JavaScript errors (F12 → Console)

---

### 12. LocalStorage Issues

**Problem:** Token gets cleared unexpectedly

**Solution:**
1. Check if browser is in private/incognito mode (doesn't keep localStorage)
2. Try regular browsing mode
3. Check if cookies are allowed
4. Clear cache and try again

---

### 13. API Base URL Not Correct

**Error:** `Network error — check your connection`

**Solution:**
In `client/js/api.js`, the API base URL auto-detects:
```javascript
const API_BASE_URL = (function () {
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') {
    return 'http://localhost:3000/api';
  }
  return window.location.origin + '/api';
})();
```

**To override** for production:
```javascript
const API_BASE_URL = 'https://your-api-domain.com/api';
```

---

### 14. "Too many requests" Rate Limiting

**Error:** `Too many requests, please slow down`

**Solution:**
- The API limiter now ignores frontend assets, so loading the website does not consume the API request budget.
- Development mode allows 300 API requests per 15 minutes and 60 authentication attempts per 15 minutes per IP.
- Production mode uses 100 API requests and 20 authentication attempts per 15 minutes per IP.
- Restart the server after changing the limiter configuration. Existing counters reset when the process restarts.

---

### 15. Fingerprinting Not Working

**Browser doesn't support:** Canvas, WebGL, or Audio fingerprint

**Solution:**
1. Try different browser (Chrome/Firefox preferred)
2. Check if JavaScript is enabled
3. Fallback fingerprinting still works (simpler hash)
4. In development mode, strict checks are disabled anyway

---

## Debugging Tips

### Enable Verbose Logging

**In `server/index.js`, uncomment:**
```javascript
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`, req.body);
  next();
});
```

### Check Network Requests

1. Open browser DevTools (F12)
2. Go to Network tab
3. Try your action (login, clock-in, etc.)
4. Click request and check:
   - Status code (200 = success, 401 = auth, 500 = server error)
   - Response body for error message
   - Headers for Authorization token

### Check Browser Console

1. Open DevTools (F12)
2. Go to Console tab
3. Look for red error messages
4. Click them to see full error details

### Check Server Logs

1. Look at terminal running `npm run dev`
2. Watch for error messages
3. Check Supabase error logs:
   - Supabase Dashboard → Logs

---

## Quick Restart

If things get weird, try:

```bash
# Kill server
Ctrl+C

# Clear node modules and reinstall
cd server
rm -rf node_modules package-lock.json
npm install

# Restart
npm run dev
```

---

## Still Stuck?

1. **Check the logs:**
   - Terminal running server
   - Browser console (F12)
   - Supabase logs

2. **Verify configuration:**
   - `.env` has all required values
   - FRONTEND_URL matches actual frontend URL
   - Database schema is fully executed

3. **Test endpoints directly:**
   ```bash
   curl http://localhost:3000/health
   ```
   Should return: `{"status":"ok","service":"Oasis TimeMark API",...}`

4. **Read spec.md** for architecture details

5. **Check code comments** in controllers for logic explanations

---

**Remember:** The system is designed to work in development mode (NODE_ENV=development), which bypasses strict device checks for easier testing.

Last Updated: September 2, 2026
