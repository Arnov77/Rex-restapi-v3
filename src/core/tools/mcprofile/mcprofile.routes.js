const express = require('express');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache');
const sharp = require('sharp');
const ResponseHandler = require('../../../shared/utils/response');

const router = express.Router();

const MC_BASE = 'https://mcprofile.io';
const DEFAULT_STEVE = 'https://minotar.net/avatar/Steve/100';
const BEDROCK_PREFIXES = (process.env.BEDROCK_PREFIXES || '.')
  .split(';')
  .map((value) => value.trim())
  .filter(Boolean);

const cache = new NodeCache({ stdTTL: 300, checkperiod: 120 });
const limiter = rateLimit({ windowMs: 60_000, max: 60 });
router.use(limiter);

const fail = (message, status = 400) => {
  const err = new Error(message);
  err.status = status;
  throw err;
};

const cacheKey = (req) => `${req.path}?${new URLSearchParams(req.query).toString()}`;
const sendSuccess = (res, data, message = 'Minecraft profile fetched successfully') =>
  ResponseHandler.success(res, data, message, 200);
const sendError = (res, message, statusCode = 400) =>
  ResponseHandler.error(res, message, statusCode);

const hasBedrockPrefix = (name) => {
  if (!name) return false;
  const lower = String(name).toLowerCase();
  return BEDROCK_PREFIXES.some((prefix) => lower.startsWith(prefix.toLowerCase()));
};

const stripBedrockPrefix = (name) => {
  let value = String(name);
  for (const prefix of BEDROCK_PREFIXES) {
    if (value.toLowerCase().startsWith(prefix.toLowerCase())) {
      return value.slice(prefix.length);
    }
  }
  return value;
};

async function mcGet(path) {
  const url = `${MC_BASE}${path}`;
  const res = await axios.get(url, { timeout: 12_000 });
  return res.data;
}

const normalizeBedrockUsername = (name) => name.replace(/\s+/g, '_');
const denormalizeBedrockUsername = (name) => name.replace(/_/g, ' ');

async function tryBedrockGamertag(name) {
  try {
    return await mcGet(`/api/v1/bedrock/gamertag/${encodeURIComponent(name)}`);
  } catch {
    const alternative = name.includes(' ')
      ? normalizeBedrockUsername(name)
      : denormalizeBedrockUsername(name);

    if (alternative !== name) {
      return mcGet(`/api/v1/bedrock/gamertag/${encodeURIComponent(alternative)}`);
    }

    throw new Error('Bedrock gamertag lookup failed');
  }
}

function unify(mc, source) {
  const edition = source;
  const linked = Boolean(mc?.linked);
  const skinUrl =
    mc?.skin ?? (mc?.textureid ? `https://textures.minecraft.net/texture/${mc.textureid}` : null);

  const out = {
    edition,
    username:
      edition === 'bedrock' ? (mc?.gamertag ?? mc?.username) : (mc?.java_name ?? mc?.username),
    id: edition === 'bedrock' ? mc?.xuid : (mc?.java_uuid ?? mc?.uuid),
    linked,
    java: undefined,
    bedrock: undefined,
    textures: { skin: skinUrl },
  };

  if (edition === 'bedrock') {
    out.bedrock = {
      gamertag: mc?.gamertag,
      xuid: mc?.xuid,
      floodgateuid: mc?.floodgateuid,
    };

    if (linked && (mc?.java_uuid || mc?.java_name)) {
      out.java = { uuid: mc.java_uuid, username: mc.java_name };
    }
  } else {
    out.java = {
      uuid: mc?.java_uuid ?? mc?.uuid,
      username: mc?.java_name ?? mc?.username,
    };

    if (linked && (mc?.xuid || mc?.gamertag || mc?.floodgateuid)) {
      out.bedrock = {
        xuid: mc?.xuid,
        gamertag: mc?.gamertag,
        floodgateuid: mc?.floodgateuid,
      };
    }
  }

  return out;
}

