// backend/server.cjs
// Express server to automate web push notifications on number update

const express = require('express');
const webpush = require('web-push');
const admin = require('firebase-admin');
const { getDatabase } = require('firebase-admin/database');
const cors = require('cors');

// --- CONFIG ---
const PORT = process.env.PORT || 3000;
const DB_URL = 'https://rahul-game-4f817-default-rtdb.firebaseio.com/';
const VAPID_PUBLIC_KEY = 'BPf9BmoCk9shYN5GSDT1bROW76nus4SOFmBlzR3n5sSexXi_JZvjhBPsRPH6pQx1fueyX7gMkpOuc0H9tsqYMCo';
const VAPID_PRIVATE_KEY = '06zpPnCs54KYx32M5t9l-rWMj_Nnjn3fW_ERAcyZe-M';
const SERVICE_ACCOUNT = require('./serviceAccountKey.json'); // Place your Firebase Admin SDK key here

// --- INIT ---
admin.initializeApp({
  credential: admin.credential.cert(SERVICE_ACCOUNT),
  databaseURL: DB_URL,
});
const db = getDatabase();

webpush.setVapidDetails(
  'mailto:your-email@example.com',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

const app = express();
app.use(cors());

// --- LISTEN FOR NUMBER UPDATES ---
// Listen for changes under /sattanamee/{name}/{date}
db.ref('sattanamee').on('child_changed', (snapshot) => {
  const sattaname = snapshot.key;
  // Only get the changed child (date)
  const changed = snapshot.ref.parent ? snapshot.ref.key : null;
  // If changed is not null, only process that date
  if (changed) {
    const numberObj = snapshot.child(changed).val();
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    if (changed === today && numberObj && numberObj.number) {
      sendNumberNotification(sattaname, changed, numberObj.number);
    }
  } else {
    // Fallback: process only today's date
    const today = new Date().toISOString().slice(0, 10);
    const numberObj = snapshot.child(today).val();
    if (numberObj && numberObj.number) {
      sendNumberNotification(sattaname, today, numberObj.number);
    }
  }
});

// Helper to send notification
async function sendNumberNotification(sattaname, date, number) {
  const title = 'Number Updated!';
  const body = `${sattaname} का आज का नंबर: ${number}`;
  const subsSnap = await db.ref('webPushSubscriptions').once('value');
  const subsObj = subsSnap.val();
  if (!subsObj) return;
  const subs = Object.values(subsObj);
  const payload = JSON.stringify({ title, body });
  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, payload);
    } catch (err) {
      console.error('Failed to send to a subscription:', err.message);
    }
  }
  console.log(`Notification sent for number update on ${date} (${sattaname})`);
}

app.get('/', (req, res) => {
  res.send('Web Push Notification Server is running.');
});

app.get('/send-test', async (req, res) => {
  const title = 'Test Notification';
  const body = 'This is a test notification from admin panel.';
  const subsSnap = await db.ref('webPushSubscriptions').once('value');
  const subsObj = subsSnap.val();
  if (!subsObj) return res.status(200).send('No subscribers found.');
  const subs = Object.values(subsObj);
  const payload = JSON.stringify({ title, body });
  let success = 0, fail = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, payload);
      success++;
    } catch (err) {
      fail++;
    }
  }
  res.status(200).send(`Notifications sent: ${success}, failed: ${fail}`);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
