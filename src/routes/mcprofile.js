// src/routes/mcprofile.js
const express = require("express");
const axios = require("axios");
const rateLimit = require("express-rate-limit");
const NodeCache = require("node-cache");
const sharp = require("sharp");

const router = express.Router();

// === CONFIG & CACHE
const MC_BASE = "https://mcprofile.io";
const BEDROCK_PREFIXES = (process.env.BEDROCK_PREFIXES || ".")
  .split(";")
  .map(s => s.trim())
  .filter(Boolean);

const cache = new NodeCache({ stdTTL: 300, checkperiod: 120 });
const limiter = rateLimit({ windowMs: 60_000, max: 60 });
router.use(limiter);

// === DEFAULT SKINS (fallback)
const DEFAULT_STEVE =
  "https://textures.minecraft.net/texture/2bd6b6e4d7b5c2cbe62c57be9f2cb86c0fb4c9ce76bb9a1d9158f0a5f1a3";
const DEFAULT_ALEX =
  "https://textures.minecraft.net/texture/367df0c7d6b3c6c2e0e14e2b5b67dfba97e18f7e8c4fbb2e6e4c3158e2b0c4f2";

// === helpers
const ok = (data) => ({ ok: true, data });
const fail = (msg, status = 400) => {
  const err = new Error(msg);
  err.status = status;
  throw err;
};
const cacheKey = (req) => `${req.path}?${new URLSearchParams(req.query).toString()}`;

const hasBedrockPrefix = (name) => {
  if (!name) return false;
  const lower = String(name).toLowerCase();
  return BEDROCK_PREFIXES.some(p => lower.startsWith(p.toLowerCase()));
};
const stripBedrockPrefix = (name) => {
  let s = String(name);
  for (const p of BEDROCK_PREFIXES) {
    if (s.toLowerCase().startsWith(p.toLowerCase())) return s.slice(p.length);
  }
  return s;
};

async function mcGet(path) {
  const url = `${MC_BASE}${path}`;
  const res = await axios.get(url, { timeout: 12_000 });
  return res.data;
}

// normalisasi bedrock spasi<->underscore
const normalizeBedrockUsername   = (n) => n.replace(/\s+/g, "_");
const denormalizeBedrockUsername = (n) => n.replace(/_/g, " ");
async function tryBedrockGamertag(name) {
  try {
    return await mcGet(`/api/v1/bedrock/gamertag/${encodeURIComponent(name)}`);
  } catch {
    const alt = name.includes(" ")
      ? normalizeBedrockUsername(name)
      : denormalizeBedrockUsername(name);
    if (alt !== name) {
      return await mcGet(`/api/v1/bedrock/gamertag/${encodeURIComponent(alt)}`);
    }
    throw new Error("Bedrock gamertag lookup failed");
  }
}

// samakan payload
function unify(mc, source) {
  const edition = source;
  const linked = Boolean(mc?.linked);
  const skinUrl = mc?.skin ?? (mc?.textureid ? `https://textures.minecraft.net/texture/${mc.textureid}` : null);

  const out = {
    edition,
    username: edition === "bedrock" ? mc?.gamertag ?? mc?.username : mc?.java_name ?? mc?.username,
    id:       edition === "bedrock" ? mc?.xuid : mc?.java_uuid ?? mc?.uuid,
    linked,
    java: undefined,
    bedrock: undefined,
    textures: { skin: skinUrl }
  };

  if (edition === "bedrock") {
    out.bedrock = { gamertag: mc?.gamertag, xuid: mc?.xuid, floodgateuid: mc?.floodgateuid };
    if (linked && (mc?.java_uuid || mc?.java_name)) out.java = { uuid: mc.java_uuid, username: mc.java_name };
  } else {
    out.java = { uuid: mc?.java_uuid ?? mc?.uuid, username: mc?.java_name ?? mc?.username };
    if (linked && (mc?.xuid || mc?.gamertag || mc?.floodgateuid))
      out.bedrock = { xuid: mc?.xuid, gamertag: mc?.gamertag, floodgateuid: mc?.floodgateuid };
  }
  return out;
}

