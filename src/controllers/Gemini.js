const fs = require("fs");
const path = require("path");
const mime = require("mime-types");
const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const utils = require("../utils/utils");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const model = genAI.getGenerativeModel({
  model: "gemini-2.0-flash-exp-image-generation",
});

const generationConfig = {
  temperature: 1,
  topP: 0.95,
  topK: 40,
  maxOutputTokens: 8192,
  responseModalities: ["image", "text"],
  responseMimeType: "text/plain",
};

const blackWaifuGemini = async (req, res) => {
  const { image } = req.query;
  if (!image) return res.status(400).json({ status: false, message: "Parameter 'image' diperlukan" });

  try {
    const response = await axios.get(image, { responseType: "arraybuffer" });
    const mimeType = response.headers["content-type"];
    const buffer = Buffer.from(response.data);
    const base64 = buffer.toString("base64");

    const result = await model.generateContent({
        generationConfig,
        contents: [
          {
            role: "user",
            parts: [
              { 
                text: "Ubah hanya warna kulit karakter anime ini menjadi hitam, " +
                      "tanpa mengubah warna rambut, pakaian, mata, atau bagian lainnya. " +
                      "Pertahankan semua detail dan tekstur asli kecuali warna kulit. " +
                      "Gunakan shading alami untuk membuat kulit terlihat lebih gelap secara realistis."
              },
              { inlineData: { mimeType, data: base64 } },
            ],
          },
        ],
      });

    const candidates = result.response.candidates;
    const part = candidates[0].content.parts.find((p) => p.inlineData);

    if (!part) return res.status(500).json({ status: false, message: "Gagal mendapatkan gambar hasil." });

    const resultBuffer = Buffer.from(part.inlineData.data, "base64");
    const uploadedUrl = await utils.uploadToTmpfiles(resultBuffer, `blackened-waifu.${mime.extension(part.inlineData.mimeType)}`);

    res.json({
      status: true,
      message: "Gosong wak!",
      result: uploadedUrl,
    });

  } catch (err) {
    res.status(500).json({ status: false, message: utils.getError(err) });
  }
};

module.exports = { blackWaifuGemini };
