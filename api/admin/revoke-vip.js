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
    const { key } = req.body || {};

    if (!key) {
      return res.status(400).json({ success: false, message: "Key diperlukan." });
    }

    await db.collection("vipUsers").doc(key.trim()).update({
      active: false,
      revokedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({ success: true, message: "VIP key dinonaktifkan." });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
};