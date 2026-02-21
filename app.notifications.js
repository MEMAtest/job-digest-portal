import {
  state,
  db,
  notificationsCollection,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  updateDoc,
  doc,
  applyQuickFilter,
  NOTIFICATION_THRESHOLD,
} from "./app.core.js";

const notifyToggle = document.getElementById("notify-toggle");

const updateNotifyButton = () => {
  if (!notifyToggle || !("Notification" in window)) return;
  const perm = Notification.permission;
  notifyToggle.classList.remove("btn-notify--granted", "btn-notify--denied");
  if (perm === "granted") {
    notifyToggle.textContent = "Notifications on";
    notifyToggle.classList.add("btn-notify--granted");
  } else if (perm === "denied") {
    notifyToggle.textContent = "Notifications blocked";
    notifyToggle.classList.add("btn-notify--denied");
  } else {
    notifyToggle.textContent = "Enable notifications";
  }
};

updateNotifyButton();
if (notifyToggle) {
  notifyToggle.addEventListener("click", async () => {
    if (!("Notification" in window)) return;
    if (Notification.permission === "denied") return;
    await Notification.requestPermission();
    updateNotifyButton();
  });
}

export const checkNewJobNotifications = (jobs) => {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const knownRaw = localStorage.getItem("known_job_ids");
    const knownIds = knownRaw ? new Set(JSON.parse(knownRaw)) : new Set();
    const currentIds = jobs.map((j) => j.id);
    const newHighFit = jobs.filter((j) => !knownIds.has(j.id) && j.fit_score >= NOTIFICATION_THRESHOLD);
    if (newHighFit.length > 0) {
      const top = newHighFit[0];
      new Notification(`${newHighFit.length} new high-fit role${newHighFit.length > 1 ? "s" : ""}`, {
        body: `${top.role} at ${top.company} (${top.fit_score}% fit)${newHighFit.length > 1 ? ` and ${newHighFit.length - 1} more` : ""}`,
      });
    }
    localStorage.setItem("known_job_ids", JSON.stringify(currentIds));
  } catch (e) {
    console.error("Notification check failed:", e);
  }
};

export const checkFirestoreNotifications = async () => {
  if (!db || !("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const notifRef = collection(db, notificationsCollection);
    const notifQuery = query(notifRef, where("seen", "==", false), orderBy("created_at", "desc"), limit(5));
    const snap = await getDocs(notifQuery);
    if (snap.empty) return;
    const notices = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    notices.forEach((notice) => {
      const title = `New ${notice.fit_score || ""}% match`;
      const body = `${notice.role} at ${notice.company}`;
      const notif = new Notification(title.trim(), { body });
      notif.onclick = () => {
        const jobId = notice.job_id || notice.id;
        applyQuickFilter({
          label: "New notification",
          predicate: (job) => job.id === jobId,
        });
        if (state.handlers.setActiveTab) state.handlers.setActiveTab("live");
      };
    });
    await Promise.allSettled(
      notices.map((notice) =>
        updateDoc(doc(db, notificationsCollection, notice.id), {
          seen: true,
          seen_at: new Date().toISOString(),
        })
      )
    );
  } catch (error) {
    console.error("Notification fetch failed:", error);
  }
};
