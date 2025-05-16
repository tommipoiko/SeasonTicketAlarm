import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import { defineSecret } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import puppeteer from "puppeteer";
import chromium from "@sparticuz/chromium";
import fetch from "node-fetch";

initializeApp();
const db = getFirestore("seasonticketalarm");

const TELEGRAM_BOT_TOKEN = defineSecret("TELEGRAM_BOT_TOKEN");
const TELEGRAM_CHAT_ID = defineSecret("TELEGRAM_CHAT_ID");

async function checkSeatAvailabilityLogic() {
  let browser;
  try {
    browser = await puppeteer.launch({
      args: [...chromium.args, "--no-sandbox", "--disable-setuid-sandbox"],
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    });

    const page = await browser.newPage();
    
    // Configure browser
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36");

    // Navigate to page
    logger.log("Navigating to ticket page...");
    await page.goto("https://ilves.lippu.fi/season-card/season/25/subscription/1", {
      waitUntil: "networkidle2",
      timeout: 45000
    });

    // Wait for and click the .css-1byretu container directly
    logger.log("Looking for map container...");
    const mapContainer = await page.waitForSelector('.css-1byretu', { 
      timeout: 25000,
      visible: true 
    });

    if (!mapContainer) {
      await page.screenshot({ path: '/tmp/map_container_not_found.png' });
      throw new Error("Map container not found");
    }

    logger.log("Clicking map container...");
    await mapContainer.click({ delay: 200 });
    
    // Stabilization delay
    await new Promise(resolve => setTimeout(resolve, 5000));

    const s1626 = await page.waitForSelector('#s1626', { 
      timeout: 25000,
      visible: true 
    });

    const s1628 = await page.waitForSelector('#s1628', { 
      timeout: 25000,
      visible: true 
    });

    const s1640 = await page.waitForSelector('#s1640', { 
      timeout: 25000,
      visible: true 
    });

    return { 
      anyUnavailable: [s1626, s1628, s1640].some(s => s.classList.contains("no-hover-unavailable")), 
      seats 
    };
  } finally {
    if (browser) await browser.close();
  }
}

// Scheduled function
export const scheduledSeatCheck = onSchedule(
  {
    schedule: "* * * * *", // Every minute
    region: "europe-west1",
    timeoutSeconds: 120,
    memory: "3GiB",
    secrets: [TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID],
  },
  async (event) => {
    try {
      const { anyUnavailable, seats } = await checkSeatAvailabilityLogic();

      // Log monitoring status
      await db.collection("monitoringLogs").add({
        timestamp: FieldValue.serverTimestamp(),
        available: !anyUnavailable,
        seats: seats,
        error: null,
      });

      // Send Telegram alert if unavailable
      if (anyUnavailable) {
        const botToken = TELEGRAM_BOT_TOKEN.value();
        const chatId = TELEGRAM_CHAT_ID.value();

        const response = await fetch(
          `https://api.telegram.org/bot${botToken}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text:
                "🚨 Seats not available! Check: https://ilves.lippu.fi/season-card/season/25/subscription/1",
            }),
          }
        );

        const data = await response.json();
        await db.collection("telegramLogs").add({
          timestamp: FieldValue.serverTimestamp(),
          success: data.ok,
          error: data.ok ? null : data.description,
          messageId: data.result?.message_id,
        });

        if (!data.ok) {
          throw new Error(data.description || "Telegram API error");
        }
      }

      logger.log("Seat check completed successfully");
    } catch (error) {
      logger.error("Seat check failed:", error);
      await db.collection("monitoringLogs").add({
        timestamp: FieldValue.serverTimestamp(),
        available: false,
        error: error.message,
      });
    }
  }
);
