const fs = require("fs");
const path = require("path");
const axios = require("axios");
const mime = require("mime-types");
const { v4: uuidv4 } = require("uuid");
const { GoogleGenerativeAI } = require("@google/generative-ai");

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

async function fileToBase64(url) {
  const response = await axios.get(url, { responseType: "arraybuffer" });
  const buffer = Buffer.from(response.data, "binary");
  const mimeType = response.headers["content-type"];
  return {
    mimeType,
    data: buffer.toString("base64"),
    buffer,
  };
}

async function blackWaifuGemini(req, res) {
  const { image } = req.query;
  if (!image) return res.status(400).json({ error: "Parameter image diperlukan" });

  try {
    const imgData = await fileToBase64(image);

    const result = await model.generateContent({
      generationConfig,
      contents: [
        {
          role: "user",
          parts: [
            { text: "Ubah warna kulitnya menjadi hitam." },
            { inlineData: { mimeType: imgData.mimeType, data: imgData.data } },
          ],
        },
      ],
    });

    const candidates = result.response.candidates;
    const parts = candidates[0].content.parts;
    const imgPart = parts.find((p) => p.inlineData);

    if (!imgPart) return res.status(500).json({ error: "Tidak ada gambar hasil ditemukan" });

    const ext = mime.extension(imgPart.inlineData.mimeType);
    const filename = `waifu-blackened_${uuidv4()}.${ext}`;
    const outputPath = path.join(__dirname, "../../public/results", filename);

    fs.writeFileSync(outputPath, Buffer.from(imgPart.inlineData.data, "base64"));

    const publicUrl = `${req.protocol}://${req.get("host")}/results/${filename}`;
    res.json({ result: publicUrl });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Gagal menghitamkan waifu" });
  }
}

module.exports = { blackWaifuGemini };
