const express = require('express');
const router = express.Router();
const { blackWaifuGemini } = require('../controllers/Gemini');
const config = require('../../config');

// Endpoint untuk menghitamkan waifu
router.all('/', async (req, res) => {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ status: 405, message: 'Method Not Allowed' });
  }

  try {
    const obj = req.method === 'GET' ? req.query : req.body;
    req.query.image = obj.image; // Set ulang query biar kompatibel dengan controller

    // Ambil parameter query "option"
    const option = req.query.option;
    if (option && !['nerd', 'hitam'].includes(option)) {
      return res.status(400).json({ status: 400, message: 'Invalid Option' });
    }

    req.query.option = option; // Tambahkan opsi ke query untuk diteruskan ke controller
    const response = await blackWaifuGemini(req, res);
    return response; // biar sesuai dengan controller-nya yang handle response langsung
  } catch (e) {
    console.error(e);
    res.status(500).json({ status: 500, message: utils.getError(e) });
  }
});

module.exports = router;
