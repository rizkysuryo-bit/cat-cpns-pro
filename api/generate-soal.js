export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY belum diatur di Vercel Environment Variables.' });
  }

  try {
    const { subtest, topic, count = 5, difficulty = 'HOTS Standar BKN' } = req.body;

    const promptText = `Buatkan ${count} soal latihan CAT CPNS SKD subtes ${subtest} dengan topik "${topic || 'Umum SKD CPNS'}" tingkat kesulitan ${difficulty}.
Aturan wajib:
1. Setiap soal memiliki 5 pilihan jawaban (A, B, C, D, E).
2. Jika subtes adalah TWK atau TIU: tentukan 1 kunci jawaban benar (A/B/C/D/E) dengan skor 5 dan opsi lain 0.
3. Jika subtes adalah TKP: berikan bobot nilai berbeda pada setiap opsi (skor 5, 4, 3, 2, dan 1 tanpa ada skor 0).
4. Sertakan pembahasan yang jelas dan ringkas.
5. Kembalikan HANYA array JSON valid tanpa teks pembuka atau penutup dengan struktur persis seperti ini:
[
  {
    "question": "Teks pertanyaan soal...",
    "options": {
      "A": "Teks opsi A",
      "B": "Teks opsi B",
      "C": "Teks opsi C",
      "D": "Teks opsi D",
      "E": "Teks opsi E"
    },
    "correct_answer": "A",
    "scores": { "A": 5, "B": 0, "C": 0, "D": 0, "E": 0 },
    "explanation": "Penjelasan jawaban..."
  }
]`;

    // 1. Daftar seri Flash GRATIS (tanpa seri Pro yang limit-nya 0 di Free Tier)
    let candidateModels = [
      'gemini-3.8-flash',
      'gemini-3.8-flash-lite',
      'gemini-3.0-flash',
      'gemini-flash-latest'
    ];

    // 2. Cek daftar model resmi yang aktif pada API Key Anda dan tambahkan seri Flash yang tersedia
    try {
      const listRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
      if (listRes.ok) {
        const listData = await listRes.json();
        const availableFlash = (listData.models || [])
          .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
          .map(m => m.name.replace('models/', ''))
          .filter(name => name.includes('flash') && !name.includes('image') && !name.includes('audio'));
        candidateModels = [...new Set([...candidateModels, ...availableFlash])];
      }
    } catch (_) {}

    let lastError = '';

    for (const model of candidateModels) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: promptText }] }],
              generationConfig: {
                responseMimeType: 'application/json',
                temperature: 0.7,
              },
            }),
          }
        );

        const data = await response.json();

        if (response.ok && data.candidates?.[0]?.content?.parts?.[0]?.text) {
          let rawText = data.candidates[0].content.parts[0].text.trim();
          rawText = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
          const questions = JSON.parse(rawText);
          return res.status(200).json({ questions, modelUsed: model });
        }

        lastError = data.error?.message || `HTTP ${response.status} pada ${model}`;

        // Jika sibuk sementara (503/429), tunggu 1.5 detik lalu coba ulang; jika kuota 0 / tidak ada, langsung pindah model Flash berikutnya
        if ((response.status === 503 || response.status === 429) && !lastError.includes('limit: 0') && attempt === 1) {
          await new Promise((r) => setTimeout(r, 1500));
        } else {
          break;
        }
      }
    }

    return res.status(502).json({ error: lastError });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Terjadi kesalahan saat memproses AI.' });
  }
}
