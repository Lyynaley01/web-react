const { getDb } = require("./_lib/firebase");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  try {
    const db = getDb();
    const { key } = req.body || {};

    if (!key) {
      return res.status(400).json({ success: false, message: "Key diperlukan." });
    }

    const vipDoc = await db.collection("vipUsers").doc(key.trim()).get();

    if (!vipDoc.exists) {
      return res.status(404).json({ success: false, message: "VIP key tidak ditemukan." });
    }

    await vipDoc.ref.update({
      active: false,
      loggedOutAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({ success: true, message: "Logout berhasil." });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
};