const { getFirestore } = require("./_firebase");
const webpush = require("web-push");

const vapidPublic = process.env.VAPID_PUBLIC_KEY;
const vapidPrivate = process.env.VAPID_PRIVATE_KEY;

const sendPush = async (subscription, payload) => {
  if (!vapidPublic || !vapidPrivate) return;
  webpush.setVapidDetails(
    "mailto:push@jobsapp-3a2e2.netlify.app",
    vapidPublic,
    vapidPrivate
  );
  await webpush.sendNotification(subscription, JSON.stringify(payload));
};

exports.handler = async () => {
  try {
    const db = getFirestore();

    const subDoc = await db.collection("push_subscriptions").doc("browser_main").get();
    if (!subDoc.exists) return;
    const subData = subDoc.data();
    const prefs = subData.prefs || {};
    if (!prefs.enabled) return;

    const subscription = { endpoint: subData.endpoint, keys: subData.keys };

    const metaDoc = await db.collection("push_subscriptions").doc("_check_meta").get();
    const lastCheck = metaDoc.exists ? metaDoc.data().last_check : null;
    const lastCheckDate = lastCheck ? new Date(lastCheck) : new Date(Date.now() - 24 * 60 * 60 * 1000);

    const notifications = [];

    if (prefs.new_jobs !== false) {
      const minFit = prefs.new_jobs_min_fit || 80;
      const collectionName = process.env.FIREBASE_COLLECTION || "jobs";
      const jobsSnap = await db
        .collection(collectionName)
        .where("fit_score", ">=", minFit)
        .orderBy("fit_score", "desc")
        .limit(20)
        .get();

      const newJobs = jobsSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((job) => {
          const added = job.added_at || job.created_at || job.updated_at;
          return added && new Date(added) > lastCheckDate;
        });

      if (newJobs.length > 0) {
        const top = newJobs[0];
        notifications.push({
          title: `${newJobs.length} new high-fit role${newJobs.length > 1 ? "s" : ""} found`,
          body: `Top: ${top.role} @ ${top.company} (${top.fit_score}% fit)`,
          tag: "new-jobs",
          url: "/?tab=live",
        });
      }
    }

    if (prefs.follow_ups !== false) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
      const todayIso = today.toISOString();
      const tomorrowIso = tomorrow.toISOString();

      const collectionName = process.env.FIREBASE_COLLECTION || "jobs";
      const followSnap = await db
        .collection(collectionName)
        .where("follow_up_date", ">=", todayIso)
        .where("follow_up_date", "<", tomorrowIso)
        .limit(10)
        .get();

      const dueJobs = followSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((job) => {
          const status = (job.application_status || "saved").toLowerCase();
          return status !== "rejected" && status !== "offer";
        });

      if (dueJobs.length > 0) {
        const first = dueJobs[0];
        notifications.push({
          title: "Follow-up Reminder",
          body: `Follow up: ${first.company} — ${first.role}${dueJobs.length > 1 ? ` (+${dueJobs.length - 1} more)` : ""} — due today`,
          tag: "follow-up",
          url: "/?tab=dashboard",
        });
      }
    }

    let sent = 0;
    for (const notif of notifications) {
      try {
        await sendPush(subscription, notif);
        sent++;
      } catch (err) {
        console.error("Push send failed:", err.message);
        if (err.statusCode === 410 || err.statusCode === 404) {
          await db.collection("push_subscriptions").doc("browser_main").delete();
          break;
        }
      }
    }

    await db.collection("push_subscriptions").doc("_check_meta").set(
      { last_check: new Date().toISOString() },
      { merge: true }
    );

    console.log(`Scheduled check complete: sent ${sent}/${notifications.length}`);
  } catch (error) {
    console.error("Scheduled check error:", error);
  }
};
