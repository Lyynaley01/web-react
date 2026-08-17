require("dotenv").config();

const express   = require("express");
const axios     = require("axios");
const path      = require("path");
const admin     = require("firebase-admin");

// ── FIREBASE INIT ────────────────────────────────────────────────────
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  : require("./firebase-service-account.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
// ─────────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ── CONFIG ──────────────────────────────────────────────────────────
const REACT_API      = "https://api.nexadev.my.id/api/rch";
const REACT_API_KEY  = process.env.REACT_API_KEY  || "enchos";
const ADMIN_SECRET   = process.env.ADMIN_SECRET   || "GANTI_INI_SEKARANG";
const FREE_LIMIT     = parseInt(process.env.FREE_DAILY_LIMIT  || "3");
const MAX_EMOJI      = 5;
const PORT           = process.env.PORT || 3000;

// ── DEV AREA SECURITY ──
const DEV_USER       = process.env.DEV_USER || "elarion";
const DEV_PASS       = process.env.DEV_PASS || "rahasia123";
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 menit
const RATE_LIMIT_MAX    = 5; // 5 percobaan
const loginAttempts  = {};
// ────────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function getClientIP(req) {
  const forwarded = req.headers["x-forwarded-for"];
  return (forwarded ? forwarded.split(",")[0].trim() : null) ||
    req.socket?.remoteAddress ||
    "127.0.0.1";
}

function sanitizeIP(ip) {
  return ip.replace(/[.:]/g, "_");
}

// ── RATE LIMIT CLEANUP ──
setInterval(() => {
  const now = Date.now();
  for (const ip in loginAttempts) {
    if (now - loginAttempts[ip].resetAt > RATE_LIMIT_WINDOW) {
      delete loginAttempts[ip];
    }
  }
}, 60 * 60 * 1000);

