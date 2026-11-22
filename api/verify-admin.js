// api/verify-admin.js
// Vercel Serverless Function (Node.js) - Verifikasi Otorisasi PIN Admin Master & Pembuatan Token Sesi HMAC-SHA256

const crypto = require('crypto');

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

  // Hanya izinkan metode POST
  if (req.method !== 'POST') {
    return res.status(405).json({
      ok: false,
      error: 'Method not allowed. Gunakan metode POST.'
    });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (parseErr) {
        return res.status(400).json({ ok: false, error: 'Format JSON request body tidak valid.' });
      }
    }

    const { pin } = body || {};
    if (!pin) {
      return res.status(400).json({
        ok: false,
        error: 'Kode PIN Admin wajib diisi.'
      });
    }

    // Ambil PIN rahasia dari environment variable serverless process.env.ADMIN_PIN
    const secretPin = process.env.ADMIN_PIN || 'admin123';

    // Verifikasi PIN
    if (String(pin).trim() !== String(secretPin).trim()) {
      return res.status(401).json({
        ok: false,
        error: 'Kode PIN Admin salah. Akses ditolak.'
      });
    }

    // Buat token sesi bertanda tangan HMAC-SHA256 berlaku 4 jam
    const expiresInMs = 4 * 60 * 60 * 1000; // 4 jam
    const expiresAt = Date.now() + expiresInMs;
    const payload = `${expiresAt}`;
    const signature = crypto.createHmac('sha256', secretPin).update(payload).digest('hex');
    const adminToken = `${payload}.${signature}`;

    return res.status(200).json({
      ok: true,
      adminToken: adminToken,
      expiresAt: expiresAt,
      expiresIn: 14400 // detik
    });
  } catch (error) {
    console.error('Error pada api/verify-admin:', error);
    return res.status(500).json({
      ok: false,
      error: 'Terjadi kesalahan internal saat memverifikasi PIN Admin.'
    });
  }
};
