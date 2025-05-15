import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import fetch from "node-fetch";

initializeApp();
const db = getFirestore("seasonticketalarm");

const TELEGRAM_BOT_TOKEN = '7489033053:AAECzex-WCxPAnLcF4gx9M6ouv_DhsfcEdw';
const TELEGRAM_CHAT_ID = '1263964120';

export const sendTelegramMessage = onSchedule({
  schedule: '* * * * *',
  region: 'europe-west1',
  timeoutSeconds: 60,
  memory: '1GiB'
}, async (event) => {
  try {
    // Send Telegram message
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: 'Test'
      })
    });

    const data = await response.json();
    
    // Log status to Firestore
    await db.collection('telegramLogs').add({
      timestamp: FieldValue.serverTimestamp(),
      success: data.ok,
      error: data.ok ? null : data.description,
      messageId: data.result?.message_id
    });

    if (!data.ok) {
      throw new Error(data.description || 'Unknown Telegram API error');
    }

    logger.log('Telegram message sent successfully');
  } catch (error) {
    logger.error('Telegram send failed:', error);
    await db.collection('telegramLogs').add({
      timestamp: FieldValue.serverTimestamp(),
      success: false,
      error: error.message
    });
  }
});
