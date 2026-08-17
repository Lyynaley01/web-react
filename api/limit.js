const { getDb } = require("./_lib/firebase");
const { getClientIP, sanitizeIP, todayStr } = require("./_lib/helpers");

const FREE_LIMIT = parseInt(process.env.FREE_DAILY_LIMIT || "3");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  try {
    const db = getDb();
    const vipKey = req.headers["x-vip-key"] || req.query.vipKey;

    if (vipKey) {
      const vipDoc = await db.collection("vipUsers").doc(vipKey.trim()).get();
      if (vipDoc.exists && vipDoc.data().active !== false) {
        const data = vipDoc.data();
        return res.json({
          mode: "vip",
          credits: data.credits,
          label: data.label || "VIP",
          plan: data.plan || "custom",
          expiresAt: data.expiresAt ? data.expiresAt.toDate().toISOString() : null,
        });
      }
    }

    const ip = getClientIP(req);
    const today = todayStr();
    const docId = `${sanitizeIP(ip)}_${today}`;
    const snap = await db.collection("freeUsage").doc(docId).get();
    const count = snap.exists ? snap.data().count || 0 : 0;
    const remaining = Math.max(0, FREE_LIMIT - count);

    return res.json({ mode: "free", remaining, total: FREE_LIMIT });
  } catch (err) {
    return res.json({ mode: "free", remaining: FREE_LIMIT, total: FREE_LIMIT });
  }
};