router.get('/profile', async (req, res, next) => {
  try {
    const key = cacheKey(req);
    const cached = cache.get(key);
    if (cached) return sendSuccess(res, cached);

    const { username, edition = 'auto', xuid, uuid } = req.query;
    if (!username && !xuid && !uuid) {
      fail('Minimal sertakan ?username= atau ?xuid= atau ?uuid=', 422);
    }

    if (edition === 'bedrock' && xuid) {
      const data = await mcGet(`/api/v1/bedrock/xuid/${encodeURIComponent(xuid)}`);
      const out = unify(data, 'bedrock');
      cache.set(key, out);
      return sendSuccess(res, out);
    }

    if (edition === 'java' && uuid) {
      const data = await mcGet(`/api/v1/java/uuid/${encodeURIComponent(uuid)}`);
      const out = unify(data, 'java');
      cache.set(key, out);
      return sendSuccess(res, out);
    }

    if (edition === 'auto' && (xuid || uuid)) {
      if (xuid) {
        const data = await mcGet(`/api/v1/bedrock/xuid/${encodeURIComponent(xuid)}`);
        const out = unify(data, 'bedrock');
        cache.set(key, out);
        return sendSuccess(res, out);
      }

      if (uuid) {
        const data = await mcGet(`/api/v1/java/uuid/${encodeURIComponent(uuid)}`);
        const out = unify(data, 'java');
        cache.set(key, out);
        return sendSuccess(res, out);
      }
    }

    if (edition === 'auto' && username) {
      if (hasBedrockPrefix(username)) {
        const gamertag = stripBedrockPrefix(username);
        try {
          const data = await tryBedrockGamertag(gamertag);
          const out = unify(data, 'bedrock');
          cache.set(key, out);
          return sendSuccess(res, out);
        } catch {}
      }

      try {
        const data = await tryBedrockGamertag(username);
        const out = unify(data, 'bedrock');
        cache.set(key, out);
        return sendSuccess(res, out);
      } catch {
        try {
          const data = await mcGet(`/api/v1/java/username/${encodeURIComponent(username)}`);
          const out = unify(data, 'java');
          cache.set(key, out);
          return sendSuccess(res, out);
        } catch {
          const geyser = await axios.get(
            `https://api.geysermc.org/v2/utils/uuid/bedrock_or_java/${encodeURIComponent(username)}?prefix=${encodeURIComponent(BEDROCK_PREFIXES[0] || '.')}`,
            { timeout: 10_000 }
          );

          if (geyser?.data?.bedrock && geyser?.data?.xuid) {
            const data = await mcGet(
              `/api/v1/bedrock/xuid/${encodeURIComponent(geyser.data.xuid)}`
            );
            const out = unify(data, 'bedrock');
            cache.set(key, out);
            return sendSuccess(res, out);
          }

          if (geyser?.data?.java && geyser?.data?.uuid) {
            const data = await mcGet(`/api/v1/java/uuid/${encodeURIComponent(geyser.data.uuid)}`);
            const out = unify(data, 'java');
            cache.set(key, out);
            return sendSuccess(res, out);
          }

          return sendSuccess(res, {
            edition: 'java',
            username,
            id: null,
            linked: false,
            textures: { skin: 'default:steve' },
            fallback: true,
          });
        }
      }
    }

    if (edition === 'bedrock') {
      const gamertag = hasBedrockPrefix(username) ? stripBedrockPrefix(username) : username;
      const data = await tryBedrockGamertag(gamertag);
      const out = unify(data, 'bedrock');
      cache.set(key, out);
      return sendSuccess(res, out);
    }

    if (edition === 'java') {
      try {
        const data = uuid
          ? await mcGet(`/api/v1/java/uuid/${encodeURIComponent(uuid)}`)
          : await mcGet(`/api/v1/java/username/${encodeURIComponent(username)}`);

        const out = unify(data, 'java');
        cache.set(key, out);
        return sendSuccess(res, out);
      } catch {
        return sendSuccess(res, {
          edition: 'java',
          username,
          id: null,
          linked: false,
          textures: { skin: 'default:steve' },
          fallback: true,
        });
      }
    }

    return sendError(res, "edition harus 'auto' | 'java' | 'bedrock'", 400);
  } catch (error) {
    if (error?.status) return sendError(res, error.message, error.status);
    return next(error);
  }
});

router.get('/profile/:edition/:id/skin', async (req, res, next) => {
  try {
    const { edition, id } = req.params;
    let data;

    if (edition === 'bedrock') {
      const path = id.startsWith('253')
        ? `/api/v1/bedrock/xuid/${id}`
        : `/api/v1/bedrock/gamertag/${id}`;
      data = await mcGet(path);
    } else if (edition === 'java') {
      const path = id.includes('-') ? `/api/v1/java/uuid/${id}` : `/api/v1/java/username/${id}`;
      data = await mcGet(path);
    } else {
      return sendError(res, "edition harus 'java' atau 'bedrock'", 400);
    }

    const skin =
      data?.skin ??
      (data?.textureid ? `https://textures.minecraft.net/texture/${data.textureid}` : null) ??
      DEFAULT_STEVE;

    return res.redirect(skin);
  } catch (error) {
    return next(error);
  }
});

