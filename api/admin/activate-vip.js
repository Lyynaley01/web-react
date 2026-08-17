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
    const { key, label, plan, credits, daysValid } = req.body || {};

    if (!key) {
      return res.status(400).json({ success: false, message: "Key diperlukan." });
    }

    const expiresAt = daysValid
      ? admin.firestore.Timestamp.fromDate(new Date(Date.now() + daysValid * 86400000))
      : null;

    const ref = db.collection("vipUsers").doc(key.trim());
    const snap = await ref.get();

    if (snap.exists) {
      const current = snap.data();
      await ref.update({
        credits: (current.credits || 0) + (parseInt(credits) || 0),
        active: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        ...(expiresAt ? { expiresAt } : {}),
        ...(label ? { label } : {}),
        ...(plan ? { plan } : {}),
      });
    } else {
      await ref.set({
        label: label || "VIP User",
        plan: plan || "custom",
        credits: parseInt(credits) || 100,
        active: true,
        expiresAt: expiresAt || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        lastUsed: null,
        loggedOutAt: null,
      });
    }

    return res.json({ success: true, key: key.trim(), message: "VIP key berhasil diaktifkan." });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
};