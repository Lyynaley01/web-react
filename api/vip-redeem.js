const { getDb } = require("./_lib/firebase");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  try {
    const db = getDb();
    const { key, code } = req.body || {};

    if (!key || !code) {
      return res.status(400).json({ success: false, message: "Key dan code diperlukan." });
    }

    const vipDoc = await db.collection("vipUsers").doc(key.trim()).get();

    if (!vipDoc.exists || vipDoc.data().active === false) {
      return res.status(403).json({ success: false, message: "VIP key tidak valid." });
    }

    const codeRef = db.collection("topupCodes").doc(code.trim().toUpperCase());
    const codeSnap = await codeRef.get();

    if (!codeSnap.exists) {
      return res.status(404).json({ success: false, message: "Kode tidak ditemukan." });
    }

    const codeData = codeSnap.data();

    if (codeData.used) {
      return res.status(409).json({ success: false, message: "Kode sudah digunakan." });
    }

    const addCredits = codeData.credits || 0;
    const newCredits = (vipDoc.data().credits || 0) + addCredits;

    await db.runTransaction(async (t) => {
      t.update(codeRef, {
        used: true,
        usedBy: key.trim(),
        usedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      t.update(vipDoc.ref, { credits: newCredits });
    });

    return res.json({ success: true, added: addCredits, credits: newCredits });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
};