router.get('/render/head', async (req, res, next) => {
  try {
    const { skin, username, edition = 'auto', size = '100' } = req.query;
    const outSize = Math.max(1, parseInt(size, 10) || 100);

    async function fetchFirstOk(urls) {
      let lastErr = null;

      for (const url of urls.filter(Boolean)) {
        try {
          const resp = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 15_000,
            validateStatus: () => true,
          });

          if (resp.status >= 200 && resp.status < 300 && resp.data) {
            return Buffer.from(resp.data);
          }

          lastErr = new Error(`HTTP ${resp.status} for ${url}`);
        } catch (error) {
          lastErr = error;
        }
      }

      if (lastErr) throw lastErr;
      throw new Error('No candidate URLs provided');
    }

    if (skin) {
      try {
        const atlasBuf = await fetchFirstOk([skin]);
        const head = await renderHeadFromSkinBuffer(atlasBuf, outSize);
        res.set('Content-Type', 'image/png');
        return res.send(head);
      } catch {
        const fallback = await fetchFirstOk([
          `https://minotar.net/avatar/Alex/${outSize}`,
          `https://minotar.net/avatar/Steve/${outSize}`,
        ]);
        res.set('Content-Type', 'image/png');
        return res.send(fallback);
      }
    }

    if (!username) {
      return sendError(res, 'Berikan ?skin= atau ?username=', 422);
    }

    if (edition === 'bedrock' || hasBedrockPrefix(username)) {
      try {
        const gamertag = hasBedrockPrefix(username) ? stripBedrockPrefix(username) : username;
        const bedrock = await tryBedrockGamertag(gamertag);
        const atlasUrl =
          bedrock?.skin ??
          (bedrock?.textureid
            ? `https://textures.minecraft.net/texture/${bedrock.textureid}`
            : null);

        if (!atlasUrl) throw new Error('No bedrock skin url');

        const atlasBuf = await fetchFirstOk([atlasUrl]);
        const head = await renderHeadFromSkinBuffer(atlasBuf, outSize);
        res.set('Content-Type', 'image/png');
        return res.send(head);
      } catch {
        const fallback = await fetchFirstOk([
          `https://minotar.net/avatar/Alex/${outSize}`,
          `https://minotar.net/avatar/Steve/${outSize}`,
        ]);
        res.set('Content-Type', 'image/png');
        return res.send(fallback);
      }
    }

    try {
      const java = await mcGet(`/api/v1/java/username/${encodeURIComponent(username)}`);
      const uuid = java?.java_uuid ?? java?.uuid;

      if (uuid) {
        const crafatarUrl = `https://crafatar.com/avatars/${uuid}?overlay&size=${outSize}`;
        const buffer = await fetchFirstOk([crafatarUrl]);
        res.set('Content-Type', 'image/png');
        return res.send(buffer);
      }
    } catch {}

    try {
      const java = await mcGet(`/api/v1/java/username/${encodeURIComponent(username)}`);
      const atlasUrl =
        java?.skin ??
        (java?.textureid ? `https://textures.minecraft.net/texture/${java.textureid}` : null);

      if (atlasUrl) {
        const atlasBuf = await fetchFirstOk([atlasUrl]);
        const head = await renderHeadFromSkinBuffer(atlasBuf, outSize);
        res.set('Content-Type', 'image/png');
        return res.send(head);
      }
    } catch {}

    const fallback = await fetchFirstOk([
      `https://minotar.net/avatar/Alex/${outSize}`,
      `https://minotar.net/avatar/Steve/${outSize}`,
    ]);
    res.set('Content-Type', 'image/png');
    return res.send(fallback);
  } catch (error) {
    return next(error);
  }
});

async function renderHeadFromSkinBuffer(skinBuf, outSize = 100) {
  const meta = await sharp(skinBuf).metadata();
  const width = meta.width || 64;
  const scale = width / 64;

  const faceRegion = {
    left: Math.round(8 * scale),
    top: Math.round(8 * scale),
    width: Math.round(8 * scale),
    height: Math.round(8 * scale),
  };

  const hatRegion = {
    left: Math.round(40 * scale),
    top: Math.round(8 * scale),
    width: Math.round(8 * scale),
    height: Math.round(8 * scale),
  };

  const face = await sharp(skinBuf).extract(faceRegion).png().toBuffer();
  const hat = await sharp(skinBuf).extract(hatRegion).png().toBuffer();

  let composed = await sharp(face)
    .composite([{ input: hat }])
    .png()
    .toBuffer();

  composed = await sharp(composed)
    .resize({
      width: Math.max(1, +outSize || 100),
      height: Math.max(1, +outSize || 100),
      kernel: sharp.kernel.nearest,
    })
    .png()
    .toBuffer();

  return composed;
}

module.exports = router;
