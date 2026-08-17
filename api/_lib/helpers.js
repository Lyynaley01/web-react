function getClientIP(req) {
  const forwarded = req.headers["x-forwarded-for"];
  return (forwarded ? forwarded.split(",")[0].trim() : null) ||
    req.socket?.remoteAddress ||
    "127.0.0.1";
}

function sanitizeIP(ip) {
  return ip.replace(/[.:]/g, "_");
}

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function parseEmojis(raw) {
  return raw.split(",").map(e => e.trim()).filter(Boolean).slice(0, 5);
}

module.exports = { getClientIP, sanitizeIP, todayStr, parseEmojis };