// api/generate-soal.js
// Vercel Serverless Function (Node.js) - Native fetch tanpa library eksternal

const crypto = require('crypto');

// In-memory rate limiter per IP / token: maksimal 10 request per menit
const rateLimitMap = new Map();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 menit

function isRateLimited(key) {
  const now = Date.now();
  if (rateLimitMap.size > 500) {
    for (const [k, v] of rateLimitMap.entries()) {
      if (now > v.resetAt) rateLimitMap.delete(k);
    }
  }

  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return true;
  }

  entry.count += 1;
  return false;
}

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

  // Hanya izinkan metode POST
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed. Gunakan metode POST.'
    });
  }

  // 1. Verifikasi Otorisasi Token Admin HMAC-SHA256 (Tanpa hardcoded fallback)
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Akses ditolak. Header Authorization: Bearer <adminToken> wajib disertakan.'
    });
  }

  const adminToken = authHeader.slice(7).trim();
  const secretPin = process.env.ADMIN_PIN;
  if (!secretPin) {
    console.error('ADMIN_PIN environment variable is not configured.');
    return res.status(500).json({
      error: 'Konfigurasi server bermasalah: ADMIN_PIN belum diatur di environment variable server.'
    });
  }

  if (!verifyAdminToken(adminToken, secretPin)) {
    return res.status(401).json({
      error: 'Sesi token otorisasi Admin tidak valid atau telah kedaluwarsa. Silakan masuk ulang sebagai Admin.'
    });
  }

  // 2. In-Memory Rate Limiter (Maksimal 10 request per menit)
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'client';
  const rateKey = `${clientIp}_${adminToken.slice(-12)}`;
  if (isRateLimited(rateKey)) {
    return res.status(429).json({
      error: 'Terlalu banyak permintaan generate soal (Rate limit tercapai). Maksimal 10 request per menit. Silakan tunggu beberapa saat.'
    });
  }

  try {
    // Ambil data request body
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (parseErr) {
        return res.status(400).json({ error: 'Format JSON request body tidak valid.' });
      }
    }

    const {
      subtest,
      subtes,
      count,
      jumlah = 1,
      topic,
      topik,
      difficulty,
      kesulitan,
      apiKey
    } = body || {};

    const rawSubtest = subtest || subtes;
    if (!rawSubtest) {
      return res.status(400).json({
        error: 'Field "subtest" (atau "subtes") wajib diisi (TWK, TIU, atau TKP).'
      });
    }

    const validSubtes = String(rawSubtest).trim().toUpperCase();
    if (!['TWK', 'TIU', 'TKP'].includes(validSubtes)) {
      return res.status(400).json({
        error: 'Nilai subtest harus salah satu dari: TWK, TIU, atau TKP.'
      });
    }

    const finalCount = Math.min(Math.max(parseInt(count || jumlah, 10) || 1, 1), 10);
    const topikSoal = (topic || topik || '').trim() || `Kisi-kisi Standar HOTS ${validSubtes} BKN 2026`;
    const tingkatKesulitan = (difficulty || kesulitan || '').trim() || 'HOTS Standar BKN 2026';

    // Ambil Gemini API Key dari environment variable process.env.GEMINI_API_KEY
    const geminiApiKey = process.env.GEMINI_API_KEY || apiKey;
    if (!geminiApiKey) {
      return res.status(500).json({
        error: 'GEMINI_API_KEY tidak ditemukan di environment variable process.env.GEMINI_API_KEY.'
      });
    }

    // Aturan spesifik per subtes SKD CPNS
    let formatKunci = 'Satu huruf kapital tunggal: "A", "B", "C", "D", atau "E".';
    let panduanSubtes = '';

    if (validSubtes === 'TKP') {
      formatKunci = 'Format wajib urutan bobot skor 1 sampai 5 untuk seluruh opsi A s/d E, contoh: "A:1,B:5,C:3,D:2,E:4". Setiap opsi harus memiliki bobot unik antara 1 hingga 5 (tidak boleh ada bobot ganda).';
      panduanSubtes = 'Materi TKP: Pelayanan Publik, Jejaring Kerja, Sosial Budaya, Teknologi Informasi dan Komunikasi, Profesionalisme, atau Anti Radikalisme. Berikan narasi studi kasus situasional dilematis ASN yang memerlukan pertimbangan pengambilan keputusan bijak dan berintegritas tinggi.';
    } else if (validSubtes === 'TWK') {
      formatKunci = 'Satu huruf kapital tunggal: "A", "B", "C", "D", atau "E".';
      panduanSubtes = 'Materi TWK: Nasionalisme, Integritas, Bela Negara, Pilar Negara (Pancasila, UUD 1945, NKRI, Bhinneka Tunggal Ika), atau Bahasa Negara. Soal harus bertipe HOTS (analisis wacana/kasus kebangsaan nyata), bukan sekadar hafalan tanggal atau teks undang-undang.';
    } else if (validSubtes === 'TIU') {
      formatKunci = 'Satu huruf kapital tunggal: "A", "B", "C", "D", atau "E".';
      panduanSubtes = 'Materi TIU: Kemampuan Verbal (Analogi, Silogisme, Analitis), Kemampuan Numerik (Berhitung, Deret Angka, Perbandingan Kuantitatif, Soal Cerita Logika), atau Kemampuan Figural. Pastikan logika matematika dan silogisme presisi tanpa multitafsir.';
    }

    const systemInstruction = `Anda adalah tim pakar pembuat soal resmi Seleksi Kompetensi Dasar (SKD) Calon Pegawai Negeri Sipil (CPNS) Republik Indonesia berstandar Badan Kepegawaian Negara (BKN) dan KemenPAN-RB terbaru.
Tugas Anda adalah memproduksi soal-soal berkualitas tinggi bertipe HOTS (Higher Order Thinking Skills).
Setiap soal harus memiliki 5 pilihan jawaban (A, B, C, D, E) dan pembahasan tuntas, logis, serta berlandaskan kaidah/regulasi resmi.`;

    const promptUser = `TUGAS UTAMA: Buatkan ${finalCount} butir soal pilihan ganda HOTS SKD CPNS yang WAJIB SECARA KETAT SESUAI DENGAN SPESIFIKASI BERIKUT:
- Subtes: ${validSubtes}
- TOPIK / KISI-KISI WAJIB: ${topikSoal} (DILARANG MEMBUAT TOPIK LAIN DI LUAR INI!)
- TINGKAT KESULITAN: ${tingkatKesulitan}
- Panduan Khusus Subtes: ${panduanSubtes}
- Format Kunci Jawaban: ${formatKunci}

PENTING: Seluruh soal yang dihasilkan HARUS BENAR-BENAR berfokus pada materi "${topikSoal}" dan tidak boleh menyimpang atau kembali ke topik umum/default lainnya.

Keluarkan data HANYA dalam format JSON valid dengan key baku persis seperti berikut:
{
  "questions": [
    {
      "question_text": "Teks soal HOTS lengkap sesuai materi topik...",
      "option_a": "Teks pilihan A",
      "option_b": "Teks pilihan B",
      "option_c": "Teks pilihan C",
      "option_d": "Teks pilihan D",
      "option_e": "Teks pilihan E",
      "correct_answer": "${validSubtes === 'TKP' ? 'A:1,B:5,C:3,D:2,E:4' : 'A'}",
      "explanation": "Pembahasan rinci dan kaidah logika/aturan penentuan jawaban.",
      "points": 5
    }
  ]
}`;

    const geminiPayload = {
      systemInstruction: {
        parts: [{ text: systemInstruction }]
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: promptUser }]
        }
      ],
      generationConfig: {
        temperature: 0.6,
        topP: 0.95,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            questions: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  question_text: { type: 'STRING' },
                  option_a: { type: 'STRING' },
                  option_b: { type: 'STRING' },
                  option_c: { type: 'STRING' },
                  option_d: { type: 'STRING' },
                  option_e: { type: 'STRING' },
                  correct_answer: { type: 'STRING' },
                  explanation: { type: 'STRING' },
                  points: { type: 'NUMBER' }
                },
                required: [
                  'question_text',
                  'option_a',
                  'option_b',
                  'option_c',
                  'option_d',
                  'option_e',
                  'correct_answer',
                  'explanation',
                  'points'
                ]
              }
            }
          },
          required: ['questions']
        }
      }
    };

    // Fungsi pemanggil Google Gemini REST API (Endpoint v1beta)
    async function requestGemini(modelName) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiApiKey}`;
      return await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(geminiPayload)
      });
    }

    // Panggil model utama: gemini-3.8-flash (sesuai arahan pengguna)
    let response = await requestGemini('gemini-3.8-flash');

    // Jika terjadi error selain 401/403 (misal status 404 jika model belum tersedia di region akun atau 503), coba fallback otomatis ke gemini-2.5-flash
    if (!response.ok && response.status !== 401 && response.status !== 403) {
      console.warn(`Panggilan ke gemini-3.8-flash menghasilkan status ${response.status}. Mencoba fallback ke gemini-2.5-flash...`);
      const fallbackResponse = await requestGemini('gemini-2.5-flash');
      if (fallbackResponse.ok) {
        response = fallbackResponse;
      }
    }

    if (!response.ok) {
      let errMessage = `Gagal memanggil Gemini API: ${response.status} ${response.statusText}`;
      let errDetails = null;

      try {
        const errData = await response.json();
        errDetails = errData;
        if (errData?.error?.message) {
          errMessage = errData.error.message;
        }
      } catch (jsonErr) {
        errDetails = await response.text().catch(() => null);
      }

      return res.status(response.status).json({
        error: errMessage,
        details: errDetails
      });
    }

    const geminiData = await response.json();
    const rawContent = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawContent) {
      return res.status(500).json({
        error: 'Respon dari Gemini API kosong atau tidak memiliki kandidat teks.',
        raw: geminiData
      });
    }

    // Bersihkan karakter markdown ```json atau ``` sebelum JSON.parse() agar tidak pernah gagal parsing
    let cleaned = rawContent.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    
    // Ekstrak blok JSON utuh jika terdapat teks pembuka/penutup
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleaned = jsonMatch[0];
    }

    let parsedResult;
    try {
      parsedResult = JSON.parse(cleaned);
    } catch (parseError) {
      return res.status(500).json({
        error: `Gagal mengurai respon Gemini API menjadi format JSON soal: ${parseError.message}`,
        details: parseError.message,
        rawText: rawContent
      });
    }

    // Ekstrak array soal
    let questionList = [];
    if (parsedResult && Array.isArray(parsedResult.questions)) {
      questionList = parsedResult.questions;
    } else if (Array.isArray(parsedResult)) {
      questionList = parsedResult;
    } else if (parsedResult && typeof parsedResult === 'object') {
      if (Array.isArray(parsedResult.soal)) {
        questionList = parsedResult.soal;
      } else {
        questionList = [parsedResult];
      }
    }

    // Normalisasi struktur output untuk memastikan setiap field sesuai kontrak baku
    const formattedQuestions = questionList.map(item => ({
      subtest: validSubtes,
      subtes: validSubtes,
      topic: topikSoal,
      topik: topikSoal,
      difficulty: tingkatKesulitan,
      tingkat_kesulitan: tingkatKesulitan,
      question_text: item.question_text || item.pertanyaan || '',
      pertanyaan: item.question_text || item.pertanyaan || '',
      option_a: item.option_a || item.opsi_a || '',
      opsi_a: item.option_a || item.opsi_a || '',
      option_b: item.option_b || item.opsi_b || '',
      opsi_b: item.option_b || item.opsi_b || '',
      option_c: item.option_c || item.opsi_c || '',
      opsi_c: item.option_c || item.opsi_c || '',
      option_d: item.option_d || item.opsi_d || '',
      opsi_d: item.option_d || item.opsi_d || '',
      option_e: item.option_e || item.opsi_e || '',
      opsi_e: item.option_e || item.opsi_e || '',
      correct_answer: item.correct_answer || item.kunci_atau_bobot || (validSubtes === 'TKP' ? 'A:1,B:5,C:3,D:2,E:4' : 'A'),
      kunci_atau_bobot: item.correct_answer || item.kunci_atau_bobot || (validSubtes === 'TKP' ? 'A:1,B:5,C:3,D:2,E:4' : 'A'),
      explanation: item.explanation || item.pembahasan || '',
      pembahasan: item.explanation || item.pembahasan || '',
      points: Number(item.points) || (validSubtes === 'TKP' ? 5 : 5)
    }));

    // Kembalikan respons JSON dengan key baku questions
    return res.status(200).json({ questions: formattedQuestions });
  } catch (error) {
    console.error('Error pada api/generate-soal:', error);
    return res.status(500).json({
      error: 'Terjadi kesalahan internal pada server.',
      message: error.message
    });
  }
};
