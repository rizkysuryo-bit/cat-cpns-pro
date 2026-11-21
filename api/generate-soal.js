// api/generate-soal.js
// Vercel Serverless Function (Node.js) - Native fetch tanpa library eksternal

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

    const { subtes, jumlah = 1, topik, apiKey } = body || {};

    if (!subtes) {
      return res.status(400).json({
        error: 'Field "subtes" wajib diisi (TWK, TIU, atau TKP).'
      });
    }

    const validSubtes = String(subtes).trim().toUpperCase();
    if (!['TWK', 'TIU', 'TKP'].includes(validSubtes)) {
      return res.status(400).json({
        error: 'Nilai "subtes" harus salah satu dari: TWK, TIU, atau TKP.'
      });
    }

    const count = Math.min(Math.max(parseInt(jumlah, 10) || 1, 1), 10);
    const topikSoal = topik ? String(topik).trim() : `Kisi-kisi Standar HOTS ${validSubtes} BKN 2026`;

    // Ambil Gemini API Key dari environment variable atau request body fallback
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

    const promptUser = `Buatkan ${count} butir soal pilihan ganda HOTS SKD CPNS dengan rincian:
- Subtes: ${validSubtes}
- Topik / Fokus Materi: ${topikSoal}
- Aturan Subtes: ${panduanSubtes}
- Format Kunci Jawaban: ${formatKunci}

Keluarkan data HANYA dalam bentuk JSON array objek soal dengan struktur persis seperti berikut:
[
  {
    "subtes": "${validSubtes}",
    "pertanyaan": "Teks soal HOTS lengkap...",
    "opsi_a": "Teks pilihan A",
    "opsi_b": "Teks pilihan B",
    "opsi_c": "Teks pilihan C",
    "opsi_d": "Teks pilihan D",
    "opsi_e": "Teks pilihan E",
    "kunci_atau_bobot": "${validSubtes === 'TKP' ? 'A:1,B:5,C:3,D:2,E:4' : 'A'}",
    "pembahasan": "Pembahasan rinci dan alasan penetapan kunci/bobot skor tertinggi."
  }
]`;

    // Panggil Gemini 2.5 Flash API menggunakan fetch bawaan
    const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`;

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
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              subtes: { type: 'STRING' },
              pertanyaan: { type: 'STRING' },
              opsi_a: { type: 'STRING' },
              opsi_b: { type: 'STRING' },
              opsi_c: { type: 'STRING' },
              opsi_d: { type: 'STRING' },
              opsi_e: { type: 'STRING' },
              kunci_atau_bobot: { type: 'STRING' },
              pembahasan: { type: 'STRING' }
            },
            required: [
              'subtes',
              'pertanyaan',
              'opsi_a',
              'opsi_b',
              'opsi_c',
              'opsi_d',
              'opsi_e',
              'kunci_atau_bobot',
              'pembahasan'
            ]
          }
        }
      }
    };

    const response = await fetch(geminiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(geminiPayload)
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({
        error: `Gagal memanggil Gemini API: ${response.status} ${response.statusText}`,
        details: errText
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

    // Bersihkan teks jika ada markdown code block
    let cleaned = rawContent.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.replace(/^```json/, '').replace(/```$/, '').trim();
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```/, '').replace(/```$/, '').trim();
    }

    let parsedQuestions;
    try {
      parsedQuestions = JSON.parse(cleaned);
    } catch (parseError) {
      return res.status(500).json({
        error: 'Gagal mengurai teks respon JSON dari Gemini.',
        details: parseError.message,
        rawText: rawContent
      });
    }

    // Pastikan hasil selalu berupa array
    let questionList = [];
    if (Array.isArray(parsedQuestions)) {
      questionList = parsedQuestions;
    } else if (parsedQuestions && typeof parsedQuestions === 'object') {
      if (Array.isArray(parsedQuestions.questions)) {
        questionList = parsedQuestions.questions;
      } else if (Array.isArray(parsedQuestions.soal)) {
        questionList = parsedQuestions.soal;
      } else {
        questionList = [parsedQuestions];
      }
    }

    // Normalisasi struktur output untuk memastikan setiap field sesuai kontrak
    const formattedResult = questionList.map(item => ({
      subtes: validSubtes,
      pertanyaan: item.pertanyaan || item.soal || '',
      opsi_a: item.opsi_a || item.a || '',
      opsi_b: item.opsi_b || item.b || '',
      opsi_c: item.opsi_c || item.c || '',
      opsi_d: item.opsi_d || item.d || '',
      opsi_e: item.opsi_e || item.e || '',
      kunci_atau_bobot: item.kunci_atau_bobot || item.kunci || (validSubtes === 'TKP' ? 'A:1,B:5,C:3,D:2,E:4' : 'A'),
      pembahasan: item.pembahasan || ''
    }));

    // Kembalikan respons JSON berupa array soal HOTS SKD CPNS
    return res.status(200).json(formattedResult);
  } catch (error) {
    console.error('Error pada api/generate-soal:', error);
    return res.status(500).json({
      error: 'Terjadi kesalahan internal pada server.',
      message: error.message
    });
  }
};