// ===== /profile
router.get("/profile", async (req, res, next) => {
  try {
    const key = cacheKey(req);
    const cached = cache.get(key);
    if (cached) return res.json(ok(cached));

    const { username, edition = "auto", xuid, uuid } = req.query;
    if (!username && !xuid && !uuid) fail("Minimal sertakan ?username= atau ?xuid= atau ?uuid=", 422);

    // Fast ID path
    if (edition === "bedrock" && xuid) {
      const d = await mcGet(`/api/v1/bedrock/xuid/${encodeURIComponent(xuid)}`);
      const out = unify(d, "bedrock"); cache.set(key, out); return res.json(ok(out));
    }
    if (edition === "java" && uuid) {
      const d = await mcGet(`/api/v1/java/uuid/${encodeURIComponent(uuid)}`);
      const out = unify(d, "java"); cache.set(key, out); return res.json(ok(out));
    }
    if (edition === "auto" && (xuid || uuid)) {
      if (xuid) {
        const d = await mcGet(`/api/v1/bedrock/xuid/${encodeURIComponent(xuid)}`);
        const out = unify(d, "bedrock"); cache.set(key, out); return res.json(ok(out));
      }
      if (uuid) {
        const d = await mcGet(`/api/v1/java/uuid/${encodeURIComponent(uuid)}`);
        const out = unify(d, "java"); cache.set(key, out); return res.json(ok(out));
      }
    }

    // AUTO
    if (edition === "auto" && username) {
      if (hasBedrockPrefix(username)) {
        const gamertag = stripBedrockPrefix(username);
        try {
          const d = await tryBedrockGamertag(gamertag);
          const out = unify(d, "bedrock"); cache.set(key, out); return res.json(ok(out));
        } catch {}
      }
      try {
        const d = await tryBedrockGamertag(username);
        const out = unify(d, "bedrock"); cache.set(key, out); return res.json(ok(out));
      } catch {
        try {
          const d = await mcGet(`/api/v1/java/username/${encodeURIComponent(username)}`);
          const out = unify(d, "java"); cache.set(key, out); return res.json(ok(out));
        } catch {
          // geyser fallback
          const g = await axios.get(
            `https://api.geysermc.org/v2/utils/uuid/bedrock_or_java/${encodeURIComponent(username)}?prefix=${encodeURIComponent(BEDROCK_PREFIXES[0] || ".")}`,
            { timeout: 10_000 }
          );
          if (g?.data?.bedrock && g?.data?.xuid) {
            const bd = await mcGet(`/api/v1/bedrock/xuid/${encodeURIComponent(g.data.xuid)}`);
            const out = unify(bd, "bedrock"); cache.set(key, out); return res.json(ok(out));
          }
          if (g?.data?.java && g?.data?.uuid) {
            const jv = await mcGet(`/api/v1/java/uuid/${encodeURIComponent(g.data.uuid)}`);
            const out = unify(jv, "java"); cache.set(key, out); return res.json(ok(out));
          }
          // cracked/offline → fallback
          return res.json(ok({
            edition: "java", username, id: null, linked: false,
            textures: { skin: "default:steve" }, fallback: true
          }));
        }
      }
    }

    // Bedrock forced
    if (edition === "bedrock") {
      const gamertag = hasBedrockPrefix(username) ? stripBedrockPrefix(username) : username;
      const d = await tryBedrockGamertag(gamertag);
      const out = unify(d, "bedrock"); cache.set(key, out); return res.json(ok(out));
    }

    // Java forced (fallback cracked)
    if (edition === "java") {
      try {
        const d = uuid
          ? await mcGet(`/api/v1/java/uuid/${encodeURIComponent(uuid)}`)
          : await mcGet(`/api/v1/java/username/${encodeURIComponent(username)}`);
        const out = unify(d, "java"); cache.set(key, out); return res.json(ok(out));
      } catch {
        return res.json(ok({
          edition: "java", username, id: null, linked: false,
          textures: { skin: "default:steve" }, fallback: true
        }));
      }
    }

    return res.status(400).json({ ok: false, error: "edition harus 'auto' | 'java' | 'bedrock'" });
  } catch (e) { next(e); }
});

