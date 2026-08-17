const admin = require("firebase-admin");

let firebaseApp = null;

function getFirebaseApp() {
  if (firebaseApp) return firebaseApp;

  let serviceAccount;
  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    } else {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON not found");
    }
  } catch (err) {
    console.error("❌ Firebase init error:", err.message);
    throw err;
  }

  firebaseApp = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  return firebaseApp;
}

function getDb() {
  return getFirebaseApp().firestore();
}

module.exports = { getDb, getFirebaseApp };