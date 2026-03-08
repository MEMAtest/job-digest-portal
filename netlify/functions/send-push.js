const { getFirestore } = require("./_firebase");
const { withCors, handleOptions } = require("./_cors");
const webpush = require("web-push");

const vapidPublic = process.env.VAPID_PUBLIC_KEY;
const vapidPrivate = process.env.VAPID_PRIVATE_KEY;

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return handleOptions();

  if (event.httpMethod !== "POST") {
    return withCors({ error: "Method not allowed" }, 405);
  }

  if (!vapidPublic || !vapidPrivate) {
    return withCors({ error: "VAPID keys not configured" }, 500);
  }

  webpush.setVapidDetails(
    "mailto:push@jobsapp-3a2e2.netlify.app",
    vapidPublic,
    vapidPrivate
  );

  try {
    const payload = JSON.parse(event.body || "{}");
    const { title, body, tag, url } = payload;

    if (!title) {
      return withCors({ error: "title is required" }, 400);
    }

    const db = getFirestore();
    const subDoc = await db.collection("push_subscriptions").doc("browser_main").get();
    if (!subDoc.exists) {
      return withCors({ error: "No push subscription found" }, 404);
    }

    const subData = subDoc.data();
    const subscription = {
      endpoint: subData.endpoint,
      keys: subData.keys,
    };

    const pushPayload = JSON.stringify({ title, body: body || "", tag: tag || "default", url: url || "/" });
    await webpush.sendNotification(subscription, pushPayload);

    return withCors({ ok: true });
  } catch (error) {
    console.error("send-push error:", error);
    if (error.statusCode === 410 || error.statusCode === 404) {
      // Subscription expired or invalid — clean up
      try {
        const db = getFirestore();
        await db.collection("push_subscriptions").doc("browser_main").delete();
      } catch (_) {}
      return withCors({ error: "Subscription expired", expired: true }, 410);
    }
    return withCors({ error: error.message || "Push send failed" }, 500);
  }
};
