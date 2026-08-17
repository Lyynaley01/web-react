const { getDb } = require("../_lib/firebase");

const ADMIN_SECRET = process.env.ADMIN_SECRET || "GANTI_INI_SEKARANG";

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const secret = req.headers["x-admin-secret"];

  if (secret !== ADMIN_SECRET) {
    return res.status(403).json({ success: false, message: "Unauthorized." });
  }

  try {
    const db = getDb();
    const snap = await db.collection("vipUsers").orderBy("createdAt", "desc").get();
    const users = snap.docs.map(d => ({ key: d.id, ...d.data() }));

    return res.json({ success: true, users });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
};