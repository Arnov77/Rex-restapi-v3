const fs = require("fs");
const path = require("path");
const mime = require("mime-types");
const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const utils = require("../utils/utils");
const config = require('../../config');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const model = genAI.getGenerativeModel({
  model: "gemini-2.0-flash-preview-image-generation",
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
    const { image, option } = req.query; // Ambil parameter 'option' dari query
    if (!image) return res.status(400).json({ status: 400, message: "Parameter 'image' diperlukan" });
  
    try {
      const response = await axios.get(image, { responseType: "arraybuffer" });
      const mimeType = response.headers["content-type"];
      const buffer = Buffer.from(response.data);
      const base64 = buffer.toString("base64");
  
      // Tentukan prompt berdasarkan opsi
      let prompt = "";
      if (option === "nerd") {
        prompt = "Ubah karakter anime ini menjadi terlihat seperti 'nerd'. " +
                 "Tambahkan kacamata besar berwarna hitam, gigi depan besar (gigi kelinci), dan ekspresi wajah kikuk seperti nerd. " +
                 "Selain itu, ubah warna kulitnya menjadi hitam, tapi pertahankan detail, tekstur, dan shading alami agar tetap realistis. " +
                 "Jangan ubah rambut atau pakaian, dan biarkan latar belakang tetap seperti aslinya.";
      } else if (option === "hitam") {
        prompt = "Ubah karakter anime ini menjadi memiliki warna kulit hitam. " +
                 "Pertahankan detail, tekstur, dan shading alami agar tetap realistis. " +
                 "Jangan ubah rambut, pakaian, atau latar belakang.";
      } else {
        return res.status(400).json({ status: 400, message: "Opsi tidak valid. Gunakan 'nerd' atau 'hitam'." });
      }
  
      const result = await model.generateContent({
        generationConfig,
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt },
              { inlineData: { mimeType, data: base64 } },
            ],
          },
        ],
      });
  
      const candidates = result.response.candidates;
      const part = candidates[0].content.parts.find((p) => p.inlineData);
  
      if (!part) return res.status(500).json({ status: 500, message: "Gagal mendapatkan gambar hasil." });
  
      const resultBuffer = Buffer.from(part.inlineData.data, "base64");
      const uploadedUrl = await utils.uploadToTmpfiles(resultBuffer, `blackened-waifu.${mime.extension(part.inlineData.mimeType)}`);
  
      res.json({
        status: 200,
        creator: config.creator,
        message: "Gosong wak!",
        result: uploadedUrl,
      });
  
    } catch (err) {
      res.status(500).json({ status: 500, message: utils.getError(err) });
    }
  };
  
  module.exports = { blackWaifuGemini };
