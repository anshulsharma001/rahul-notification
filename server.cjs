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
app.use(express.json()); // Parse JSON bodies

// --- LISTEN FOR NUMBER UPDATES ---
const sattanameeRef = db.ref('sattanamee');

// Helper to get today's date in YYYY-MM-DD format
function getTodayDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Helper to add a listener for a sattaname's dates
function addDateListener(sattaname) {
  const sattanameRef = db.ref(`sattanamee/${sattaname}`);
  
  // Listen for changes to date nodes
  sattanameRef.on('child_changed', (dateSnap) => {
    const date = dateSnap.key;
    const numberObj = dateSnap.val();
    const today = getTodayDate();
    
    console.log(`[Listener] ${sattaname} - ${date} changed. Today: ${today}`);
    console.log(`[Listener] Changed data:`, JSON.stringify(numberObj));
    
    // Check if this is today's date and has a number
    if (date === today) {
      const numberValue = numberObj?.number || numberObj?.value || (typeof numberObj === 'string' ? numberObj : null);
      
      if (numberValue) {
        console.log(`[Notify] ✅ Match! Sending notification for ${sattaname} ${date} number: ${numberValue}`);
        sendNumberNotification(sattaname, date, numberValue);
      } else {
        console.log(`[Notify] ⚠️ Date matches today but no number found in:`, JSON.stringify(numberObj));
      }
    } else {
      console.log(`[Notify] ⏭️ Skipping - date ${date} is not today (${today})`);
    }
  });
  
  // Also listen for new date nodes (in case a new entry is created for today)
  sattanameRef.on('child_added', (dateSnap) => {
    const date = dateSnap.key;
    const numberObj = dateSnap.val();
    const today = getTodayDate();
    
    console.log(`[Listener] ${sattaname} - ${date} added. Today: ${today}`);
    
    if (date === today) {
      const numberValue = numberObj?.number || numberObj?.value || (typeof numberObj === 'string' ? numberObj : null);
      
      if (numberValue) {
        console.log(`[Notify] ✅ New entry for today! Sending notification for ${sattaname} ${date} number: ${numberValue}`);
        sendNumberNotification(sattaname, date, numberValue);
      }
    }
  });
}

// Listen for new sattaname keys
sattanameeRef.on('child_added', (sattanameSnap) => {
  const sattaname = sattanameSnap.key;
  console.log(`[Listener] New sattaname detected: ${sattaname}`);
  addDateListener(sattaname);
});

// Also add listeners for all existing sattaname keys at startup
console.log('[Init] Setting up listeners for all existing sattanames...');
sattanameeRef.once('value', (snapshot) => {
  const data = snapshot.val();
  if (!data) {
    console.log('[Init] No sattanames found in database');
    return;
  }
  
  const sattanameKeys = Object.keys(data);
  console.log(`[Init] Found ${sattanameKeys.length} sattanames:`, sattanameKeys);
  sattanameKeys.forEach(sattaname => {
    console.log(`[Init] Adding listener for: ${sattaname}`);
    addDateListener(sattaname);
  });
  console.log('[Init] All listeners set up!');
});

// Helper to send notification
async function sendNumberNotification(sattaname, date, number) {
  const title = 'Number Updated!';
  const body = `${sattaname} का आज का नंबर: ${number}`;
  
  try {
    const subsSnap = await db.ref('webPushSubscriptions').once('value');
    const subsObj = subsSnap.val();
    
    if (!subsObj || Object.keys(subsObj).length === 0) {
      console.log('[Notify] No subscriptions found in database');
      return;
    }
    
    // Deduplicate by endpoint
    const endpointMap = {};
    Object.values(subsObj).forEach(sub => {
      if (sub && sub.endpoint) {
        endpointMap[sub.endpoint] = sub;
      }
    });
    
    const uniqueSubs = Object.values(endpointMap);
    console.log(`[Notify] Found ${uniqueSubs.length} unique subscriptions`);
    
    if (uniqueSubs.length === 0) {
      console.log('[Notify] No valid subscriptions found');
      return;
    }
    
    const payload = JSON.stringify({ title, body });
    let successCount = 0;
    let failCount = 0;
    const invalidSubs = [];
    
    for (const sub of uniqueSubs) {
      try {
        await webpush.sendNotification(sub, payload);
        successCount++;
        console.log(`[Notify] Successfully sent to: ${sub.endpoint.substring(0, 50)}...`);
      } catch (err) {
        failCount++;
        console.error(`[Notify] Failed to send to subscription:`, err.message);
        
        // Remove invalid/expired subscriptions
        if (err.statusCode === 410 || err.statusCode === 404) {
          invalidSubs.push(sub.endpoint);
          console.log(`[Notify] Marking subscription as invalid (${err.statusCode}): ${sub.endpoint.substring(0, 50)}...`);
        }
      }
    }
    
    // Clean up invalid subscriptions
    if (invalidSubs.length > 0) {
      const allSubs = subsSnap.val();
      for (const [key, sub] of Object.entries(allSubs)) {
        if (sub && invalidSubs.includes(sub.endpoint)) {
          await db.ref(`webPushSubscriptions/${key}`).remove();
          console.log(`[Notify] Removed invalid subscription: ${key}`);
        }
      }
    }
    
    console.log(`[Notify] Notification sent for ${sattaname} (${date}): ${successCount} success, ${failCount} failed`);
  } catch (error) {
    console.error('[Notify] Error in sendNumberNotification:', error);
  }
}

