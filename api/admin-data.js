// api/admin-data.js
// Vercel Serverless Function (Node.js) - Mengambil Data Real-Time Admin menggunakan SUPABASE_SERVICE_ROLE_KEY (Bypass RLS)

const crypto = require('crypto');

function verifyAdminToken(token, secretPin) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [expiresAtStr, signature] = parts;
  const expiresAt = parseInt(expiresAtStr, 10);
  if (isNaN(expiresAt) || Date.now() > expiresAt) return false;

  const expectedHmac = crypto.createHmac('sha256', secretPin).update(expiresAtStr).digest('hex');
  const sigBuf = Buffer.from(signature, 'hex');
  const expBuf = Buffer.from(expectedHmac, 'hex');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return false;
  }
  return true;
}

module.exports = async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  // Tangani preflight OPTIONS
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 1. Verifikasi Otorisasi Token Admin HMAC-SHA256
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      ok: false,
      error: 'Akses ditolak. Header Authorization: Bearer <adminToken> wajib disertakan.'
    });
  }

  const adminToken = authHeader.slice(7).trim();
  const secretPin = process.env.ADMIN_PIN;
  if (!secretPin) {
    return res.status(500).json({
      ok: false,
      error: 'Konfigurasi server bermasalah: ADMIN_PIN belum disetel di Dashboard Vercel.'
    });
  }

  if (!verifyAdminToken(adminToken, secretPin)) {
    return res.status(401).json({
      ok: false,
      error: 'Sesi token Admin tidak valid atau telah kedaluwarsa.'
    });
  }

  // 2. Konfigurasi Supabase Client Service Role
  const supabaseUrl = process.env.SUPABASE_URL || 'https://bgatryahknatngslgupn.supabase.co';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || 'sb_publishable_E9i-s-nOmDnnsqY24o53zw_v-Jr-u41';

  const defaultHeaders = {
    'apikey': serviceRoleKey,
    'Authorization': `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json'
  };

  try {
    // 3. Ambil data secara paralel dari tabel Supabase
    const [usersRes, tokensRes, attemptsRes, questionsRes] = await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/users?select=*&order=created_at.desc`, { headers: defaultHeaders }),
      fetch(`${supabaseUrl}/rest/v1/tokens?select=*&order=created_at.desc`, { headers: defaultHeaders }),
      fetch(`${supabaseUrl}/rest/v1/attempts?select=*&order=created_at.desc`, { headers: defaultHeaders }),
      fetch(`${supabaseUrl}/rest/v1/questions?select=*&order=created_at.desc`, { headers: defaultHeaders })
    ]);

    const users = usersRes.ok ? await usersRes.json() : [];
    const tokens = tokensRes.ok ? await tokensRes.json() : [];
    const attempts = attemptsRes.ok ? await attemptsRes.json() : [];
    const questions = questionsRes.ok ? await questionsRes.json() : [];

    return res.status(200).json({
      ok: true,
      users: Array.isArray(users) ? users : [],
      tokens: Array.isArray(tokens) ? tokens : [],
      attempts: Array.isArray(attempts) ? attempts : [],
      questions: Array.isArray(questions) ? questions : [],
      totalQuestions: Array.isArray(questions) ? questions.length : 0
    });
  } catch (error) {
    console.error('Error pada api/admin-data:', error);
    return res.status(500).json({
      ok: false,
      error: 'Gagal mengambil data dari Supabase via service role.',
      message: error.message
    });
  }
};
