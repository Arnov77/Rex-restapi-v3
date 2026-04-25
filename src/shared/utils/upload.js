const axios = require('axios');
const FormData = require('form-data');

const MAX_REMOTE_FILE_SIZE = 5 * 1024 * 1024;

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

function buildDiscordWebhookUrl(webhookUrl) {
  const url = new URL(webhookUrl);
  url.searchParams.set('wait', 'true');
  return url.toString();
}

async function uploadToDiscordWebhook(fileBuffer, fileName, contentType) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;

  if (!webhookUrl) {
    throw new Error('DISCORD_WEBHOOK_URL belum diatur');
  }

  const form = new FormData();
  form.append(
    'payload_json',
    JSON.stringify({
      content: `MIQ avatar upload: ${fileName}`,
      allowed_mentions: { parse: [] },
    })
  );
  form.append('files[0]', fileBuffer, {
    filename: fileName,
    contentType: contentType || 'application/octet-stream',
  });

  try {
    const response = await axios.post(buildDiscordWebhookUrl(webhookUrl), form, {
      headers: { ...form.getHeaders() },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    const uploadedUrl = response.data?.attachments?.[0]?.url;
    if (!uploadedUrl) {
      throw new Error('Discord tidak mengembalikan URL attachment');
    }

    return uploadedUrl;
  } catch (error) {
    const details = error.response?.data ? JSON.stringify(error.response.data) : error.message;
    throw new Error(`Gagal upload ke Discord webhook: ${details}`);
  }
}

function getFileNameFromUrl(url, fallback = 'avatar.png') {
  try {
    const pathname = new URL(url).pathname;
    const lastSegment = pathname.split('/').filter(Boolean).pop();
    return lastSegment || fallback;
  } catch {
    return fallback;
  }
}

async function fetchRemoteImage(url) {
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      maxBodyLength: MAX_REMOTE_FILE_SIZE,
      maxContentLength: MAX_REMOTE_FILE_SIZE,
      timeout: 20000,
      validateStatus: (status) => status >= 200 && status < 400,
    });

    const contentType = String(response.headers['content-type'] || '');
    if (!contentType.startsWith('image/')) {
      throw new Error('URL tidak mengarah ke file gambar');
    }

    return {
      buffer: Buffer.from(response.data),
      contentType,
      fileName: getFileNameFromUrl(url),
    };
  } catch (error) {
    const details = error.response?.status ? `status ${error.response.status}` : error.message;
    throw new Error(`Gagal mengambil avatar dari URL: ${details}`);
  }
}

module.exports = { uploadToTmpfiles, uploadToDiscordWebhook, fetchRemoteImage };
