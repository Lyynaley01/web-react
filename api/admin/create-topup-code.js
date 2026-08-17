const { getDb } = require("../_lib/firebase");

const ADMIN_SECRET = process.env.ADMIN_SECRET || "GANTI_INI_SEKARANG";

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  const secret = req.headers["x-admin-secret"] || req.body?.adminSecret;

  if (secret !== ADMIN_SECRET) {
    return res.status(403).json({ success: false, message: "Unauthorized." });
  }

  try {
    const db = getDb();
    const { code, credits } = req.body || {};

    if (!code || !credits) {
      return res.status(400).json({ success: false, message: "Code dan credits diperlukan." });
    }

    const codeStr = code.trim().toUpperCase();
    const ref = db.collection("topupCodes").doc(codeStr);
    const snap = await ref.get();

    if (snap.exists && snap.data().used) {
      return res.status(409).json({ success: false, message: "Kode sudah digunakan." });
    }

    await ref.set({
      credits: parseInt(credits),
      used: false,
      usedBy: null,
      usedAt: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({ success: true, code: codeStr, credits: parseInt(credits) });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
};