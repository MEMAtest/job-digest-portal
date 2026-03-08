import { subscribeToPush } from "./app.notifications.js";

const modal = document.getElementById("settings-modal");
const gearBtn = document.getElementById("settings-gear");
const closeBtn = modal?.querySelector(".settings-modal__close");
const backdrop = modal?.querySelector(".settings-modal__backdrop");

const pushEnabledCb = document.getElementById("settings-push-enabled");
const newJobsCb = document.getElementById("settings-new-jobs");
const followUpsCb = document.getElementById("settings-follow-ups");
const minFitRange = document.getElementById("settings-min-fit");
const minFitLabel = document.getElementById("settings-min-fit-label");
const statusEl = document.getElementById("settings-status");

const openSettings = async () => {
  if (!modal) return;
  // Load current prefs from Firestore
  try {
    const res = await fetch("/.netlify/functions/firestore-get?collection=push_subscriptions&id=browser_main");
    const json = await res.json();
    const data = json?.data;
    if (data?.prefs) {
      const p = data.prefs;
      if (pushEnabledCb) pushEnabledCb.checked = p.enabled !== false;
      if (newJobsCb) newJobsCb.checked = p.new_jobs !== false;
      if (followUpsCb) followUpsCb.checked = p.follow_ups !== false;
      if (minFitRange) minFitRange.value = p.new_jobs_min_fit || 80;
      if (minFitLabel) minFitLabel.textContent = minFitRange?.value || "80";
    }
    if (data?.endpoint) {
      if (statusEl) statusEl.textContent = "Status: Subscribed";
    }
  } catch (err) {
    console.error("Failed to load push prefs:", err);
  }
  modal.classList.remove("hidden");
};

const closeSettings = () => {
  if (modal) modal.classList.add("hidden");
};

const savePrefs = async () => {
  const prefs = {
    enabled: pushEnabledCb?.checked ?? true,
    new_jobs: newJobsCb?.checked ?? true,
    new_jobs_min_fit: Number(minFitRange?.value) || 80,
    follow_ups: followUpsCb?.checked ?? true,
  };
  try {
    await fetch("/.netlify/functions/firestore-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        collection: "push_subscriptions",
        id: "browser_main",
        data: { prefs, updated_at: new Date().toISOString() },
      }),
    });
  } catch (err) {
    console.error("Failed to save push prefs:", err);
  }
};

if (gearBtn) gearBtn.addEventListener("click", openSettings);
if (closeBtn) closeBtn.addEventListener("click", closeSettings);
if (backdrop) backdrop.addEventListener("click", closeSettings);

// Master push toggle — subscribe on enable
if (pushEnabledCb) {
  pushEnabledCb.addEventListener("change", async () => {
    if (pushEnabledCb.checked) {
      if (!("Notification" in window)) return;
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        pushEnabledCb.checked = false;
        return;
      }
      try {
        await subscribeToPush();
        if (statusEl) statusEl.textContent = "Status: Subscribed";
      } catch (err) {
        console.error("Push subscribe failed:", err);
        pushEnabledCb.checked = false;
        return;
      }
    }
    await savePrefs();
  });
}

if (newJobsCb) newJobsCb.addEventListener("change", savePrefs);
if (followUpsCb) followUpsCb.addEventListener("change", savePrefs);

if (minFitRange) {
  minFitRange.addEventListener("input", () => {
    if (minFitLabel) minFitLabel.textContent = minFitRange.value;
  });
  minFitRange.addEventListener("change", savePrefs);
}