function isRateLimited(ip) {
  const now = Date.now();
  if (!loginAttempts[ip]) {
    loginAttempts[ip] = { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
    return false;
  }
  if (now > loginAttempts[ip].resetAt) {
    loginAttempts[ip] = { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
    return false;
  }
  return loginAttempts[ip].count >= RATE_LIMIT_MAX;
}

function logAccess(ip, status, message) {
  const timestamp = new Date().toISOString();
  console.log(`[DEV-ACCESS] ${timestamp} | IP: ${ip} | ${status} | ${message}`);
}

// ── DEV AREA MULTI-LAYER SECURITY (PAKSA LOGIN) ──
function requireDevAccess(req, res, next) {
  const clientIP = getClientIP(req);

  // Layer 1: Rate Limiting
  if (isRateLimited(clientIP)) {
    logAccess(clientIP, "BLOCKED", "Rate limit exceeded");
    return res.status(429).send("Too many attempts. Please try again later.");
  }

  // Layer 2: Admin Secret (header atau query) — bypass login
  const adminSecret = req.headers["x-admin-secret"] || req.query.adminSecret;
  if (adminSecret && adminSecret === ADMIN_SECRET) {
    logAccess(clientIP, "GRANTED", "Access via admin secret");
    return next();
  }

  // Layer 3: Basic Auth (WAJIB untuk semua, tanpa peduli IP)
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Basic ")) {
    loginAttempts[clientIP] = loginAttempts[clientIP] || { count: 0, resetAt: Date.now() + RATE_LIMIT_WINDOW };
    loginAttempts[clientIP].count += 1;
    logAccess(clientIP, "FAILED", "Missing auth header");

    res.setHeader("WWW-Authenticate", 'Basic realm="Developer Area"');
    return res.status(401).send("Authentication required");
  }

  try {
    const base64Credentials = authHeader.split(" ")[1];
    const credentials = Buffer.from(base64Credentials, "base64").toString("ascii");
    const [username, password] = credentials.split(":");

    if (username === DEV_USER && password === DEV_PASS) {
      delete loginAttempts[clientIP];
      logAccess(clientIP, "GRANTED", "Access via basic auth");
      return next();
    }
  } catch (err) {
    // Silent fail
  }

  // Failed auth
  loginAttempts[clientIP] = loginAttempts[clientIP] || { count: 0, resetAt: Date.now() + RATE_LIMIT_WINDOW };
  loginAttempts[clientIP].count += 1;
  logAccess(clientIP, "FAILED", "Invalid credentials");

  res.setHeader("WWW-Authenticate", 'Basic realm="Developer Area"');
  return res.status(401).send("Authentication required");
}

// ── FREE LIMIT via FIRESTORE ─────────────────────────────────────────

async function getOrCreateFreeUsage(ip) {
  const today  = todayStr();
  const docId  = `${sanitizeIP(ip)}_${today}`;
  const ref    = db.collection("freeUsage").doc(docId);
  const snap   = await ref.get();

  if (!snap.exists) {
    await ref.set({ ip, date: today, count: 0 });
    return { ref, count: 0 };
  }
  return { ref, count: snap.data().count || 0 };
}

async function consumeFreeLimit(ip) {
  const { ref, count } = await getOrCreateFreeUsage(ip);
  if (count >= FREE_LIMIT) {
    return { allowed: false, usedAfter: count, remaining: 0 };
  }
  const newCount = count + 1;
  await ref.update({ count: newCount, lastUsed: admin.firestore.FieldValue.serverTimestamp() });
  return { allowed: true, usedAfter: newCount, remaining: FREE_LIMIT - newCount };
}

async function peekFreeLimit(ip) {
  const { count } = await getOrCreateFreeUsage(ip);
  return Math.max(0, FREE_LIMIT - count);
}

async function rollbackFreeLimit(ip) {
  try {
    const { ref, count } = await getOrCreateFreeUsage(ip);
    if (count > 0) await ref.update({ count: count - 1 });
  } catch (_) {}
}

// ── VIP KEY HELPERS ──────────────────────────────────────────────────

async function getVipUser(vipKey) {
  if (!vipKey || typeof vipKey !== "string") return null;
  const snap = await db.collection("vipUsers").doc(vipKey.trim()).get();
  if (!snap.exists) return null;
  const data = snap.data();

  if (data.active === false) return null;
  if (data.expiresAt && data.expiresAt.toDate() < new Date()) return null;

  return { ...data, ref: snap.ref };
}

async function consumeVipCredit(vipKey) {
  const vip = await getVipUser(vipKey);
  if (!vip) return { allowed: false, message: "VIP key tidak valid, sudah expired, atau sudah logout." };
  if (vip.credits <= 0) return { allowed: false, message: "Credit VIP habis." };

  const newCredits = vip.credits - 1;
  await vip.ref.update({
    credits: newCredits,
    lastUsed: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { allowed: true, remaining: newCredits };
}

async function rollbackVipCredit(vipKey) {
  try {
    const vip = await getVipUser(vipKey);
    if (vip) await vip.ref.update({ credits: vip.credits + 1 });
  } catch (_) {}
}

// ── ROUTES ──────────────────────────────────────────────────────────

// Cek limit atau credit tergantung mode (free/vip)
app.get("/api/limit", async (req, res) => {
  const vipKey = req.headers["x-vip-key"] || req.query.vipKey;
  try {
    if (vipKey) {
      const vip = await getVipUser(vipKey);
      if (vip) {
        return res.json({
          mode: "vip",
          credits: vip.credits,
          label: vip.label || "VIP",
          plan: vip.plan || "custom",
          expiresAt: vip.expiresAt ? vip.expiresAt.toDate().toISOString() : null,
          active: vip.active !== false,
        });
      }
    }
    const ip = getClientIP(req);
    const remaining = await peekFreeLimit(ip);
    return res.json({ mode: "free", remaining, total: FREE_LIMIT });
  } catch (err) {
    console.error("GET /api/limit error:", err);
    return res.json({ mode: "free", remaining: FREE_LIMIT, total: FREE_LIMIT });
  }
});

// Verifikasi VIP key
app.post("/api/vip/verify", async (req, res) => {
  const { key } = req.body || {};
  if (!key) return res.status(400).json({ success: false, message: "Key diperlukan." });
  try {
    const vip = await getVipUser(key.trim());
    if (!vip) {
      return res.status(404).json({
        success: false,
        message: "VIP key tidak valid, sudah expired, atau sudah logout."
      });
    }
    return res.json({
      success: true,
      credits: vip.credits,
      label: vip.label || "VIP User",
      plan: vip.plan || "custom",
      expiresAt: vip.expiresAt ? vip.expiresAt.toDate().toISOString() : null,
      active: vip.active !== false,
    });
  } catch (err) {
    console.error("POST /api/vip/verify error:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── VIP LOGOUT ──
app.post("/api/vip/logout", async (req, res) => {
  const { key } = req.body || {};
  if (!key) {
    return res.status(400).json({ success: false, message: "Key diperlukan." });
  }

  try {
    const vip = await getVipUser(key.trim());
    if (!vip) {
      return res.status(404).json({ success: false, message: "VIP key tidak ditemukan atau sudah tidak aktif." });
    }

    await vip.ref.update({
      active: false,
      loggedOutAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({ success: true, message: "Logout berhasil. Key tidak bisa digunakan lagi." });
  } catch (err) {
    console.error("POST /api/vip/logout error:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// Redeem topup code
app.post("/api/vip/redeem", async (req, res) => {
  const { key, code } = req.body || {};
  if (!key || !code) return res.status(400).json({ success: false, message: "Key dan code diperlukan." });

  try {
    const vip = await getVipUser(key.trim());
    if (!vip) return res.status(403).json({ success: false, message: "VIP key tidak valid." });

    const codeRef  = db.collection("topupCodes").doc(code.trim().toUpperCase());
    const codeSnap = await codeRef.get();

    if (!codeSnap.exists) return res.status(404).json({ success: false, message: "Kode topup tidak ditemukan." });

    const codeData = codeSnap.data();
    if (codeData.used) return res.status(409).json({ success: false, message: "Kode sudah pernah digunakan." });

    const addCredits  = codeData.credits || 0;
    const newCredits  = (vip.credits || 0) + addCredits;

    await db.runTransaction(async (t) => {
      t.update(codeRef, {
        used: true,
        usedBy: key.trim(),
        usedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      t.update(vip.ref, { credits: newCredits });
    });

    return res.json({ success: true, added: addCredits, credits: newCredits });
  } catch (err) {
    console.error("POST /api/vip/redeem error:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// Main reaction endpoint
app.post("/api/react", async (req, res) => {
  const ip     = getClientIP(req);
  const vipKey = req.headers["x-vip-key"] || req.body?.vipKey;
  const { url, reaction } = req.body || {};

  if (!url || typeof url !== "string" || !url.trim()) {
    return res.status(400).json({ success: false, message: "URL tidak boleh kosong." });
  }
  if (!reaction || typeof reaction !== "string" || !reaction.trim()) {
    return res.status(400).json({ success: false, message: "Emoji tidak boleh kosong." });
  }

  const cleanURL = url.trim();
  if (!cleanURL.includes("whatsapp.com/channel/")) {
    return res.status(400).json({
      success: false,
      message: "URL harus berupa link postingan channel WhatsApp yang valid.",
    });
  }

  const emojiList = reaction.split(",").map((e) => e.trim()).filter(Boolean).slice(0, MAX_EMOJI);
  if (emojiList.length === 0) {
    return res.status(400).json({ success: false, message: "Setidaknya satu emoji diperlukan." });
  }

  let mode       = "free";
  let limitResult;

  if (vipKey) {
    const result = await consumeVipCredit(vipKey);
    if (!result.allowed) {
      return res.status(429).json({ success: false, message: result.message, mode: "vip" });
    }
    mode        = "vip";
    limitResult = { allowed: true, remaining: result.remaining };
  } else {
    const result = await consumeFreeLimit(ip);
    if (!result.allowed) {
      return res.status(429).json({
        success: false,
        message: `Batas harian tercapai (${FREE_LIMIT}x/hari). Coba lagi besok atau upgrade ke VIP.`,
        remaining: 0,
        total: FREE_LIMIT,
        mode: "free",
      });
    }
    limitResult = result;
  }

  try {
    const apiRes = await axios.get(REACT_API, {
      params: { key: REACT_API_KEY, url: cleanURL, reaction: emojiList.join(",") },
      timeout: 20_000,
    });

    return res.json({
      success:   true,
      data:      apiRes.data,
      emojis:    emojiList,
      remaining: limitResult.remaining,
      mode,
      ...(mode === "free" ? { total: FREE_LIMIT } : {}),
    });
  } catch (err) {
    if (mode === "vip") await rollbackVipCredit(vipKey);
    else await rollbackFreeLimit(ip);

    const errMsg =
      err.response?.data?.message ||
      err.response?.data?.error   ||
      err.message                 ||
      "Unknown error dari upstream API.";

    return res.status(502).json({
      success: false,
      message: errMsg,
      remaining: mode === "free" ? await peekFreeLimit(ip) : undefined,
      mode,
    });
  }
});

// ── ADMIN ROUTES ─────────────────────────────────────────────────────

function requireAdmin(req, res, next) {
  const secret = req.headers["x-admin-secret"] || req.body?.adminSecret;
  console.log("🔑 Received secret:", secret);
  console.log("🔐 Expected secret:", ADMIN_SECRET);

  if (!secret) {
    return res.status(403).json({ success: false, message: "Secret tidak ditemukan di header." });
  }

  if (secret !== ADMIN_SECRET) {
    return res.status(403).json({ success: false, message: "Unauthorized." });
  }
  next();
}

app.post("/api/admin/activate-vip", requireAdmin, async (req, res) => {
  const { key, label, plan, credits, daysValid } = req.body || {};
  if (!key) return res.status(400).json({ success: false, message: "Key diperlukan." });

  const expiresAt = daysValid
    ? admin.firestore.Timestamp.fromDate(new Date(Date.now() + daysValid * 86400_000))
    : null;

  try {
    const ref  = db.collection("vipUsers").doc(key.trim());
    const snap = await ref.get();

    if (snap.exists) {
      const current = snap.data();
      await ref.update({
        credits:   (current.credits || 0) + (parseInt(credits) || 0),
        active:    true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        ...(expiresAt ? { expiresAt } : {}),
        ...(label    ? { label }     : {}),
        ...(plan     ? { plan }      : {}),
      });
    } else {
      await ref.set({
        label:      label     || "VIP User",
        plan:       plan      || "custom",
        credits:    parseInt(credits) || 100,
        active:     true,
        expiresAt:  expiresAt || null,
        createdAt:  admin.firestore.FieldValue.serverTimestamp(),
        lastUsed:   null,
        loggedOutAt: null,
      });
    }

    return res.json({ success: true, key: key.trim(), message: "VIP key berhasil diaktifkan." });
  } catch (err) {
    console.error("POST /api/admin/activate-vip error:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

app.post("/api/admin/create-topup-code", requireAdmin, async (req, res) => {
  const { code, credits } = req.body || {};
  if (!code || !credits) {
    return res.status(400).json({ success: false, message: "Code dan credits diperlukan." });
  }

  const codeStr = code.trim().toUpperCase();
  try {
    const ref  = db.collection("topupCodes").doc(codeStr);
    const snap = await ref.get();
    if (snap.exists && snap.data().used) {
      return res.status(409).json({ success: false, message: "Kode sudah pernah digunakan." });
    }

    await ref.set({
      credits:   parseInt(credits),
      used:      false,
      usedBy:    null,
      usedAt:    null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({ success: true, code: codeStr, credits: parseInt(credits) });
  } catch (err) {
    console.error("POST /api/admin/create-topup-code error:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

app.get("/api/admin/vip-users", requireAdmin, async (req, res) => {
  try {
    const snap  = await db.collection("vipUsers").orderBy("createdAt", "desc").get();
    const users = snap.docs.map((d) => ({ key: d.id, ...d.data() }));
    return res.json({ success: true, users });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

app.post("/api/admin/revoke-vip", requireAdmin, async (req, res) => {
  const { key } = req.body || {};
  if (!key) return res.status(400).json({ success: false, message: "Key diperlukan." });
  try {
    await db.collection("vipUsers").doc(key.trim()).update({
      active: false,
      revokedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return res.json({ success: true, message: "VIP key dinonaktifkan." });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── PROTECTED ROUTES (DEV AREA) ──
app.get("/elarion-dashboard.html", requireDevAccess, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "elarion-dashboard.html"));
});

// Proteksi folder dev (kalo ada)
app.get("/dev/*", requireDevAccess, (req, res) => {
  res.sendFile(path.join(__dirname, "public", req.path));
});

// ── FALLBACK ─────────────────────────────────────────────────────────
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ── START ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ WA React server berjalan → http://localhost:${PORT}`);
  console.log(`   API key     : ${REACT_API_KEY}`);
  console.log(`   Free limit  : ${FREE_LIMIT}x/hari per IP`);
  console.log(`   Firebase    : Connected`);
  console.log(`🔒 Dev area   : Protected (WAJIB LOGIN)`);
});