import { showToast } from "./app.core.js";

const PREFS_COLLECTION = "settings";
const PREFS_ID = "auto_apply_preferences";

const DEFAULT_PREFS = {
  enabled: false,
  min_fit_score: 75,
  min_salary: 0,
  require_salary_stated: false,
  exclude_keywords: [],
  exclude_companies: [],
  email_to: "ademolaomosanya@gmail.com",
};

const loadPrefs = async () => {
  try {
    const res = await fetch(`/.netlify/functions/firestore-get?collection=${PREFS_COLLECTION}&id=${PREFS_ID}`);
    const json = await res.json();
    return json?.data ? { ...DEFAULT_PREFS, ...json.data } : { ...DEFAULT_PREFS };
  } catch {
    return { ...DEFAULT_PREFS };
  }
};

const savePrefs = async (prefs) => {
  const res = await fetch("/.netlify/functions/firestore-update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      collection: PREFS_COLLECTION,
      id: PREFS_ID,
      data: { ...prefs, updated_at: new Date().toISOString() },
    }),
  });
  if (!res.ok) throw new Error("Failed to save preferences");
};

const triggerScan = async () => {
  const res = await fetch("/.netlify/functions/auto-apply-queue-background", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ manual: true }),
  });
  // Background functions return 202 with empty body — treat 202 as success
  if (res.status !== 202 && !res.ok) throw new Error("Scan trigger failed");
};

export const renderAutoApplyPrefs = (container) => {
  if (!container) return;

  container.innerHTML = `
    <div class="aa-prefs-form">
      <div class="aa-section__header">
        <h3>Auto-Apply Preferences</h3>
        <p>Configure which jobs get automatically queued for review.</p>
      </div>
      <div class="aa-prefs-form__body">
        <label class="aa-prefs-toggle">
          <span>Enable auto-apply scanning</span>
          <input type="checkbox" id="aa-pref-enabled" />
          <span class="aa-toggle-slider"></span>
        </label>
        <div class="aa-prefs-field">
          <label for="aa-pref-min-fit">Minimum fit score: <strong id="aa-pref-min-fit-label">75</strong></label>
          <input type="range" id="aa-pref-min-fit" min="50" max="100" step="5" value="75" />
        </div>
        <div class="aa-prefs-field">
          <label for="aa-pref-min-salary">Minimum salary (£/yr, 0 = any)</label>
          <input type="number" id="aa-pref-min-salary" min="0" step="5000" value="0" />
        </div>
        <label class="aa-prefs-toggle">
          <span>Require salary to be stated</span>
          <input type="checkbox" id="aa-pref-require-salary" />
          <span class="aa-toggle-slider"></span>
        </label>
        <div class="aa-prefs-field">
          <label for="aa-pref-exclude-keywords">Exclude keywords (comma-separated)</label>
          <input type="text" id="aa-pref-exclude-keywords" placeholder="contract, outside ir35, freelance" />
        </div>
        <div class="aa-prefs-field">
          <label for="aa-pref-exclude-companies">Exclude companies (comma-separated)</label>
          <input type="text" id="aa-pref-exclude-companies" placeholder="Company A, Company B" />
        </div>
        <div class="aa-prefs-field">
          <label for="aa-pref-email-to">Send review emails to</label>
          <input type="email" id="aa-pref-email-to" placeholder="ademolaomosanya@gmail.com" />
        </div>
        <div class="aa-prefs-actions">
          <button id="aa-save-prefs" class="btn btn-primary">Save preferences</button>
          <button id="aa-scan-now" class="btn btn-secondary">Scan now</button>
        </div>
        <div id="aa-prefs-status" class="aa-prefs-status hidden"></div>
      </div>
    </div>
  `;

  const enabledCb = container.querySelector("#aa-pref-enabled");
  const minFitRange = container.querySelector("#aa-pref-min-fit");
  const minFitLabel = container.querySelector("#aa-pref-min-fit-label");
  const minSalaryInput = container.querySelector("#aa-pref-min-salary");
  const requireSalaryCb = container.querySelector("#aa-pref-require-salary");
  const excludeKeywordsInput = container.querySelector("#aa-pref-exclude-keywords");
  const excludeCompaniesInput = container.querySelector("#aa-pref-exclude-companies");
  const emailToInput = container.querySelector("#aa-pref-email-to");
  const saveBtn = container.querySelector("#aa-save-prefs");
  const scanBtn = container.querySelector("#aa-scan-now");
  const statusEl = container.querySelector("#aa-prefs-status");

  const showStatus = (msg, isError = false) => {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.className = `aa-prefs-status ${isError ? "aa-prefs-status--error" : "aa-prefs-status--ok"}`;
    statusEl.classList.remove("hidden");
    setTimeout(() => statusEl.classList.add("hidden"), 4000);
  };

  // Load and populate
  loadPrefs().then((prefs) => {
    if (enabledCb) enabledCb.checked = prefs.enabled;
    if (minFitRange) { minFitRange.value = prefs.min_fit_score; if (minFitLabel) minFitLabel.textContent = prefs.min_fit_score; }
    if (minSalaryInput) minSalaryInput.value = prefs.min_salary;
    if (requireSalaryCb) requireSalaryCb.checked = prefs.require_salary_stated;
    if (excludeKeywordsInput) excludeKeywordsInput.value = (prefs.exclude_keywords || []).join(", ");
    if (excludeCompaniesInput) excludeCompaniesInput.value = (prefs.exclude_companies || []).join(", ");
    if (emailToInput) emailToInput.value = prefs.email_to || "ademolaomosanya@gmail.com";
  });

  if (minFitRange) {
    minFitRange.addEventListener("input", () => {
      if (minFitLabel) minFitLabel.textContent = minFitRange.value;
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving…";
      try {
        const prefs = {
          enabled: enabledCb?.checked ?? false,
          min_fit_score: Number(minFitRange?.value || 75),
          min_salary: Number(minSalaryInput?.value || 0),
          require_salary_stated: requireSalaryCb?.checked ?? false,
          exclude_keywords: (excludeKeywordsInput?.value || "").split(",").map((s) => s.trim()).filter(Boolean),
          exclude_companies: (excludeCompaniesInput?.value || "").split(",").map((s) => s.trim()).filter(Boolean),
          email_to: emailToInput?.value?.trim() || "ademolaomosanya@gmail.com",
        };
        await savePrefs(prefs);
        showStatus("Preferences saved.");
      } catch (err) {
        showStatus(err.message || "Save failed", true);
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = "Save preferences";
      }
    });
  }

  if (scanBtn) {
    scanBtn.addEventListener("click", async () => {
      scanBtn.disabled = true;
      scanBtn.textContent = "Scanning…";
      try {
        await triggerScan();
        showStatus("Scan running in background — review emails will arrive within ~60s. Queue will refresh automatically.");
        // Reload queue after 45s to pick up any newly queued jobs
        setTimeout(() => {
          const queueContainer = document.getElementById("auto-apply-queue-container");
          if (queueContainer && window._aaRenderQueue) window._aaRenderQueue();
        }, 45000);
      } catch (err) {
        showStatus(err.message || "Scan trigger failed", true);
      } finally {
        scanBtn.disabled = false;
        scanBtn.textContent = "Scan now";
      }
    });
  }
};

export const initAutoApplyPrefs = () => {
  const container = document.getElementById("auto-apply-prefs-container");
  if (container) renderAutoApplyPrefs(container);
};
