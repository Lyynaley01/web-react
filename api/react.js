const { getDb } = require("./_lib/firebase");
const { getClientIP, sanitizeIP, todayStr, parseEmojis } = require("./_lib/helpers");
const axios = require("axios");

const REACT_API = "https://api.nexadev.my.id/api/rch";
const REACT_API_KEY = process.env.REACT_API_KEY || "enchos";
const FREE_LIMIT = parseInt(process.env.FREE_DAILY_LIMIT || "3");
const MAX_EMOJI = 5;

module.exports = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-vip-key");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  try {
    const db = getDb();
    const ip = getClientIP(req);
    const vipKey = req.headers["x-vip-key"] || req.body?.vipKey;
    const { url, reaction } = req.body || {};

    // Validasi
    if (!url || !url.trim()) {
      return res.status(400).json({ success: false, message: "URL tidak boleh kosong." });
    }
    if (!reaction || !reaction.trim()) {
      return res.status(400).json({ success: false, message: "Emoji tidak boleh kosong." });
    }

    const cleanURL = url.trim();
    if (!cleanURL.includes("whatsapp.com/channel/")) {
      return res.status(400).json({ success: false, message: "URL tidak valid." });
    }

    const emojiList = parseEmojis(reaction);
    if (emojiList.length === 0) {
      return res.status(400).json({ success: false, message: "Minimal satu emoji." });
    }

    // ── CEK VIP ──
    let mode = "free";
    let remaining = 0;

    if (vipKey) {
      const vipDoc = await db.collection("vipUsers").doc(vipKey.trim()).get();
      if (!vipDoc.exists) {
        return res.status(403).json({ success: false, message: "VIP key tidak valid." });
      }
      const vipData = vipDoc.data();
      if (vipData.active === false) {
        return res.status(403).json({ success: false, message: "VIP key sudah tidak aktif." });
      }
      if (vipData.expiresAt && vipData.expiresAt.toDate() < new Date()) {
        return res.status(403).json({ success: false, message: "VIP key sudah expired." });
      }
      if (vipData.credits <= 0) {
        return res.status(429).json({ success: false, message: "Credit VIP habis." });
      }

      // Kurangi credit
      const newCredits = vipData.credits - 1;
      await vipDoc.ref.update({
        credits: newCredits,
        lastUsed: admin.firestore.FieldValue.serverTimestamp(),
      });
      mode = "vip";
      remaining = newCredits;
    } else {
      // ── FREE LIMIT ──
      const today = todayStr();
      const docId = `${sanitizeIP(ip)}_${today}`;
      const ref = db.collection("freeUsage").doc(docId);
      const snap = await ref.get();

      let count = 0;
      if (snap.exists) {
        count = snap.data().count || 0;
      }

      if (count >= FREE_LIMIT) {
        return res.status(429).json({
          success: false,
          message: `Batas harian tercapai (${FREE_LIMIT}x/hari).`,
          remaining: 0,
          total: FREE_LIMIT,
          mode: "free",
        });
      }

      const newCount = count + 1;
      await ref.set({ ip, date: today, count: newCount, lastUsed: admin.firestore.FieldValue.serverTimestamp() });
      remaining = FREE_LIMIT - newCount;
    }

    // ── PANGGIL API NEXADEV ──
    try {
      const apiRes = await axios.get(REACT_API, {
        params: { key: REACT_API_KEY, url: cleanURL, reaction: emojiList.join(",") },
        timeout: 20000,
      });

      return res.json({
        success: true,
        data: apiRes.data,
        emojis: emojiList,
        remaining: remaining,
        mode: mode,
        ...(mode === "free" ? { total: FREE_LIMIT } : {}),
      });
    } catch (err) {
      // Rollback kalo gagal
      if (mode === "vip") {
        const vipDoc = await db.collection("vipUsers").doc(vipKey.trim()).get();
        if (vipDoc.exists) {
          await vipDoc.ref.update({ credits: (vipDoc.data().credits || 0) + 1 });
        }
      } else {
        // Rollback free limit
        const today = todayStr();
        const docId = `${sanitizeIP(ip)}_${today}`;
        const ref = db.collection("freeUsage").doc(docId);
        const snap = await ref.get();
        if (snap.exists && snap.data().count > 0) {
          await ref.update({ count: snap.data().count - 1 });
        }
      }

      return res.status(502).json({
        success: false,
        message: err.message || "API error",
        mode,
      });
    }
  } catch (err) {
    console.error("React error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};