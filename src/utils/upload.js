const axios = require('axios');
const FormData = require('form-data');

async function uploadToTmpfiles(fileBuffer, fileName) {
  const form = new FormData();
  form.append('file', fileBuffer, { filename: fileName });

  try {
    const response = await axios.post('https://tmpfiles.org/api/v1/upload', form, {
      headers: { ...form.getHeaders() },
    });

    if (response.data.status === 'success') {
      return response.data.data.url;
    }

    throw new Error(`Upload gagal: ${response.data.message}`);
  } catch (error) {
    throw new Error(`Gagal mengunggah ke tmpfiles.org: ${error.message}`);
  }
}

module.exports = { uploadToTmpfiles };