// ===== redirect ke URL skin
router.get("/profile/:edition/:id/skin", async (req, res, next) => {
  try {
    const { edition, id } = req.params;
    let data;
    if (edition === "bedrock") {
      const path = id.startsWith("253") ? `/api/v1/bedrock/xuid/${id}` : `/api/v1/bedrock/gamertag/${id}`;
      data = await mcGet(path);
    } else if (edition === "java") {
      const path = id.includes("-") ? `/api/v1/java/uuid/${id}` : `/api/v1/java/username/${id}`;
      data = await mcGet(path);
    } else {
      return res.status(400).json({ ok: false, error: "edition harus 'java' atau 'bedrock'" });
    }
    const skin =
      data?.skin ??
      (data?.textureid ? `https://textures.minecraft.net/texture/${data.textureid}` : null) ??
      DEFAULT_STEVE;
    return res.redirect(skin);
  } catch (e) { next(e); }
});

// ===== render head (avatar)
router.get("/render/head", async (req, res, next) => {
  try {
    const { skin, username, edition = "auto", size = "100" } = req.query;
    let skinUrl = skin;

    async function getSkinUrlByUsername(name) {
      if (edition === "auto" && hasBedrockPrefix(name)) {
        const gamertag = stripBedrockPrefix(name);
        const bd = await tryBedrockGamertag(gamertag);
        return bd?.skin ?? (bd?.textureid ? `https://textures.minecraft.net/texture/${bd.textureid}` : null);
      }
      try {
        const bd = await tryBedrockGamertag(name);
        return bd?.skin ?? (bd?.textureid ? `https://textures.minecraft.net/texture/${bd.textureid}` : null);
      } catch {}
      try {
        const jv = await mcGet(`/api/v1/java/username/${encodeURIComponent(name)}`);
        return jv?.skin ?? (jv?.textureid ? `https://textures.minecraft.net/texture/${jv.textureid}` : null);
      } catch {}
      const g = await axios.get(
        `https://api.geysermc.org/v2/utils/uuid/bedrock_or_java/${encodeURIComponent(name)}?prefix=${encodeURIComponent(BEDROCK_PREFIXES[0] || ".")}`,
        { timeout: 10_000 }
      );
      if (g?.data?.bedrock && g?.data?.xuid) {
        const bd = await mcGet(`/api/v1/bedrock/xuid/${encodeURIComponent(g.data.xuid)}`);
        return bd?.skin ?? (bd?.textureid ? `https://textures.minecraft.net/texture/${bd.textureid}` : null);
      }
      if (g?.data?.java && g?.data?.uuid) {
        const jv = await mcGet(`/api/v1/java/uuid/${encodeURIComponent(g.data.uuid)}`);
        return jv?.skin ?? (jv?.textureid ? `https://textures.minecraft.net/texture/${jv.textureid}` : null);
      }
      return null;
    }

    if (!skinUrl && username) skinUrl = await getSkinUrlByUsername(username);
    if (!skinUrl) skinUrl = Math.random() > 0.5 ? DEFAULT_STEVE : DEFAULT_ALEX; // cracked fallback

    let skinBuf;
    try {
      skinBuf = await axios.get(skinUrl, { responseType: "arraybuffer", timeout: 15_000 })
        .then(r => Buffer.from(r.data));
    } catch {
      skinBuf = await axios.get(DEFAULT_STEVE, { responseType: "arraybuffer" })
        .then(r => Buffer.from(r.data));
    }

    const out = await renderHeadFromSkinBuffer(skinBuf, parseInt(size, 10) || 100);
    // optional cache header:
    // res.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
    res.set("Content-Type", "image/png");
    res.send(out);
  } catch (e) { next(e); }
});

async function renderHeadFromSkinBuffer(skinBuf, outSize = 100) {
  const meta = await sharp(skinBuf).metadata();
  const W = meta.width || 64;
  const s = W / 64;

  const faceRegion = { left: Math.round(8*s),  top: Math.round(8*s),  width: Math.round(8*s),  height: Math.round(8*s) };
  const hatRegion  = { left: Math.round(40*s), top: Math.round(8*s),  width: Math.round(8*s),  height: Math.round(8*s) };

  const face = await sharp(skinBuf).extract(faceRegion).png().toBuffer();
  const hat  = await sharp(skinBuf).extract(hatRegion).png().toBuffer();

  let composed = await sharp(face).composite([{ input: hat }]).png().toBuffer();
  composed = await sharp(composed)
    .resize({ width: Math.max(1, +outSize || 100), height: Math.max(1, +outSize || 100), kernel: sharp.kernel.nearest })
    .png()
    .toBuffer();
  return composed;
}

module.exports = router;
