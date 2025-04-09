const express = require('express');
const router = express.Router();
const { instagram } = require('majidapi/modules/social');
const config = require('../../config');

router.all('/', async (req, res) => {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ status: 405, message: 'Method Not Allowed' });
  }

  try {
    const obj = req.method === 'GET' ? req.query : req.body;
    const { url, username, highlightId } = obj;

    let method, input;

    if (url) {
      method = 'download';
      input = { method, url: url.trim() };
    } else if (highlightId) {
      method = 'highlight';
      input = { method, highlightId: highlightId.trim() };
    } else if (username) {
      const storyCheck = obj.stories;
      const highlightCheck = obj.highlights;
      const profileCheck = obj.profile;

      if (storyCheck) method = 'stories';
      else if (highlightCheck) method = 'highlights';
      else method = 'profile';

      input = { method, username: username.trim() };
    } else {
      return res.status(400).json({ status: 400, message: "Minimal salah satu parameter ('url', 'username', 'highlightId') diperlukan" });
    }

    const result = await instagram(input);

    // Rapikan response jika method = download
    let responseData = result;
    if (method === 'download') {
      const isVideo = !!result.video || (result.medias && result.medias[0]?.endsWith('.mp4'));
      const isImage = result.images && result.images.length > 0;

      responseData = {
        caption: result.caption,
        type: isVideo ? 'video' : 'image',
        video: isVideo ? result.video || result.medias?.[0] : null,
        images: isImage ? result.images : null,
        thumbnail: result.images?.[0] || null,
      };
    }

    res.json({
      status: 200,
      creator: config.creator,
      method,
      data: responseData,
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ status: 500, message: error.message || 'Terjadi kesalahan' });
  }
});

module.exports = router;