app.get('/', (req, res) => {
  res.send('Web Push Notification Server is running.');
});

// Debug endpoint to check current subscriptions and date
app.get('/debug', async (req, res) => {
  try {
    const subsSnap = await db.ref('webPushSubscriptions').once('value');
    const subsObj = subsSnap.val();
    const subCount = subsObj ? Object.keys(subsObj).length : 0;
    
    const sattanameeSnap = await db.ref('sattanamee').once('value');
    const sattanameeData = sattanameeSnap.val();
    const sattanameKeys = sattanameeData ? Object.keys(sattanameeData) : [];
    
    const today = getTodayDate();
    
    res.status(200).json({
      today: today,
      subscriptions: subCount,
      sattanames: sattanameKeys,
      message: 'Server is running and listening for updates'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Manual trigger endpoint - can be called after number update
app.post('/notify-number-update', async (req, res) => {
  try {
    const { sattaname, date, number } = req.body;
    
    if (!sattaname || !date || !number) {
      return res.status(400).json({ error: 'Missing required fields: sattaname, date, number' });
    }
    
    console.log(`[Manual] Manual trigger for ${sattaname} - ${date} number: ${number}`);
    await sendNumberNotification(sattaname, date, number);
    
    res.status(200).json({ success: true, message: 'Notification triggered' });
  } catch (error) {
    console.error('[Manual] Error in manual trigger:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/send-test', async (req, res) => {
  try {
    const title = 'Test Notification';
    const body = 'This is a test notification from admin panel.';
    
    const subsSnap = await db.ref('webPushSubscriptions').once('value');
    const subsObj = subsSnap.val();
    
    if (!subsObj || Object.keys(subsObj).length === 0) {
      return res.status(200).send('No subscribers found. Make sure users have enabled notifications.');
    }
    
    // Deduplicate by endpoint
    const endpointMap = {};
    Object.values(subsObj).forEach(sub => {
      if (sub && sub.endpoint) {
        endpointMap[sub.endpoint] = sub;
      }
    });
    
    const uniqueSubs = Object.values(endpointMap);
    console.log(`[Test] Sending test notification to ${uniqueSubs.length} unique subscriptions`);
    
    if (uniqueSubs.length === 0) {
      return res.status(200).send('No valid subscriptions found.');
    }
    
    const payload = JSON.stringify({ title, body });
    let success = 0;
    let fail = 0;
    const errors = [];
    
    for (const sub of uniqueSubs) {
      try {
        await webpush.sendNotification(sub, payload);
        success++;
      } catch (err) {
        fail++;
        errors.push(err.message);
        console.error(`[Test] Failed to send: ${err.message}`);
      }
    }
    
    const message = `Notifications sent: ${success} success, ${fail} failed. Total subscriptions: ${uniqueSubs.length}`;
    console.log(`[Test] ${message}`);
    res.status(200).send(message);
  } catch (error) {
    console.error('[Test] Error sending test notification:', error);
    res.status(500).send(`Error: ${error.message}`);
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Listening for number updates in Firebase...`);
  console.log(`📅 Today's date: ${getTodayDate()}`);
  console.log(`🔔 Notification server ready!`);
});
