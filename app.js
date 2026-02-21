import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  orderBy,
  query,
  limit,
  updateDoc,
  setDoc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const summaryLine = document.getElementById("summary-line");
const jobsContainer = document.getElementById("jobs");
const topPickContainer = document.getElementById("top-pick"); // legacy, replaced by apply-hub
const sourceStatsContainer = document.getElementById("source-stats");
const roleSuggestionsContainer = document.getElementById("role-suggestions");
const candidatePrepContainer = document.getElementById("candidate-prep");
const refreshBtn = document.getElementById("refresh-btn");
const runNowBtn = document.getElementById("run-now-btn");
const runStatusLine = document.getElementById("run-status-line");
const dashboardStatsContainer = document.getElementById("dashboard-stats");
const breadcrumbLine = document.getElementById("breadcrumb");
const alertBanner = document.getElementById("alert-banner");
const prepOverlay = document.getElementById("prep-overlay");
const prepOverlayTitle = document.getElementById("prep-overlay-title");
const prepOverlayMeta = document.getElementById("prep-overlay-meta");
const prepOverlayContent = document.getElementById("prep-content");
const prepCloseBtn = document.getElementById("prep-close");

const searchInput = document.getElementById("search");
const minFitSelect = document.getElementById("minFit");
const sourceSelect = document.getElementById("source");
const locationSelect = document.getElementById("location");
const statusSelect = document.getElementById("status");
const ukOnlyCheckbox = document.getElementById("ukOnly");

let db = null;
let collectionName = "jobs";
let statsCollection = "job_stats";
let suggestionsCollection = "role_suggestions";
let candidatePrepCollection = "candidate_prep";
let runRequestsCollection = "run_requests";

const state = {
  jobs: [],
  sources: new Set(),
  locations: new Set(),
  candidatePrep: {},
  activePrepJob: null,
  hubSort: null,
  hubNotesTimers: {},
  triageQueue: [],
  triageIndex: 0,
  triageStats: { dismissed: 0, shortlisted: 0, apply: 0 },
  triageLastAction: null,
  selectedJobs: new Set(),
};

let quickFilterPredicate = null;
let quickFilterLabel = "";
let uniqueCompanyOnly = false;
let mobileNavObserver = null;

const formatFitBadge = (score) => {
  if (score >= 80) return "badge badge--green";
  if (score >= 72) return "badge badge--blue";
  return "badge badge--amber";
};

const getLocationBadgeClass = (location) => {
  if (!location) return "badge badge--amber badge--location";
  const loc = location.toLowerCase();
  if (loc.includes("remote") || loc.includes("hybrid")) return "badge badge--green badge--location";
  if (
    loc.includes("london") ||
    loc.includes(" uk") ||
    loc.startsWith("uk") ||
    loc.includes("united kingdom") ||
    loc.includes("england") ||
    loc.includes("scotland") ||
    loc.includes("wales")
  )
    return "badge badge--blue badge--location";
  return "badge badge--amber badge--location";
};

const formatPosted = (value) => {
  if (!value) return "Date unavailable";
  const text = String(value);
  const lower = text.toLowerCase();
  if (lower.includes("ago") || lower.includes("yesterday") || lower.includes("today")) {
    return text;
  }
  const date = new Date(text);
  if (!Number.isNaN(date.getTime())) {
    return date.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }
  return text;
};

const isUkOrRemote = (location) => {
  if (!location) return false;
  const loc = location.toLowerCase();
  return (
    loc.includes("london") ||
    loc.includes("uk") ||
    loc.includes("united kingdom") ||
    loc.includes("remote") ||
    loc.includes("hybrid") ||
    loc.includes("england") ||
    loc.includes("scotland") ||
    loc.includes("wales")
  );
};

const parseDateValue = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date;
  return null;
};

const quickFilterBar = document.getElementById("quick-filter");

const clearQuickFilter = () => {
  quickFilterPredicate = null;
  quickFilterLabel = "";
  uniqueCompanyOnly = false;
  if (quickFilterBar) {
    quickFilterBar.classList.add("hidden");
    quickFilterBar.innerHTML = "";
  }
  renderJobs();
};

const applyQuickFilter = ({ label, predicate, status, uniqueCompanies } = {}) => {
  quickFilterPredicate = predicate || null;
  quickFilterLabel = label || "";
  uniqueCompanyOnly = Boolean(uniqueCompanies);
  if (status !== undefined) {
    statusSelect.value = status;
  }
  if (quickFilterBar) {
    if (!quickFilterLabel && !uniqueCompanyOnly) {
      quickFilterBar.classList.add("hidden");
      quickFilterBar.innerHTML = "";
    } else {
      const labelText = quickFilterLabel || (uniqueCompanyOnly ? "Unique companies only" : "Quick filter");
      quickFilterBar.classList.remove("hidden");
      quickFilterBar.innerHTML = `
        <div class="quick-filter__label">${escapeHtml(labelText)}</div>
        <button class="btn btn-tertiary quick-filter__clear">Clear</button>
      `;
      const clearBtn = quickFilterBar.querySelector(".quick-filter__clear");
      if (clearBtn) {
        clearBtn.addEventListener("click", clearQuickFilter);
      }
    }
  }
  renderJobs();
  setActiveTab("live");
};

const escapeHtml = (value) => {
  if (!value) return "";
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
};

const formatInlineText = (value) => {
  if (!value) return "";
  const safe = escapeHtml(String(value));
  return safe
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\\n/g, "<br>")
    .replace(/\r?\n/g, "<br>");
};

const safeLocalStorageGet = (key) => {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    return null;
  }
};

const safeLocalStorageSet = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    // ignore storage failures (private mode, blocked storage)
  }
};

const loadHubSort = () => {
  try {
    const stored = safeLocalStorageGet("hub_sort");
    if (stored) return JSON.parse(stored);
  } catch (error) {
    // ignore
  }
  return { field: "fit_score", asc: false };
};

const saveHubSort = (sort) => {
  try {
    safeLocalStorageSet("hub_sort", JSON.stringify(sort));
  } catch (error) {
    // ignore
  }
};

state.hubSort = loadHubSort();

const parseApplicantCount = (value) => {
  if (!value) return null;
  const match = String(value).match(/(\d[\d,]*)/);
  if (!match) return null;
  return Number(match[1].replace(/,/g, ""));
};

const showToast = (message, duration = 2500) => {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("toast--visible"));
  setTimeout(() => {
    el.classList.remove("toast--visible");
    setTimeout(() => el.remove(), 300);
  }, duration);
};

const showConfirmToast = (message, actionLabel, onConfirm, duration = 8000) => {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();
  const el = document.createElement("div");
  el.className = "toast toast--confirm";
  const msgSpan = document.createElement("span");
  msgSpan.textContent = message;
  el.appendChild(msgSpan);
  const btn = document.createElement("button");
  btn.className = "toast__action";
  btn.textContent = actionLabel;
  const timer = setTimeout(() => {
    el.classList.remove("toast--visible");
    setTimeout(() => el.remove(), 300);
  }, duration);
  btn.addEventListener("click", () => {
    clearTimeout(timer);
    onConfirm();
    el.classList.remove("toast--visible");
    setTimeout(() => el.remove(), 300);
  });
  el.appendChild(btn);
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("toast--visible"));
};

const copyToClipboard = async (text) => {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showToast("Copied to clipboard.");
  } catch (error) {
    console.error(error);
    showToast("Copy failed. Please select and copy manually.");
  }
};

const getTailoredCvPlainText = (job) => {
  const sections = job.tailored_cv_sections || {};
  const lines = [];
  lines.push("ADE OMOSANYA");
  lines.push("London, UK | ade@omosanya.com | linkedin.com/in/adeomosanya | omosanya.com\n");
  lines.push("PROFESSIONAL SUMMARY");
  lines.push(sections.summary || "Senior Product Manager with 8+ years across financial services, regtech and fintech. Specialist in onboarding, KYC/AML, and platform product strategy.\n");
  lines.push("KEY ACHIEVEMENTS");
  (sections.key_achievements || [
    "- Led digital onboarding transformation serving 3M+ customers, reducing drop-off by 35%",
    "- Delivered KYC remediation platform processing 500K+ cases across 6 jurisdictions",
    "- Drove API-first integration strategy connecting 15+ downstream systems",
    "- Shipped sanctions screening product reducing false positives by 40%",
    "- Built product analytics framework improving feature adoption by 25%",
  ]).forEach(b => lines.push(b.startsWith("- ") ? b : `- ${b}`));
  lines.push("\nPROFESSIONAL EXPERIENCE");
  lines.push("\nVistra Corporate Services | Senior Product Manager | 2022 - Present");
  (sections.vistra_bullets || [
    "- Own end-to-end onboarding and KYC product suite across 6 EMEA jurisdictions",
    "- Led platform migration reducing onboarding time from 21 to 7 days",
    "- Managed cross-functional team of 12 engineers and 3 designers",
    "- Delivered API integration layer connecting to 15+ compliance data providers",
    "- Shipped automated risk scoring reducing manual review by 60%",
    "- Drove product discovery and roadmap prioritisation using RICE framework",
    "- Established product analytics with Mixpanel tracking 50+ key events",
    "- Led regulatory change programme for EU AML 6th Directive compliance",
  ]).forEach(b => lines.push(b.startsWith("- ") ? b : `- ${b}`));
  lines.push("\nEbury Partners | Product Manager | 2020 - 2022");
  (sections.ebury_bullets || [
    "- Owned client onboarding and KYB product for FX/payments platform",
    "- Reduced onboarding cycle time by 45% through workflow automation",
    "- Shipped API-first partner integration used by 200+ intermediaries",
    "- Led cross-border payments compliance product across 20+ currencies",
  ]).forEach(b => lines.push(b.startsWith("- ") ? b : `- ${b}`));
  lines.push("\nMEMA Consulting | Product Lead | 2018 - 2020");
  lines.push("- Led delivery of regtech SaaS platform for AML compliance");
  lines.push("- Managed product backlog and sprint planning for team of 8");
  lines.push("- Drove client onboarding reducing implementation time by 30%");
  lines.push("\nElucidate | Product Manager | 2017 - 2018");
  lines.push("- Owned financial crime risk rating product for banking clients");
  lines.push("- Shipped ML-powered risk scoring achieving 85% prediction accuracy");
  lines.push("\nN26 | Associate Product Manager | 2016 - 2017");
  lines.push("- Contributed to mobile banking onboarding flow serving 2M+ users");
  lines.push("- Ran A/B tests improving KYC completion rate by 18%");
  lines.push("\nPrevious Experience | Various Roles | 2014 - 2016");
  lines.push("- Business analyst and operations roles in financial services");
  lines.push("\nTECHNICAL & PRODUCT CAPABILITIES");
  lines.push("Product: Roadmapping, OKRs, RICE, Discovery, A/B Testing, Analytics");
  lines.push("Technical: SQL, Python, REST APIs, Jira, Confluence, Figma, Mixpanel, Amplitude");
  lines.push("Domain: KYC, AML, Onboarding, Sanctions Screening, Payments, Open Banking");
  lines.push("\nEDUCATION & CERTIFICATIONS");
  lines.push("BSc Economics | University of Nottingham");
  lines.push("ICA Certificate in Compliance | International Compliance Association");
  return lines.join("\n");
};

const buildTailoredCvHtml = (job) => {
  const s = job.tailored_cv_sections || {};
  const summary = s.summary || "Senior Product Manager with 8+ years across financial services, regtech and fintech. Specialist in onboarding, KYC/AML, and platform product strategy. Proven track record of delivering complex regulatory products at scale.";
  const achievements = s.key_achievements || [
    "Led digital onboarding transformation serving 3M+ customers, reducing drop-off by 35%",
    "Delivered KYC remediation platform processing 500K+ cases across 6 jurisdictions",
    "Drove API-first integration strategy connecting 15+ downstream systems",
    "Shipped sanctions screening product reducing false positives by 40%",
    "Built product analytics framework improving feature adoption by 25%",
  ];
  const vistraBullets = s.vistra_bullets || [
    "Own end-to-end onboarding and KYC product suite across 6 EMEA jurisdictions",
    "Led platform migration reducing onboarding time from 21 to 7 days",
    "Managed cross-functional team of 12 engineers and 3 designers",
    "Delivered API integration layer connecting to 15+ compliance data providers",
    "Shipped automated risk scoring reducing manual review by 60%",
    "Drove product discovery and roadmap prioritisation using RICE framework",
    "Established product analytics with Mixpanel tracking 50+ key events",
    "Led regulatory change programme for EU AML 6th Directive compliance",
  ];
  const eburyBullets = s.ebury_bullets || [
    "Owned client onboarding and KYB product for FX/payments platform",
    "Reduced onboarding cycle time by 45% through workflow automation",
    "Shipped API-first partner integration used by 200+ intermediaries",
    "Led cross-border payments compliance product across 20+ currencies",
  ];

  const esc = (t) => escapeHtml(String(t));
  const bulletHtml = (items) => items.map(b => `<div style="margin:0 0 3px 0;padding-left:14px;text-indent:-14px;line-height:1.35;">- ${esc(b.replace(/^-\s*/, ""))}</div>`).join("");

  const container = document.createElement("div");
  container.innerHTML = `
    <div style="font-family:'Inter',Helvetica,Arial,sans-serif;color:#1f2937;padding:0;margin:0;width:180mm;font-size:9.5pt;line-height:1.4;">
      <!-- Header -->
      <div style="text-align:center;margin-bottom:10px;">
        <div style="font-size:20pt;font-weight:700;letter-spacing:0.5px;color:#0f172a;margin-bottom:4px;">ADE OMOSANYA</div>
        <div style="font-size:8.5pt;color:#475569;">London, UK &nbsp;|&nbsp; ade@omosanya.com &nbsp;|&nbsp; linkedin.com/in/adeomosanya &nbsp;|&nbsp; omosanya.com</div>
      </div>

      <!-- Professional Summary -->
      <div style="margin-bottom:8px;">
        <div style="font-size:10pt;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;border-bottom:1.5px solid #0f172a;padding-bottom:2px;margin-bottom:5px;color:#0f172a;">Professional Summary</div>
        <div style="font-size:9.5pt;line-height:1.45;">${esc(summary)}</div>
      </div>

      <!-- Key Achievements -->
      <div style="margin-bottom:8px;">
        <div style="font-size:10pt;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;border-bottom:1.5px solid #0f172a;padding-bottom:2px;margin-bottom:5px;color:#0f172a;">Key Achievements</div>
        ${bulletHtml(achievements)}
      </div>

      <!-- Professional Experience -->
      <div style="margin-bottom:8px;">
        <div style="font-size:10pt;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;border-bottom:1.5px solid #0f172a;padding-bottom:2px;margin-bottom:5px;color:#0f172a;">Professional Experience</div>

        <div style="margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px;">
            <span style="font-weight:700;font-size:9.5pt;">Vistra Corporate Services</span>
            <span style="font-size:8.5pt;color:#475569;">2022 - Present</span>
          </div>
          <div style="font-style:italic;font-size:9pt;color:#475569;margin-bottom:3px;">Senior Product Manager</div>
          ${bulletHtml(vistraBullets)}
        </div>

        <div style="margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px;">
            <span style="font-weight:700;font-size:9.5pt;">Ebury Partners</span>
            <span style="font-size:8.5pt;color:#475569;">2020 - 2022</span>
          </div>
          <div style="font-style:italic;font-size:9pt;color:#475569;margin-bottom:3px;">Product Manager</div>
          ${bulletHtml(eburyBullets)}
        </div>

        <div style="margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px;">
            <span style="font-weight:700;font-size:9.5pt;">MEMA Consulting</span>
            <span style="font-size:8.5pt;color:#475569;">2018 - 2020</span>
          </div>
          <div style="font-style:italic;font-size:9pt;color:#475569;margin-bottom:3px;">Product Lead</div>
          ${bulletHtml([
            "Led delivery of regtech SaaS platform for AML compliance",
            "Managed product backlog and sprint planning for team of 8",
            "Drove client onboarding reducing implementation time by 30%",
          ])}
        </div>

        <div style="margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px;">
            <span style="font-weight:700;font-size:9.5pt;">Elucidate</span>
            <span style="font-size:8.5pt;color:#475569;">2017 - 2018</span>
          </div>
          <div style="font-style:italic;font-size:9pt;color:#475569;margin-bottom:3px;">Product Manager</div>
          ${bulletHtml([
            "Owned financial crime risk rating product for banking clients",
            "Shipped ML-powered risk scoring achieving 85% prediction accuracy",
          ])}
        </div>

        <div style="margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px;">
            <span style="font-weight:700;font-size:9.5pt;">N26</span>
            <span style="font-size:8.5pt;color:#475569;">2016 - 2017</span>
          </div>
          <div style="font-style:italic;font-size:9pt;color:#475569;margin-bottom:3px;">Associate Product Manager</div>
          ${bulletHtml([
            "Contributed to mobile banking onboarding flow serving 2M+ users",
            "Ran A/B tests improving KYC completion rate by 18%",
          ])}
        </div>

        <div style="margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px;">
            <span style="font-weight:700;font-size:9.5pt;">Previous Experience</span>
            <span style="font-size:8.5pt;color:#475569;">2014 - 2016</span>
          </div>
          <div style="font-style:italic;font-size:9pt;color:#475569;margin-bottom:3px;">Various Roles</div>
          ${bulletHtml(["Business analyst and operations roles in financial services"])}
        </div>
      </div>

      <!-- Technical & Product Capabilities -->
      <div style="margin-bottom:8px;">
        <div style="font-size:10pt;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;border-bottom:1.5px solid #0f172a;padding-bottom:2px;margin-bottom:5px;color:#0f172a;">Technical & Product Capabilities</div>
        <div style="margin-bottom:2px;"><strong>Product:</strong> Roadmapping, OKRs, RICE, Discovery, A/B Testing, Analytics</div>
        <div style="margin-bottom:2px;"><strong>Technical:</strong> SQL, Python, REST APIs, Jira, Confluence, Figma, Mixpanel, Amplitude</div>
        <div><strong>Domain:</strong> KYC, AML, Onboarding, Sanctions Screening, Payments, Open Banking</div>
      </div>

      <!-- Education & Certifications -->
      <div>
        <div style="font-size:10pt;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;border-bottom:1.5px solid #0f172a;padding-bottom:2px;margin-bottom:5px;color:#0f172a;">Education & Certifications</div>
        <div style="margin-bottom:2px;"><strong>BSc Economics</strong> — University of Nottingham</div>
        <div><strong>ICA Certificate in Compliance</strong> — International Compliance Association</div>
      </div>
    </div>
  `;
  if (!container.firstElementChild) {
    const fallback = document.createElement("div");
    fallback.textContent = "CV template could not be generated.";
    return fallback;
  }
  return container.firstElementChild;
};

const quickApply = async (job, card) => {
  const status = (job.application_status || "saved").toLowerCase();
  const shouldMarkApplied = status === "saved" || status === "shortlisted" || status === "ready_to_apply";

  // 1. Clipboard — must happen first within user gesture
  const cvText = getTailoredCvPlainText(job);
  const coverLetter = job.cover_letter || "";
  const clipboardPayload = `=== TAILORED CV ===\n${cvText}\n\n=== COVER LETTER ===\n${coverLetter}`;
  try {
    await navigator.clipboard.writeText(clipboardPayload);
  } catch (err) {
    console.error("Clipboard write failed:", err);
  }

  // 2. Open link (validate scheme)
  if (job.link && /^https?:\/\//.test(job.link)) {
    window.open(job.link, "_blank", "noopener");
  }

  // 2b. Mark link visited in checklist
  await saveApplyChecklist(job, { job_link_visited: true });

  // 3. Confirm toast — don't auto-mark as applied
  if (shouldMarkApplied) {
    if (db) {
      showConfirmToast("CV copied & link opened", "Mark as Applied", async () => {
        await saveApplyChecklist(job, { job_link_visited: true }, { markApplied: true });
        const today = new Date().toISOString().slice(0, 10);
        const now = new Date().toISOString();

        if (card) {
          const metaDivs = card.querySelectorAll(".job-card__meta");
          metaDivs.forEach((m) => {
            if (m.textContent.startsWith("Status:")) m.textContent = "Status: applied";
          });
          const trackingSelect = card.querySelector(".tracking-status");
          if (trackingSelect) trackingSelect.value = "applied";
          const appliedInput = card.querySelector(".tracking-applied");
          if (appliedInput) appliedInput.value = today;
          const lastTouchInput = card.querySelector(".tracking-last-touch");
          if (lastTouchInput) lastTouchInput.value = now.slice(0, 10);
          const qaBtn = card.querySelector(".btn-quick-apply");
          if (qaBtn) {
            qaBtn.textContent = "Re-copy & Open";
            qaBtn.classList.add("btn-quick-apply--done");
          }
        }
        showToast("Marked as applied");
      });
    } else {
      showToast("Copied + opened link");
    }
  } else {
    showToast("Copied + opened link");
  }
};

const normaliseList = (items) => {
  if (!items) return [];
  if (Array.isArray(items)) return items;
  if (typeof items === "string") {
    return items
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }
  return [String(items)];
};

const formatList = (items) => {
  const list = normaliseList(items);
  if (!list.length) return "Not available yet.";
  return `<ul>${list
    .map((item) => {
      const cleaned = String(item).replace(/^\s*[•*-]\s+/, "");
      return `<li>${formatInlineText(cleaned)}</li>`;
    })
    .join("")}</ul>`;
};

const buildPrepQa = (job) => {
  const questions = job.prep_questions || [];
  if (!questions.length) {
    return "Not available yet.";
  }

  const answerSets = Array.isArray(job.prep_answer_sets) ? job.prep_answer_sets : [];
  const fallbackAnswers = Array.isArray(job.prep_answers) ? job.prep_answers : [];

  return questions
    .map((question, idx) => {
      let answers = [];
      if (answerSets[idx] && Array.isArray(answerSets[idx].answers)) {
        answers = answerSets[idx].answers;
      } else if (Array.isArray(answerSets[idx])) {
        answers = answerSets[idx].map((text, i) => ({ score: 8 + i, text }));
      } else if (fallbackAnswers[idx]) {
        answers = [{ score: 9, text: fallbackAnswers[idx] }];
      }

      const labels = { 8: "8/10 · Solid", 9: "9/10 · Strong", 10: "10/10 · Elite" };
      const options = [8, 9, 10]
        .map((score) => {
          const match = answers.find((ans) => Number(ans.score) === score) || answers[0] || { text: "" };
          const encoded = encodeURIComponent(match.text || "");
          return `<option value="${score}" data-answer="${encoded}">${labels[score]}</option>`;
        })
        .join("");

      const initialAnswer = answers[0]?.text || "";
      return `
        <div class="prep-qa">
          <div class="prep-qa__question">${formatInlineText(question)}</div>
          <select class="prep-qa__select">${options}</select>
          <div class="prep-qa__answer">${formatInlineText(initialAnswer || "Not available yet.")}</div>
        </div>
      `;
    })
    .join("");
};

const parseStarStory = (text) => {
  const raw = String(text || "").trim();
  if (!raw) return { raw: "" };

  const extract = (label) => {
    const regex = new RegExp(`${label}:\\s*([\\s\\S]*?)(?=Situation:|Task:|Action:|Result:|$)`, "i");
    const match = raw.match(regex);
    return match ? match[1].trim() : "";
  };

  const situation = extract("Situation");
  const task = extract("Task");
  const action = extract("Action");
  const result = extract("Result");

  if (!situation && !task && !action && !result) {
    return { raw };
  }

  return { situation, task, action, result, raw };
};

const getConfidenceKey = (jobId, seed) => `prep_confidence_${jobId}_${seed}`;

const getConfidenceStats = (jobId, items) => {
  const stats = { green: 0, amber: 0, red: 0 };
  if (!jobId) return stats;
  items.forEach((item) => {
    const key = getConfidenceKey(jobId, item.key);
    const value = safeLocalStorageGet(key);
    if (value === "green") stats.green += 1;
    if (value === "amber") stats.amber += 1;
    if (value === "red") stats.red += 1;
  });
  return stats;
};

const buildConfidenceSummary = (jobId, items) => {
  const stats = getConfidenceStats(jobId, items);
  const total = Math.max(items.length, 1);
  const greenPct = Math.round((stats.green / total) * 100);
  const amberPct = Math.round((stats.amber / total) * 100);
  const redPct = Math.max(0, 100 - greenPct - amberPct);

  return `
    <div class="confidence-summary">
      <div>Nailed it: <strong>${stats.green}</strong></div>
      <div>Getting there: <strong>${stats.amber}</strong></div>
      <div>Needs work: <strong>${stats.red}</strong></div>
      <div class="confidence-bar">
        <span class="confidence-bar__green" style="width:${greenPct}%;"></span>
        <span class="confidence-bar__amber" style="width:${amberPct}%;"></span>
        <span class="confidence-bar__red" style="width:${redPct}%;"></span>
      </div>
    </div>
  `;
};

const resolveAnswerOptions = (job, idx) => {
  const answerSets = Array.isArray(job.prep_answer_sets) ? job.prep_answer_sets : [];
  const fallbackAnswers = Array.isArray(job.prep_answers) ? job.prep_answers : [];

  if (answerSets[idx] && Array.isArray(answerSets[idx].answers)) {
    return answerSets[idx].answers;
  }
  if (Array.isArray(answerSets[idx])) {
    return answerSets[idx].map((text, i) => ({ score: 8 + i, text }));
  }
  if (fallbackAnswers[idx]) {
    return [{ score: 9, text: fallbackAnswers[idx] }];
  }
  return [];
};

const getAnswerForScore = (answers, score) => {
  const target = answers.find((ans) => Number(ans.score) === Number(score));
  return (target || answers[0] || { text: "Not available yet." }).text;
};

const slugify = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);

const normaliseQuestionList = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const looksLikeBullets = lines.some((line) => /^[-*•]\s+/.test(line));
  if (!looksLikeBullets) {
    return [trimmed];
  }
  return lines.map((line) => line.replace(/^[-*•]\s+/, ""));
};

const buildStudyDeckItems = (job) => {
  const items = [];
  const starStories = normaliseList(job.star_stories || []);
  starStories.forEach((story, idx) => {
    const parsed = parseStarStory(story);
    const topicSource = parsed.situation || parsed.raw || "Key achievement";
    const prompt = topicSource.split(/\r?\n/)[0].slice(0, 160);
    items.push({
      type: "star",
      prompt,
      story,
      key: `star-${idx}-${slugify(prompt)}`,
    });
  });

  const questions = normaliseQuestionList(job.prep_questions || []);
  questions.forEach((question, idx) => {
    items.push({
      type: "question",
      prompt: question,
      qIndex: idx,
      key: `q-${idx}-${slugify(question)}`,
    });
  });

  const talkingPoints = normaliseList(job.key_talking_points || []);
  talkingPoints.forEach((point, idx) => {
    items.push({
      type: "talking",
      prompt: point,
      point,
      key: `talk-${idx}-${slugify(point)}`,
    });
  });

  return items.slice(0, 12);
};

const getKeyPoints = (job) => {
  const candidates = [
    normaliseList(job.key_talking_points || []),
    normaliseList(state.candidatePrep?.key_talking_points || []),
    normaliseList(state.candidatePrep?.key_stats || []),
    normaliseList(state.candidatePrep?.strengths || []),
  ];
  for (const list of candidates) {
    if (list.length) return list.slice(0, 3);
  }
  return [];
};

const buildStarAnswerHtml = (story) => {
  const parsed = parseStarStory(story);
  if (!parsed.situation && !parsed.task && !parsed.action && !parsed.result) {
    return formatInlineText(parsed.raw || "Not available yet.");
  }
  return `
    <div class="deck-answer__block"><strong>Situation:</strong> ${formatInlineText(parsed.situation || "Not available yet.")}</div>
    <div class="deck-answer__block"><strong>Task:</strong> ${formatInlineText(parsed.task || "Not available yet.")}</div>
    <div class="deck-answer__block"><strong>Action:</strong> ${formatInlineText(parsed.action || "Not available yet.")}</div>
    <div class="deck-answer__block"><strong>Result:</strong> ${formatInlineText(parsed.result || "Not available yet.")}</div>
  `;
};

const buildFallbackDeckItems = (job) => {
  const items = [];
  const prep = state.candidatePrep || {};

  normaliseList(prep.star_stories || []).forEach((story, idx) => {
    const parsed = parseStarStory(story);
    const topicSource = parsed.situation || parsed.raw || "Key achievement";
    const prompt = topicSource.split(/\r?\n/)[0].slice(0, 160);
    items.push({
      type: "star",
      prompt,
      story,
      key: `cstar-${idx}-${slugify(prompt)}`,
    });
  });

  normaliseList(prep.interview_questions || []).forEach((question, idx) => {
    items.push({
      type: "question",
      prompt: question,
      qIndex: idx,
      key: `cquestion-${idx}-${slugify(question)}`,
    });
  });

  normaliseList(prep.key_talking_points || []).forEach((point, idx) => {
    items.push({
      type: "talking",
      prompt: point,
      point,
      key: `ctalk-${idx}-${slugify(point)}`,
    });
  });

  if (!items.length) {
    const pitch = job.quick_pitch || prep.quick_pitch || "";
    if (pitch) {
      items.push({
        type: "talking",
        prompt: "Quick pitch",
        point: pitch,
        key: `cpitch-${slugify(pitch)}`,
      });
    }
  }

  return items.slice(0, 12);
};

const renderStudyDeck = (container, job, prebuiltItems = null) => {
  const items = prebuiltItems || buildStudyDeckItems(job);
  if (!items.length) {
    container.innerHTML = `<div class="detail-box">No prep data yet.</div>`;
    return;
  }

  let currentIndex = 0;

  const render = () => {
    if (currentIndex >= items.length) {
      container.innerHTML = `
        <div class="deck-complete">
          <h3>Session complete</h3>
          <p>You covered ${items.length} items.</p>
          ${buildConfidenceSummary(job.id, items)}
          <button class="btn btn-primary deck-restart">Restart session</button>
        </div>
      `;
      const restartBtn = container.querySelector(".deck-restart");
      if (restartBtn) {
        restartBtn.addEventListener("click", () => {
          currentIndex = 0;
          render();
        });
      }
      return;
    }

    const item = items[currentIndex];
    const progress = Math.round(((currentIndex + 1) / items.length) * 100);
    const confidence = safeLocalStorageGet(getConfidenceKey(job.id, item.key)) || "";
    const keyPoints = getKeyPoints(job);

    let label = "Interview question";
    let answerHtml = "Not available yet.";
    if (item.type === "star") {
      label = "STAR story";
      answerHtml = buildStarAnswerHtml(item.story);
    } else if (item.type === "question") {
      label = "Interview question";
      const answers = resolveAnswerOptions(job, item.qIndex);
      const modelAnswer = getAnswerForScore(answers, 9);
      answerHtml = formatInlineText(modelAnswer || "Not available yet.");
    } else if (item.type === "talking") {
      label = "Key talking point";
      const extra = job.interview_focus || job.why_fit || job.quick_pitch || "";
      answerHtml = `
        <div>${formatInlineText(item.point || "Not available yet.")}</div>
        ${extra ? `<div class="deck-answer__hint">${formatInlineText(extra)}</div>` : ""}
      `;
    }

    container.innerHTML = `
      <div class="study-deck">
        ${buildConfidenceSummary(job.id, items)}
        <div class="deck-progress">
          <div>Item ${currentIndex + 1} of ${items.length}</div>
          <div>10–15 min session</div>
        </div>
        <div class="deck-progress-bar"><div class="deck-progress-fill" style="width:${progress}%"></div></div>
        <div class="deck-card">
          <div class="deck-card__label">${label}</div>
          <div class="deck-card__prompt">${formatInlineText(item.prompt || "Key focus")}</div>
          <button class="deck-reveal">Reveal model answer</button>
          <div class="deck-answer hidden">${answerHtml}</div>
          ${
            keyPoints.length
              ? `
            <div class="deck-keypoints hidden">
              <h4>Key points to hit</h4>
              ${formatList(keyPoints)}
            </div>`
              : ""
          }
          <div class="flashcard__confidence" style="margin-top:16px;">
            <span>How confident?</span>
            <button class="conf-btn conf-btn--red ${confidence === "red" ? "active" : ""}" data-conf="red">Needs work</button>
            <button class="conf-btn conf-btn--amber ${confidence === "amber" ? "active" : ""}" data-conf="amber">Getting there</button>
            <button class="conf-btn conf-btn--green ${confidence === "green" ? "active" : ""}" data-conf="green">Nailed it</button>
          </div>
        </div>
        <div class="deck-footer">
          <div class="deck-nav">
            <button class="btn btn-secondary deck-prev" ${currentIndex === 0 ? "disabled" : ""}>Previous</button>
            <button class="btn btn-primary deck-next" ${currentIndex === items.length - 1 ? "disabled" : ""}>Next</button>
          </div>
          <div class="flashcard-progress">${currentIndex + 1} / ${items.length}</div>
        </div>
      </div>
    `;

    const revealBtn = container.querySelector(".deck-reveal");
    const answerEl = container.querySelector(".deck-answer");
    const keyPointsEl = container.querySelector(".deck-keypoints");
    if (revealBtn) {
      revealBtn.addEventListener("click", () => {
        revealBtn.classList.add("hidden");
        if (answerEl) answerEl.classList.remove("hidden");
        if (keyPointsEl) keyPointsEl.classList.remove("hidden");
      });
    }

    container.querySelectorAll(".conf-btn").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        const value = btn.dataset.conf;
        safeLocalStorageSet(getConfidenceKey(job.id, item.key), value);
        setTimeout(() => {
          if (currentIndex < items.length - 1) {
            currentIndex += 1;
            render();
          } else {
            currentIndex += 1;
            render();
          }
        }, 400);
      });
    });

    const prevBtn = container.querySelector(".deck-prev");
    const nextBtn = container.querySelector(".deck-next");
    if (prevBtn) {
      prevBtn.addEventListener("click", () => {
        if (currentIndex > 0) {
          currentIndex -= 1;
          render();
        }
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener("click", () => {
        if (currentIndex < items.length - 1) {
          currentIndex += 1;
          render();
        }
      });
    }
  };

  render();
};

const openPrepMode = (jobId) => {
  if (!prepOverlay) return;
  const job = state.jobs.find((j) => j.id === jobId);
  if (!job) {
    showToast("No prep data yet.");
    return;
  }
  if (prepOverlayTitle) prepOverlayTitle.textContent = job.role || "Prep Mode";
  if (prepOverlayMeta) prepOverlayMeta.textContent = job.company || "";
  prepOverlay.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  state.activePrepJob = job;
  switchPrepTab("flashcards");
};

const closePrepMode = () => {
  if (!prepOverlay) return;
  prepOverlay.classList.add("hidden");
  document.body.style.overflow = "";
  state.activePrepJob = null;
  if (prepOverlayContent) {
    prepOverlayContent.innerHTML = "";
  }
};

const renderCheatSheet = (container, job) => {
  const prep = state.candidatePrep || {};

  const section = (title, content) => {
    if (!content) return "";
    return `<div class="cheatsheet__section"><h3>${escapeHtml(title)}</h3><div>${content}</div></div>`;
  };

  const listSection = (title, items) => {
    const normalized = normaliseList(items);
    if (!normalized.length) return "";
    return `<div class="cheatsheet__section"><h3>${escapeHtml(title)}</h3>${formatList(normalized)}</div>`;
  };

  const sections = [
    section("Quick Pitch", formatInlineText(job.quick_pitch || prep.quick_pitch || "")),
    section("Why You Fit This Role", formatInlineText(job.why_fit || "")),
    listSection("Key Talking Points", job.key_talking_points || prep.key_talking_points || []),
    listSection("Your Strengths", prep.strengths || []),
    listSection("Risk Mitigations", prep.risk_mitigations || []),
    section("Interview Focus", formatInlineText(job.interview_focus || "")),
    section("Company Insights", formatInlineText(job.company_insights || "")),
    listSection("Key Stats", prep.key_stats || []),
    section("Potential Gaps", formatInlineText(job.cv_gap || "")),
  ].filter(Boolean).join("");

  if (!sections) {
    container.innerHTML = `<div class="detail-box">No cheat sheet data available yet.</div>`;
    return;
  }

  container.innerHTML = `
    <div class="cheatsheet">
      ${sections}
      <div class="cheatsheet__actions">
        <button class="btn btn-primary copy-cheatsheet-btn">Copy all</button>
        <button class="btn btn-secondary print-cheatsheet-btn">Print</button>
      </div>
    </div>
  `;

  const copyBtn = container.querySelector(".copy-cheatsheet-btn");
  if (copyBtn) {
    copyBtn.addEventListener("click", () => {
      const freshPrep = state.candidatePrep || {};
      const parts = [];
      const add = (label, value) => {
        if (!value) return;
        const text = typeof value === "string" ? value : normaliseList(value).join("\n");
        if (text) parts.push(`${label}\n${text}`);
      };
      add("QUICK PITCH", job.quick_pitch || freshPrep.quick_pitch);
      add("WHY YOU FIT", job.why_fit);
      add("KEY TALKING POINTS", job.key_talking_points);
      add("STRENGTHS", freshPrep.strengths);
      add("RISK MITIGATIONS", freshPrep.risk_mitigations);
      add("INTERVIEW FOCUS", job.interview_focus);
      add("COMPANY INSIGHTS", job.company_insights);
      add("KEY STATS", freshPrep.key_stats);
      add("POTENTIAL GAPS", job.cv_gap);
      copyToClipboard(parts.join("\n\n"));
      showToast("Cheat sheet copied");
    });
  }

  const printBtn = container.querySelector(".print-cheatsheet-btn");
  if (printBtn) {
    printBtn.addEventListener("click", () => window.print());
  }
};

const switchPrepTab = (tabName) => {
  const job = state.activePrepJob;
  if (!job || !prepOverlayContent) return;

  document.querySelectorAll(".prep-tab").forEach((btn) => {
    btn.classList.toggle("prep-tab--active", btn.dataset.prepTab === tabName);
  });

  if (tabName === "cheatsheet") {
    renderCheatSheet(prepOverlayContent, job);
  } else if (tabName === "flashcards") {
    const items = buildStudyDeckItems(job);
    const deckItems = items.length ? items : buildFallbackDeckItems(job);
    if (deckItems.length) {
      renderStudyDeck(prepOverlayContent, job, deckItems);
    } else {
      prepOverlayContent.innerHTML = `<div class="detail-box">No prep data yet.</div>`;
    }
  } else {
    console.warn(`switchPrepTab: unknown tab "${tabName}"`);
  }
};

// ── Triage Mode ──

const triageOverlay = document.getElementById("triage-overlay");
const triageContent = document.getElementById("triage-content");
const triageProgress = document.getElementById("triage-progress");
const triageCloseBtn = document.getElementById("triage-close");

const formatApplicantBadge = (text) => {
  if (!text) return "";
  const match = text.match(/(\d+)/);
  if (!match) return "";
  const num = parseInt(match[1], 10);
  const tooltip = escapeHtml(text);
  if (num >= 100) return `<span class="badge badge--applicants-red" title="${tooltip}">${num}+ applicants — Act fast</span>`;
  if (num >= 50) return `<span class="badge badge--applicants-amber" title="${tooltip}">${num}+ applicants</span>`;
  if (num > 0) return `<span class="badge badge--applicants-green" title="${tooltip}">${escapeHtml(text)}</span>`;
  return "";
};

const openTriageMode = (jobs) => {
  const queue = jobs || state.jobs.filter((j) => {
    const s = (j.application_status || "saved").toLowerCase();
    return s === "saved";
  });
  if (!queue.length) {
    showToast("No jobs to triage");
    return;
  }
  state.triageQueue = [...queue];
  state.triageIndex = 0;
  state.triageStats = { dismissed: 0, shortlisted: 0, apply: 0 };
  triageOverlay.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  renderTriageCard();
};

const closeTriageMode = () => {
  triageOverlay.classList.add("hidden");
  document.body.style.overflow = "";
  state.triageQueue = [];
  state.triageIndex = 0;
  state.triageLastAction = null;
};

const renderTriageCard = () => {
  if (!state.triageQueue || state.triageIndex >= state.triageQueue.length) {
    const stats = state.triageStats || { dismissed: 0, shortlisted: 0, apply: 0 };
    triageContent.innerHTML = `
      <div class="triage-summary">
        <h3>Triage complete</h3>
        <div class="triage-summary__stats">
          <div class="triage-summary__stat"><span class="triage-summary__num">${stats.dismissed}</span> Dismissed</div>
          <div class="triage-summary__stat"><span class="triage-summary__num">${stats.skipped || 0}</span> Skipped</div>
          <div class="triage-summary__stat"><span class="triage-summary__num">${stats.shortlisted}</span> Shortlisted</div>
          <div class="triage-summary__stat"><span class="triage-summary__num">${stats.apply}</span> Ready to Apply</div>
        </div>
        <button class="btn btn-primary triage-done-btn">Done</button>
      </div>
    `;
    const doneBtn = triageContent.querySelector(".triage-done-btn");
    if (doneBtn) doneBtn.addEventListener("click", () => { closeTriageMode(); renderJobs(); renderApplyHub(); });
    triageProgress.textContent = "Done!";
    return;
  }

  const job = state.triageQueue[state.triageIndex];
  const remaining = state.triageQueue.length - state.triageIndex;
  triageProgress.textContent = `${state.triageIndex + 1} / ${state.triageQueue.length} (${remaining} remaining)`;

  const applicantBadge = formatApplicantBadge(job.applicant_count);

  triageContent.innerHTML = `
    <div class="triage-card" id="triage-active-card">
      <div class="triage-card__badges">
        <span class="${formatFitBadge(job.fit_score)}">${job.fit_score}% fit</span>
        <span class="${getLocationBadgeClass(job.location)}">${escapeHtml(job.location || "Unknown")}</span>
        ${applicantBadge}
      </div>
      <h3 class="triage-card__role">${escapeHtml(job.role)}</h3>
      <p class="triage-card__company">${escapeHtml(job.company)}</p>
      <p class="triage-card__posted">${escapeHtml(formatPosted(job.posted))}</p>
      <div class="triage-card__summary">${formatInlineText(job.tailored_summary || job.role_summary || "")}</div>
      <div class="triage-card__fit">${formatInlineText(job.why_fit || "")}</div>
      ${job.application_notes ? `<div class="triage-card__note">${escapeHtml(job.application_notes)}</div>` : ""}
      <div class="triage-actions">
        <button class="triage-btn triage-btn--dismiss" data-action="dismiss">Not interested <span class="triage-btn__hint">\u2190</span></button>
        <button class="triage-btn triage-btn--skip" data-action="skip">Skip <span class="triage-btn__hint">Space</span></button>
        <button class="triage-btn triage-btn--maybe" data-action="shortlist">Shortlist <span class="triage-btn__hint">\u2192</span></button>
        <button class="triage-btn triage-btn--apply" data-action="apply">Apply <span class="triage-btn__hint">\u2191</span></button>
      </div>
    </div>
  `;

  // Touch swipe support
  const card = triageContent.querySelector("#triage-active-card");
  if (card) {
    let startX = 0, startY = 0, deltaX = 0, deltaY = 0, swiping = false;
    card.addEventListener("touchstart", (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      deltaX = 0;
      deltaY = 0;
      swiping = true;
      card.style.transition = "none";
    }, { passive: true });
    card.addEventListener("touchmove", (e) => {
      if (!swiping) return;
      deltaX = e.touches[0].clientX - startX;
      deltaY = e.touches[0].clientY - startY;
      const rotate = deltaX * 0.05;
      card.style.transform = `translate(${deltaX}px, ${Math.min(0, deltaY)}px) rotate(${rotate}deg)`;
      card.style.opacity = Math.max(0.5, 1 - Math.abs(deltaX) / 400);
    }, { passive: true });
    card.addEventListener("touchend", () => {
      if (!swiping) return;
      swiping = false;
      card.style.transition = "transform 0.3s ease, opacity 0.3s ease";
      if (deltaX < -80) {
        handleTriageAction("dismiss");
      } else if (deltaX > 80) {
        handleTriageAction("shortlist");
      } else if (deltaY < -80) {
        handleTriageAction("apply");
      } else {
        card.style.transform = "";
        card.style.opacity = "";
      }
    });
  }
};

const undoTriageAction = async () => {
  const last = state.triageLastAction;
  if (!last) return;

  const { index, job, previousStatus, action } = last;

  if (db) {
    try {
      await updateDoc(doc(db, collectionName, job.id), {
        application_status: previousStatus,
        updated_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Undo triage failed:", err);
      showToast("Undo failed — check your connection.");
      return;
    }
  }

  job.application_status = previousStatus;

  if (action === "dismiss") state.triageStats.dismissed = Math.max(0, state.triageStats.dismissed - 1);
  else if (action === "shortlist") state.triageStats.shortlisted = Math.max(0, state.triageStats.shortlisted - 1);
  else if (action === "apply") state.triageStats.apply = Math.max(0, state.triageStats.apply - 1);

  state.triageIndex = index;
  state.triageLastAction = null;
  renderTriageCard();
};

let triageActionInFlight = false;

const handleTriageAction = async (action) => {
  if (triageActionInFlight) return;
  triageActionInFlight = true;

  const job = state.triageQueue[state.triageIndex];
  if (!job) { triageActionInFlight = false; return; }

  const card = triageContent.querySelector("#triage-active-card");

  if (action === "skip") {
    if (card) card.classList.add("triage-card--exit-up");
    state.triageStats.skipped = (state.triageStats.skipped || 0) + 1;
    state.triageIndex++;
    setTimeout(() => { triageActionInFlight = false; renderTriageCard(); }, 300);
    return;
  }

  const exitClass = action === "dismiss" ? "triage-card--exit-left" :
                    action === "shortlist" ? "triage-card--exit-right" :
                    "triage-card--exit-up";
  if (card) card.classList.add(exitClass);

  const statusMap = { dismiss: "dismissed", shortlist: "shortlisted", apply: "ready_to_apply" };
  const newStatus = statusMap[action];
  const oldStatus = job.application_status || "saved";
  const now = new Date().toISOString();

  state.triageLastAction = { index: state.triageIndex, job, previousStatus: oldStatus, action };

  if (db) {
    try {
      await updateDoc(doc(db, collectionName, job.id), {
        application_status: newStatus,
        updated_at: now,
      });
    } catch (err) {
      console.error("Triage update failed:", err);
    }
  }
  job.application_status = newStatus;

  if (action === "dismiss") state.triageStats.dismissed++;
  else if (action === "shortlist") state.triageStats.shortlisted++;
  else if (action === "apply") state.triageStats.apply++;

  const actionLabels = { dismiss: "Dismissed", shortlist: "Shortlisted", apply: "Ready to Apply" };
  showConfirmToast(actionLabels[action] || "Done", "Undo", undoTriageAction, 4000);

  state.triageIndex++;
  setTimeout(() => { triageActionInFlight = false; renderTriageCard(); }, 300);
};

// Triage event listeners
if (triageCloseBtn) {
  triageCloseBtn.addEventListener("click", closeTriageMode);
}

if (triageOverlay) {
  triageOverlay.addEventListener("click", (e) => {
    const action = e.target.closest("[data-action]");
    if (action) handleTriageAction(action.dataset.action);
  });
}

const triageEntryBtn = document.getElementById("triage-btn");
if (triageEntryBtn) {
  triageEntryBtn.addEventListener("click", () => {
    const filtered = getFilteredJobs();
    const triageable = filtered.filter((j) => {
      const s = (j.application_status || "saved").toLowerCase();
      return s === "saved";
    });
    openTriageMode(triageable);
  });
}

const renderFilters = () => {
  sourceSelect.innerHTML = '<option value="">All sources</option>';
  Array.from(state.sources)
    .sort()
    .forEach((source) => {
      const option = document.createElement("option");
      option.value = source;
      option.textContent = source;
      sourceSelect.appendChild(option);
    });

  locationSelect.innerHTML = '<option value="">All locations</option>';
  Array.from(state.locations)
    .sort()
    .forEach((location) => {
      const option = document.createElement("option");
      option.value = location;
      option.textContent = location;
      locationSelect.appendChild(option);
    });
};

const renderTopPick = (job) => {
  // Legacy — replaced by Apply Hub
};

const BASE_CV_SECTIONS = {
  summary: "Senior Product Manager with 8+ years across financial services, regtech and fintech. Specialist in onboarding, KYC/AML, and platform product strategy.",
  key_achievements: [
    "Led digital onboarding transformation serving 3M+ customers, reducing drop-off by 35%",
    "Delivered KYC remediation platform processing 500K+ cases across 6 jurisdictions",
    "Drove API-first integration strategy connecting 15+ downstream systems",
    "Shipped sanctions screening product reducing false positives by 40%",
    "Built product analytics framework improving feature adoption by 25%",
  ],
  vistra_bullets: [
    "Own end-to-end onboarding and KYC product suite across 6 EMEA jurisdictions",
    "Led platform migration reducing onboarding time from 21 to 7 days",
    "Managed cross-functional team of 12 engineers and 3 designers",
    "Delivered API integration layer connecting to 15+ compliance data providers",
    "Shipped automated risk scoring reducing manual review by 60%",
    "Drove product discovery and roadmap prioritisation using RICE framework",
    "Established product analytics with Mixpanel tracking 50+ key events",
    "Led regulatory change programme for EU AML 6th Directive compliance",
  ],
  ebury_bullets: [
    "Owned client onboarding and KYB product for FX/payments platform",
    "Reduced onboarding cycle time by 45% through workflow automation",
    "Shipped API-first partner integration used by 200+ intermediaries",
    "Led cross-border payments compliance product across 20+ currencies",
  ],
};

const hasCvTailoredChanges = (job) => {
  const tailored = job.tailored_cv_sections || {};
  const sections = ["summary", "key_achievements", "vistra_bullets", "ebury_bullets"];
  return sections.some((key) => {
    const tailoredVal = tailored[key];
    const baseVal = BASE_CV_SECTIONS[key];
    if (!tailoredVal) return false;
    if (Array.isArray(tailoredVal)) {
      return JSON.stringify(tailoredVal) !== JSON.stringify(baseVal || []);
    }
    if (typeof tailoredVal === "string") {
      return tailoredVal.trim() !== String(baseVal || "").trim();
    }
    return false;
  });
};

const resolveChecklistState = (job) => {
  const auto = {
    cv_tailored: hasCvTailoredChanges(job),
    cover_letter_reviewed: Boolean(job.cover_letter),
    requirements_matched: (job.fit_score || 0) >= 75 && Array.isArray(job.key_requirements) && job.key_requirements.length > 0,
    job_link_visited: false,
    application_submitted: (job.application_status || "").toLowerCase() === "applied",
  };
  const existing = job.apply_checklist || {};
  const merged = { ...auto, ...existing };
  if ((job.application_status || "").toLowerCase() === "applied") {
    merged.application_submitted = true;
  }
  return merged;
};

const saveApplyChecklist = async (job, updates, options = {}) => {
  if (!job) return;
  const next = { ...resolveChecklistState(job), ...updates };
  if (options.markApplied) {
    next.application_submitted = true;
  }
  job.apply_checklist = next;

  if (!db) return;
  const payload = {
    apply_checklist: next,
    updated_at: new Date().toISOString(),
  };
  if (options.markApplied) {
    const today = new Date().toISOString().slice(0, 10);
    payload.application_status = "applied";
    payload.application_date = `${today}T00:00:00.000Z`;
    payload.last_touch_date = new Date().toISOString();
    job.application_status = "applied";
    job.application_date = payload.application_date;
    job.last_touch_date = payload.last_touch_date;
  }
  try {
    await updateDoc(doc(db, collectionName, job.id), payload);
  } catch (error) {
    console.error("Checklist save failed:", error);
  }
};

const buildCvDiff = (job) => {
  const tailored = job.tailored_cv_sections || {};
  const sections = [
    { key: "summary", label: "Professional Summary", isArray: false },
    { key: "key_achievements", label: "Key Achievements", isArray: true },
    { key: "vistra_bullets", label: "Vistra Experience", isArray: true },
    { key: "ebury_bullets", label: "Ebury Experience", isArray: true },
  ];

  let html = "";
  for (const sec of sections) {
    const tailoredVal = tailored[sec.key];
    const baseVal = BASE_CV_SECTIONS[sec.key];
    const hasTailored = tailoredVal && (sec.isArray ? Array.isArray(tailoredVal) && tailoredVal.length > 0 : typeof tailoredVal === "string" && tailoredVal.trim() !== "");
    const isChanged = hasTailored && JSON.stringify(tailoredVal) !== JSON.stringify(baseVal);

    const cssClass = isChanged ? "cv-diff__section--changed" : "cv-diff__section--unchanged";
    const labelSuffix = isChanged ? "Tailored" : "Unchanged";

    let content;
    if (sec.isArray) {
      const items = hasTailored ? tailoredVal : baseVal;
      content = formatList(items);
    } else {
      content = formatInlineText(hasTailored ? tailoredVal : baseVal);
    }

    html += `
      <div class="cv-diff__section ${cssClass}">
        <div class="cv-diff__label">${sec.label} — ${labelSuffix}</div>
        <div class="cv-diff__content">${content}</div>
      </div>
    `;
  }

  if (job.cv_edit_notes) {
    html += `<div class="cv-diff__notes"><strong>Edit notes:</strong> ${formatInlineText(job.cv_edit_notes)}</div>`;
  }

  return html;
};

const buildPreviewText = (html) => {
  const temp = document.createElement("div");
  temp.innerHTML = html;
  const text = (temp.textContent || "").trim();
  if (!text) return "";
  return text.length > 90 ? `${text.slice(0, 90)}…` : text;
};

const sortHubJobs = (jobs) => {
  const sort = state.hubSort || { field: "fit_score", asc: false };
  const sorted = [...jobs];
  const dir = sort.asc ? 1 : -1;

  sorted.sort((a, b) => {
    if (sort.field === "company") {
      return dir * String(a.company || "").localeCompare(String(b.company || ""));
    }
    if (sort.field === "posted") {
      const da = parseDateValue(a.posted) || new Date(0);
      const db2 = parseDateValue(b.posted) || new Date(0);
      return dir * (da - db2);
    }
    if (sort.field === "applicant_count") {
      const ca = parseApplicantCount(a.applicant_count) ?? Number.POSITIVE_INFINITY;
      const cb = parseApplicantCount(b.applicant_count) ?? Number.POSITIVE_INFINITY;
      return dir * (ca - cb);
    }
    // default: fit score
    return dir * ((a.fit_score || 0) - (b.fit_score || 0));
  });

  return sorted;
};

const renderApplyHub = () => {
  const hubContainer = document.getElementById("apply-hub");
  if (!hubContainer) return;

  // Preserve draft notes before re-render
  const existingNotes = hubContainer.querySelectorAll?.(".hub-notes") || [];
  existingNotes.forEach((textarea) => {
    const jobId = textarea.dataset.jobId;
    if (!jobId) return;
    const job = state.jobs.find((j) => j.id === jobId);
    if (!job) return;
    job.application_notes = textarea.value.slice(0, 500);
  });

  const readyJobs = state.jobs.filter((j) => (j.application_status || "saved").toLowerCase() === "ready_to_apply");

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentlyApplied = state.jobs.filter((j) => {
    if ((j.application_status || "saved").toLowerCase() !== "applied") return false;
    const dt = parseDateValue(j.application_date);
    return dt && dt >= sevenDaysAgo;
  });

  if (!readyJobs.length && !recentlyApplied.length) {
    hubContainer.innerHTML = `
      <div class="hub-empty">
        <h3>No jobs ready to apply</h3>
        <p>Use triage mode to mark jobs as "Apply" — they'll appear here with tailored CV diffs and quick actions.</p>
      </div>
    `;
    return;
  }

  const sortedReady = sortHubJobs(readyJobs);
  const sortedApplied = sortHubJobs(recentlyApplied);

  const sortOptions = [
    { field: "fit_score", label: "Fit" },
    { field: "posted", label: "Date" },
    { field: "company", label: "Company" },
    { field: "applicant_count", label: "Applicants" },
  ];

  const currentSort = state.hubSort || { field: "fit_score", asc: false };

  const renderHubCard = (job, isApplied) => {
    const statusValue = (job.application_status || "saved").toLowerCase();
    const checklist = resolveChecklistState(job);
    const checklistItems = [
      { key: "cv_tailored", label: "CV tailored" },
      { key: "cover_letter_reviewed", label: "Cover letter reviewed" },
      { key: "requirements_matched", label: "Requirements matched" },
      { key: "job_link_visited", label: "Job link visited" },
      { key: "application_submitted", label: "Application submitted" },
    ];
    const readyCount = checklistItems.reduce((acc, item) => acc + (checklist[item.key] ? 1 : 0), 0);
    const readyTotal = checklistItems.length;
    const readyPct = Math.round((readyCount / readyTotal) * 100);
    const allReady = readyCount === readyTotal;
    const cvDiffHtml = buildCvDiff(job);
    const cvDiffPreview = buildPreviewText(cvDiffHtml);
    const summaryPreview = buildPreviewText(formatInlineText(job.tailored_summary || ""));
    const coverPreview = buildPreviewText(formatInlineText(job.cover_letter || ""));
    const requirementsPreview = buildPreviewText(
      (job.key_requirements || []).map((req) => String(req)).join(" · ")
    );
    const noteText = job.application_notes || "";
    const noteCount = Math.min(noteText.length, 500);
    const actionLabel =
      statusValue === "applied" || statusValue === "interview" || statusValue === "offer"
        ? "Re-copy & Open"
        : allReady
          ? "Ready — Apply now"
          : "Copy & View";
    return `
      <div class="hub-card${isApplied ? " hub-card--applied" : ""}" data-job-id="${escapeHtml(job.id)}">
        <div class="hub-card__header">
          <div>
            <h3>${escapeHtml(job.role)}</h3>
            <p>${escapeHtml(job.company)} · ${escapeHtml(job.location)}</p>
          </div>
          <span class="${formatFitBadge(job.fit_score)}">${job.fit_score}%</span>
        </div>

        <div class="hub-card__progress">
          <div class="hub-progress__bar"><span style="width:${readyPct}%;"></span></div>
          <div class="hub-progress__label">${readyCount}/${readyTotal} ready</div>
        </div>

        <details class="hub-card__section" data-section="requirements" open>
          <summary>
            <h4>Key Requirements</h4>
            <span class="hub-card__preview">${escapeHtml(requirementsPreview || "No requirements yet.")}</span>
          </summary>
          <div class="hub-card__content">
            ${formatList(job.key_requirements || [])}
          </div>
        </details>

        <details class="hub-card__section" data-section="cv_diff">
          <summary>
            <h4>What Changed in Your CV</h4>
            <span class="hub-card__preview">${escapeHtml(cvDiffPreview || "CV diff ready once tailored.")}</span>
          </summary>
          <div class="hub-card__content">
            <div class="cv-diff">${cvDiffHtml}</div>
          </div>
        </details>

        <details class="hub-card__section" data-section="summary">
          <summary>
            <h4>Tailored Summary</h4>
            <span class="hub-card__preview">${escapeHtml(summaryPreview || "Summary will appear after enrichment.")}</span>
          </summary>
          <div class="hub-card__content">
            <div>${formatInlineText(job.tailored_summary || "")}</div>
          </div>
        </details>

        <details class="hub-card__section" data-section="cover_letter">
          <summary>
            <h4>Cover Letter</h4>
            <span class="hub-card__preview">${escapeHtml(coverPreview || "Cover letter not generated yet.")}</span>
          </summary>
          <div class="hub-card__content">
            <div class="long-text">${formatInlineText(job.cover_letter || "")}</div>
          </div>
        </details>

        <div class="hub-card__checklist">
          <div class="hub-checklist__title">Apply checklist</div>
          <div class="hub-checklist__items">
            ${checklistItems
              .map(
                (item) => `
              <label class="checklist-item">
                <input type="checkbox" data-check="${item.key}" ${checklist[item.key] ? "checked" : ""} />
                <span>${item.label}</span>
                ${checklist[item.key] ? "<span class=\"checklist-tag checklist-tag--done\">Done</span>" : "<span class=\"checklist-tag checklist-tag--warn\">Review needed</span>"}
              </label>`
              )
              .join("")}
          </div>
        </div>

        <div class="hub-card__actions">
          <button class="btn btn-primary btn-quick-apply ${allReady ? "btn-quick-apply--ready" : ""}" data-job-id="${escapeHtml(job.id)}">${actionLabel}</button>
          <button class="btn btn-secondary download-cv-btn" data-job-id="${escapeHtml(job.id)}">Download CV PDF</button>
          <button class="btn btn-tertiary copy-cv-text-btn" data-job-id="${escapeHtml(job.id)}">Copy CV text</button>
        </div>

        <div class="hub-card__notes">
          <label for="notes-${escapeHtml(job.id)}">Application notes</label>
          <textarea id="notes-${escapeHtml(job.id)}" class="hub-notes" data-job-id="${escapeHtml(job.id)}" maxlength="500" placeholder="Add notes — recruiter name, referral, conversation context...">${escapeHtml(noteText)}</textarea>
          <div class="hub-notes__meta">
            <span class="hub-notes__count">${noteCount}/500</span>
            <span class="hub-notes__saved hidden">Saved</span>
          </div>
        </div>
      </div>
    `;
  };

  let html = "";
  html += `
    <div class="hub-controls">
      <div class="hub-sort">
        ${sortOptions
          .map((opt) => {
            const active = currentSort.field === opt.field;
            const arrow = active ? (currentSort.asc ? "↑" : "↓") : "";
            return `<button class="hub-sort__pill ${active ? "active" : ""}" data-sort="${opt.field}">${opt.label} ${arrow}</button>`;
          })
          .join("")}
      </div>
      <button class="btn btn-secondary hub-toggle" data-toggle="expand">Expand all</button>
    </div>
  `;

  if (sortedReady.length) {
    html += `<div class="section-title" style="margin-bottom:12px;">Ready to Apply (${sortedReady.length})</div>`;
    html += sortedReady.map((j) => renderHubCard(j, false)).join("");
  }
  if (sortedApplied.length) {
    html += `<div class="section-title" style="margin-top:24px;margin-bottom:12px;">Recently Applied (${sortedApplied.length})</div>`;
    html += sortedApplied.map((j) => renderHubCard(j, true)).join("");
  }

  hubContainer.innerHTML = html;

  // Sort controls
  hubContainer.querySelectorAll(".hub-sort__pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      const field = btn.dataset.sort;
      if (!field) return;
      if (state.hubSort.field === field) {
        state.hubSort.asc = !state.hubSort.asc;
      } else {
        state.hubSort.field = field;
        state.hubSort.asc = field === "company";
      }
      saveHubSort(state.hubSort);
      renderApplyHub();
    });
  });

  const hubToggleBtn = hubContainer.querySelector(".hub-toggle");
  if (hubToggleBtn) {
    hubToggleBtn.addEventListener("click", () => {
      const details = hubContainer.querySelectorAll(".hub-card__section");
      const shouldOpen = hubToggleBtn.dataset.toggle !== "collapse";
      details.forEach((detailEl) => {
        detailEl.open = shouldOpen;
        const content = detailEl.querySelector(".hub-card__content");
        if (content) {
          content.style.maxHeight = shouldOpen ? `${content.scrollHeight}px` : "0px";
        }
        const jobId = detailEl.closest(".hub-card")?.dataset?.jobId;
        if (detailEl.dataset.section && jobId) {
          sessionStorage.setItem(`hub_section_${jobId}_${detailEl.dataset.section}`, shouldOpen ? "open" : "closed");
        }
      });
      hubToggleBtn.dataset.toggle = shouldOpen ? "collapse" : "expand";
      hubToggleBtn.textContent = shouldOpen ? "Collapse all" : "Expand all";
    });
  }

  // Restore section expand state + smooth animation
  hubContainer.querySelectorAll(".hub-card__section").forEach((detailEl) => {
    const jobId = detailEl.closest(".hub-card")?.dataset?.jobId;
    const sectionKey = detailEl.dataset.section;
    if (jobId && sectionKey) {
      const stored = sessionStorage.getItem(`hub_section_${jobId}_${sectionKey}`);
      if (stored === "open") detailEl.open = true;
      if (stored === "closed") detailEl.open = false;
    }
    const content = detailEl.querySelector(".hub-card__content");
    if (content) {
      content.style.maxHeight = detailEl.open ? `${content.scrollHeight}px` : "0px";
    }
    detailEl.addEventListener("toggle", () => {
      if (content) {
        content.style.maxHeight = detailEl.open ? `${content.scrollHeight}px` : "0px";
      }
      if (jobId && sectionKey) {
        sessionStorage.setItem(`hub_section_${jobId}_${sectionKey}`, detailEl.open ? "open" : "closed");
      }
    });
  });

  if (hubToggleBtn) {
    const sections = Array.from(hubContainer.querySelectorAll(".hub-card__section"));
    const openCount = sections.filter((d) => d.open).length;
    const allOpen = sections.length > 0 && openCount === sections.length;
    hubToggleBtn.dataset.toggle = allOpen ? "collapse" : "expand";
    hubToggleBtn.textContent = allOpen ? "Collapse all" : "Expand all";
  }

  // Wire up hub card buttons
  hubContainer.querySelectorAll(".btn-quick-apply").forEach((btn) => {
    const jobId = btn.dataset.jobId;
    const job = state.jobs.find((j) => j.id === jobId);
    if (job) btn.addEventListener("click", () => quickApply(job, btn.closest(".hub-card")));
  });

  hubContainer.querySelectorAll(".download-cv-btn").forEach((btn) => {
    const jobId = btn.dataset.jobId;
    const job = state.jobs.find((j) => j.id === jobId);
    if (!job) return;
    btn.addEventListener("click", async () => {
      const cvEl = buildTailoredCvHtml(job);
      const opt = { margin: [10, 10, 10, 10], filename: `CV_${job.company}_${job.role}.pdf`.replace(/[^a-zA-Z0-9_.-]/g, "_"), html2canvas: { scale: 2 }, jsPDF: { unit: "mm", format: "a4" } };
      try { await html2pdf().set(opt).from(cvEl).save(); showToast("CV downloaded"); } catch (err) { console.error(err); showToast("Download failed"); }
    });
  });

  hubContainer.querySelectorAll(".copy-cv-text-btn").forEach((btn) => {
    const jobId = btn.dataset.jobId;
    const job = state.jobs.find((j) => j.id === jobId);
    if (!job) return;
    btn.addEventListener("click", () => {
      copyToClipboard(getTailoredCvPlainText(job));
      showToast("CV text copied");
    });
  });

  // Checklist toggle handlers
  hubContainer.querySelectorAll(".checklist-item input[type='checkbox']").forEach((checkbox) => {
    checkbox.addEventListener("change", async (event) => {
      const jobId = checkbox.closest(".hub-card")?.dataset?.jobId;
      if (!jobId) return;
      const job = state.jobs.find((j) => j.id === jobId);
      if (!job) return;
      const key = checkbox.dataset.check;
      const updates = { [key]: checkbox.checked };
      const markApplied = key === "application_submitted" && checkbox.checked;
      await saveApplyChecklist(job, updates, { markApplied });
      renderApplyHub();
    });
  });

  // Notes autosave
  const notesTimers = state.hubNotesTimers || {};
  state.hubNotesTimers = notesTimers;
  hubContainer.querySelectorAll(".hub-notes").forEach((textarea) => {
    const jobId = textarea.dataset.jobId;
    const counter = textarea.parentElement?.querySelector(".hub-notes__count");
    const saved = textarea.parentElement?.querySelector(".hub-notes__saved");
    const updateCounter = () => {
      const len = Math.min(textarea.value.length, 500);
      if (counter) counter.textContent = `${len}/500`;
    };
    const scheduleSave = (immediate = false) => {
      if (!jobId) return;
      if (notesTimers[jobId]) clearTimeout(notesTimers[jobId]);
      const delay = immediate ? 0 : 500;
      notesTimers[jobId] = setTimeout(async () => {
        const job = state.jobs.find((j) => j.id === jobId);
        if (!job) return;
        job.application_notes = textarea.value.slice(0, 500);
        if (!db) return;
        try {
          await updateDoc(doc(db, collectionName, jobId), {
            application_notes: textarea.value.slice(0, 500),
            updated_at: new Date().toISOString(),
          });
          if (saved) {
            saved.classList.remove("hidden");
            setTimeout(() => saved.classList.add("hidden"), 1000);
          }
        } catch (error) {
          console.error("Notes save failed:", error);
        }
      }, delay);
    };
    textarea.addEventListener("input", () => {
      updateCounter();
      scheduleSave(false);
    });
    textarea.addEventListener("blur", () => scheduleSave(true));
    updateCounter();
  });
};

const updateBulkBar = () => {
  let bar = document.querySelector(".bulk-bar");
  const count = state.selectedJobs.size;
  if (count === 0) {
    if (bar) bar.remove();
    return;
  }
  if (!bar) {
    bar = document.createElement("div");
    bar.className = "bulk-bar";
    document.body.appendChild(bar);
  }
  bar.innerHTML = `
    <span class="bulk-bar__count">${count} selected</span>
    <button class="btn btn-secondary bulk-bar__btn" data-bulk="dismiss">Dismiss</button>
    <button class="btn btn-secondary bulk-bar__btn" data-bulk="shortlist">Shortlist</button>
    <button class="btn btn-secondary bulk-bar__btn" data-bulk="ready_to_apply">Ready to Apply</button>
    <button class="btn btn-tertiary bulk-bar__btn" data-bulk="clear">Clear</button>
  `;
  bar.querySelectorAll("[data-bulk]").forEach((btn) => {
    btn.addEventListener("click", () => handleBulkAction(btn.dataset.bulk));
  });
};

const handleBulkAction = async (action) => {
  if (action === "clear") {
    state.selectedJobs.clear();
    document.querySelectorAll(".bulk-check").forEach((cb) => { cb.checked = false; });
    const selectAll = document.querySelector(".bulk-select-all");
    if (selectAll) selectAll.checked = false;
    updateBulkBar();
    return;
  }

  const ids = [...state.selectedJobs];
  const now = new Date().toISOString();

  for (const jobId of ids) {
    const job = state.jobs.find((j) => j.id === jobId);
    if (!job) continue;
    job.application_status = action;
    if (db) {
      try {
        await updateDoc(doc(db, collectionName, job.id), {
          application_status: action,
          updated_at: now,
        });
      } catch (err) {
        console.error("Bulk update failed:", err);
      }
    }
  }

  state.selectedJobs.clear();
  updateBulkBar();
  renderJobs();
  renderApplyHub();
  showToast(`${ids.length} job${ids.length > 1 ? "s" : ""} updated`);
};

const getFilteredJobs = () => {
  const searchTerm = searchInput.value.toLowerCase();
  const minFit = Number(minFitSelect.value || 0);
  const sourceFilter = sourceSelect.value;
  const locationFilter = locationSelect.value;
  const statusFilter = statusSelect.value;
  const ukOnly = ukOnlyCheckbox.checked;

  let filtered = state.jobs.filter((job) => {
    const jobStatus = (job.application_status || "saved").toLowerCase();
    const matchesSearch =
      !searchTerm ||
      (job.role || "").toLowerCase().includes(searchTerm) ||
      (job.company || "").toLowerCase().includes(searchTerm) ||
      (job.why_fit || "").toLowerCase().includes(searchTerm) ||
      (job.role_summary || "").toLowerCase().includes(searchTerm) ||
      (job.tailored_summary || "").toLowerCase().includes(searchTerm);

    const matchesFit = job.fit_score >= minFit;
    const matchesSource = !sourceFilter || job.source === sourceFilter;
    const matchesLocation = !locationFilter || job.location === locationFilter;
    const matchesStatus = !statusFilter || jobStatus === statusFilter;
    const matchesUkOnly = !ukOnly || isUkOrRemote(job.location);
    const matchesQuick = !quickFilterPredicate || quickFilterPredicate(job);
    const matchesDismissed = statusFilter === "dismissed" || jobStatus !== "dismissed";

    return (
      matchesSearch &&
      matchesFit &&
      matchesSource &&
      matchesLocation &&
      matchesStatus &&
      matchesUkOnly &&
      matchesQuick &&
      matchesDismissed
    );
  });

  if (uniqueCompanyOnly) {
    const seen = new Set();
    filtered = filtered.filter((job) => {
      const key = (job.company || "").trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  return filtered;
};

const renderJobs = () => {
  const filtered = getFilteredJobs();

  if (mobileNavObserver) {
    mobileNavObserver.disconnect();
    mobileNavObserver = null;
  }

  jobsContainer.innerHTML = "";
  const isMobile = window.matchMedia("(max-width: 900px)").matches;

  // Clear stale selections not in current filtered set
  const filteredIds = new Set(filtered.map((j) => j.id));
  for (const id of state.selectedJobs) {
    if (!filteredIds.has(id)) state.selectedJobs.delete(id);
  }
  updateBulkBar();

  // Select-all bar
  const existingSelectAll = document.querySelector(".bulk-select-all-bar");
  if (existingSelectAll) existingSelectAll.remove();
  if (filtered.length > 0) {
    const selectAllBar = document.createElement("div");
    selectAllBar.className = "bulk-select-all-bar";
    selectAllBar.innerHTML = `<label class="toggle-label"><input type="checkbox" class="bulk-select-all" ${state.selectedJobs.size === filtered.length && filtered.length > 0 ? "checked" : ""} /> Select all (${filtered.length})</label>`;
    jobsContainer.parentNode.insertBefore(selectAllBar, jobsContainer);
    const selectAllCb = selectAllBar.querySelector(".bulk-select-all");
    selectAllCb.addEventListener("change", () => {
      if (selectAllCb.checked) {
        filtered.forEach((j) => state.selectedJobs.add(j.id));
      } else {
        state.selectedJobs.clear();
      }
      document.querySelectorAll(".bulk-check").forEach((cb) => {
        cb.checked = selectAllCb.checked;
      });
      updateBulkBar();
    });
  }

  filtered.forEach((job) => {
    const bulletList = formatList(job.tailored_cv_bullets || []);
    const requirementsList = formatList(job.key_requirements || []);
    const talkingPoints = formatList(job.key_talking_points || []);
    const starStories = formatList(job.star_stories || []);
    const prepQaBlocks = buildPrepQa(job);
    const scorecardList = formatList(job.scorecard || []);
    const statusValue = (job.application_status || "saved").toLowerCase();
    const appliedDate = job.application_date ? job.application_date.slice(0, 10) : "";
    const lastTouchDate = job.last_touch_date ? job.last_touch_date.slice(0, 10) : "";

    const card = document.createElement("div");
    card.className = "job-card";
    card.innerHTML = `
      <div class="job-card__header">
        <label class="bulk-check-label"><input type="checkbox" class="bulk-check" data-job-id="${escapeHtml(job.id)}" ${state.selectedJobs.has(job.id) ? "checked" : ""} /></label>
        <div>
          <div class="job-card__title">${escapeHtml(job.role)}</div>
          <div class="job-card__meta">${escapeHtml(job.company)}</div>
          <div class="job-card__meta">${escapeHtml(formatPosted(job.posted))} · ${escapeHtml(job.source)}</div>
          <div class="job-card__meta">Status: ${escapeHtml(statusValue)}</div>
        </div>
        <div class="job-card__badges">
          <div class="${formatFitBadge(job.fit_score)}">${job.fit_score}% fit</div>
          <div class="${getLocationBadgeClass(job.location)}" title="${escapeHtml(job.location)}">${escapeHtml(job.location || "Unknown")}</div>
          ${job.apply_method ? `<span class="badge badge--method">${escapeHtml(job.apply_method)}</span>` : ""}
          ${formatApplicantBadge(job.applicant_count)}
        </div>
      </div>
      <div class="detail-carousel-wrap">
        <div class="detail-carousel-header">
          <div class="detail-carousel-hint">Swipe for more</div>
          <div class="detail-carousel-controls">
            <button class="carousel-btn carousel-btn--prev" aria-label="Previous card">&#x2039;</button>
            <button class="carousel-btn carousel-btn--next" aria-label="Next card">&#x203A;</button>
          </div>
        </div>
        <div class="job-card__details detail-carousel" id="carousel-${escapeHtml(job.id)}">
        <div class="detail-box">
          <div class="section-title">Role summary</div>
          <div>${formatInlineText(job.role_summary || "Not available yet.")}</div>
        </div>
        <div class="detail-box">
          <div class="section-title">Tailored summary</div>
          <div>${formatInlineText(job.tailored_summary || "Not available yet.")}</div>
        </div>
        <div class="detail-box">
          <div class="section-title">Tailored CV bullets (ATS-ready)</div>
          ${bulletList}
          <button class="btn btn-tertiary copy-btn" data-copy-type="bullets" data-job-id="${escapeHtml(
            job.id
          )}">Copy bullets</button>
        </div>
        <div class="detail-box">
          <div class="section-title">Why you fit</div>
          <div>${formatInlineText(job.why_fit || "Not available yet.")}</div>
        </div>
        <div class="detail-box">
          <div class="section-title">Potential gaps</div>
          <div>${formatInlineText(job.cv_gap || "Not available yet.")}</div>
        </div>
        <div class="detail-box">
          <div class="section-title">CV edits for this role</div>
          <div>${formatInlineText(job.cv_edit_notes || "Not available yet.")}</div>
        </div>
        <div class="detail-box">
          <div class="section-title">Key requirements</div>
          ${requirementsList}
        </div>
        <div class="detail-box">
          <div class="section-title">Match notes</div>
          <div>${formatInlineText(job.match_notes || "Not available yet.")}</div>
        </div>
        <div class="detail-box">
          <div class="section-title">Interview focus</div>
          <div>${formatInlineText(job.interview_focus || "Not available yet.")}</div>
        </div>
        <div class="detail-box">
          <div class="section-title">Quick pitch</div>
          <div>${formatInlineText(job.quick_pitch || "Not available yet.")}</div>
        </div>
        <div class="detail-box">
          <div class="section-title">Key talking points</div>
          ${talkingPoints}
        </div>
        <div class="detail-box">
          <div class="section-title">STAR stories (10/10)</div>
          ${starStories}
        </div>
        <div class="detail-box">
          <div class="section-title">Company insights</div>
          <div>${formatInlineText(job.company_insights || "Not available yet.")}</div>
        </div>
        <div class="detail-box">
          <div class="section-title">Interview Q&amp;A (8–10/10)</div>
          ${prepQaBlocks}
        </div>
        <div class="detail-box">
          <div class="section-title">Hiring scorecard</div>
          ${scorecardList}
        </div>
        <div class="detail-box">
          <div class="section-title">How to apply</div>
          <div>${formatInlineText(job.apply_tips || "Apply with CV tailored to onboarding + KYC impact.")}</div>
        </div>
        <div class="detail-box">
          <div class="section-title">CV edits (exact changes)</div>
          <div>${formatInlineText(job.cv_edit_notes || "Not available yet.")}</div>
        </div>
        <div class="detail-box">
          <div class="section-title">Cover letter</div>
          <div class="long-text">${formatInlineText(job.cover_letter || "Not available yet.")}</div>
          <button class="btn btn-tertiary copy-btn" data-copy-type="cover_letter" data-job-id="${escapeHtml(
            job.id
          )}">Copy cover letter</button>
        </div>
        <div class="detail-box">
          <div class="section-title">Tailored CV</div>
          <div class="cv-preview" style="font-size:11px;color:#475569;margin-bottom:8px;">${
            job.tailored_cv_sections?.summary
              ? escapeHtml(job.tailored_cv_sections.summary).slice(0, 150) + "…"
              : "CV will be tailored with your profile. Download to preview."
          }</div>
          <button class="btn btn-primary download-cv-btn" data-job-id="${escapeHtml(job.id)}">Download PDF</button>
          <button class="btn btn-tertiary copy-cv-text-btn" data-job-id="${escapeHtml(job.id)}">Copy as text</button>
        </div>
        <div class="detail-box tracking">
          <div class="section-title">Application tracking</div>
          <div class="tracking-grid">
            <label>Status</label>
            <select class="tracking-status">
              <option value="saved" ${statusValue === "saved" ? "selected" : ""}>Saved</option>
              <option value="applied" ${statusValue === "applied" ? "selected" : ""}>Applied</option>
              <option value="interview" ${statusValue === "interview" ? "selected" : ""}>Interview</option>
              <option value="offer" ${statusValue === "offer" ? "selected" : ""}>Offer</option>
              <option value="rejected" ${statusValue === "rejected" ? "selected" : ""}>Rejected</option>
              <option value="shortlisted" ${statusValue === "shortlisted" ? "selected" : ""}>Shortlisted</option>
              <option value="ready_to_apply" ${statusValue === "ready_to_apply" ? "selected" : ""}>Ready to Apply</option>
              <option value="dismissed" ${statusValue === "dismissed" ? "selected" : ""}>Dismissed</option>
            </select>
            <label>Applied date</label>
            <input type="date" class="tracking-applied" value="${appliedDate}" />
            <label>Last touch</label>
            <input type="date" class="tracking-last-touch" value="${lastTouchDate}" />
            <label>Next action</label>
            <input type="text" class="tracking-next-action" value="${escapeHtml(
              job.next_action || ""
            )}" placeholder="e.g. Follow up email" />
            <label>Salary range</label>
            <input type="text" class="tracking-salary" value="${escapeHtml(
              job.salary_range || ""
            )}" placeholder="e.g. 65-80k" />
            <label>Applied via</label>
            <select class="tracking-applied-via">
              <option value="" ${!job.applied_via ? "selected" : ""}>—</option>
              <option value="LinkedIn" ${job.applied_via === "LinkedIn" ? "selected" : ""}>LinkedIn</option>
              <option value="Company site" ${job.applied_via === "Company site" ? "selected" : ""}>Company site</option>
              <option value="Recruiter" ${job.applied_via === "Recruiter" ? "selected" : ""}>Recruiter</option>
              <option value="Referral" ${job.applied_via === "Referral" ? "selected" : ""}>Referral</option>
              <option value="Other" ${job.applied_via === "Other" ? "selected" : ""}>Other</option>
            </select>
            <label>Follow-up date</label>
            <input type="date" class="tracking-follow-up" value="${
              job.follow_up_date ? job.follow_up_date.slice(0, 10) : ""
            }" />
            <label>Interviewer</label>
            <input type="text" class="tracking-interviewer-name" value="${escapeHtml(
              job.interviewer_name || ""
            )}" placeholder="Name" />
            <label>Interviewer email</label>
            <input type="email" class="tracking-interviewer-email" value="${escapeHtml(
              job.interviewer_email || ""
            )}" placeholder="email@example.com" />
            <label>Interview date</label>
            <input type="date" class="tracking-interview-date" value="${
              job.interview_date ? job.interview_date.slice(0, 10) : ""
            }" />
            <label>Notes</label>
            <textarea class="tracking-notes" rows="3" placeholder="Notes...">${escapeHtml(
              job.application_notes || ""
            )}</textarea>
          </div>
          <div class="tracking-validation-msg" style="color:#dc2626;font-size:12px;margin-bottom:6px;"></div>
          <button class="btn btn-primary save-tracking">Save update</button>
          <div class="tracking-status-msg"></div>
        </div>
        </div>
        <div class="carousel-dots" data-carousel-dots="${escapeHtml(job.id)}"></div>
      </div>
      <div class="job-card__actions">
        <button class="btn btn-quick-apply${statusValue !== "saved" && statusValue !== "shortlisted" && statusValue !== "ready_to_apply" ? " btn-quick-apply--done" : ""}">${statusValue === "applied" || statusValue === "interview" || statusValue === "offer" ? "Re-copy & Open" : "Copy & View"}</button>
        <button class="btn btn-prep" data-job-id="${escapeHtml(job.id)}">Prep</button>
        <a href="${escapeHtml(job.link)}" target="_blank" rel="noreferrer">View & Apply</a>
      </div>
    `;
    jobsContainer.appendChild(card);

    // Wire up bulk select checkbox
    const bulkCheck = card.querySelector(".bulk-check");
    if (bulkCheck) {
      bulkCheck.addEventListener("change", () => {
        if (bulkCheck.checked) {
          state.selectedJobs.add(job.id);
        } else {
          state.selectedJobs.delete(job.id);
        }
        updateBulkBar();
      });
    }

    // Wire up Quick Apply button
    const qaBtn = card.querySelector(".btn-quick-apply");
    if (qaBtn) {
      qaBtn.addEventListener("click", () => quickApply(job, card));
    }

    const prepBtn = card.querySelector(".btn-prep");
    if (prepBtn) {
      prepBtn.addEventListener("click", () => openPrepMode(prepBtn.dataset.jobId));
    }

    const carousel = card.querySelector(".detail-carousel");
    const prevBtn = card.querySelector(".carousel-btn--prev");
    const nextBtn = card.querySelector(".carousel-btn--next");
    const dotsContainer = card.querySelector(".carousel-dots");

    const detailCards = carousel ? Array.from(carousel.querySelectorAll(".detail-box")) : [];

    if (isMobile) {
      // Convert detail boxes into accordion items
      detailCards.forEach((box) => {
        const title = box.querySelector(".section-title");
        if (!title) return;
        // Wrap everything after the title in an accordion-body div
        const body = document.createElement("div");
        body.className = "accordion-body";
        while (title.nextSibling) {
          body.appendChild(title.nextSibling);
        }
        box.appendChild(body);
        // Tap title to toggle
        title.addEventListener("click", () => {
          box.classList.toggle("accordion-open");
        });
      });

      // Quick-save bookmark button
      const quickSaveBtn = document.createElement("button");
      quickSaveBtn.className = "quick-save-btn";
      const statusVal = (job.application_status || "saved").toLowerCase();
      if (statusVal === "saved") quickSaveBtn.classList.add("is-saved");
      quickSaveBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M5 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16l-7-3.5L5 21V5z"/></svg>`;
      card.appendChild(quickSaveBtn);

      quickSaveBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!db) return;
        // Don't let quick-save overwrite advanced statuses
        const currentStatus = (job.application_status || "saved").toLowerCase();
        if (!["saved", "applied"].includes(currentStatus)) return;
        const wasSaved = quickSaveBtn.classList.contains("is-saved");
        const newStatus = wasSaved ? "applied" : "saved";

        // Optimistic UI
        quickSaveBtn.classList.toggle("is-saved");
        quickSaveBtn.classList.add("is-saving");

        try {
          await updateDoc(doc(db, collectionName, job.id), {
            application_status: newStatus,
            updated_at: new Date().toISOString(),
          });
          job.application_status = newStatus;
          // Sync the tracking select if it exists on this card
          const trackingSelect = card.querySelector(".tracking-status");
          if (trackingSelect) trackingSelect.value = newStatus;
          // Update status text in header
          const metaDivs = card.querySelectorAll(".job-card__meta");
          metaDivs.forEach((m) => {
            if (m.textContent.startsWith("Status:")) m.textContent = `Status: ${newStatus}`;
          });
        } catch (err) {
          console.error("Quick-save failed:", err);
          // Roll back
          quickSaveBtn.classList.toggle("is-saved");
        } finally {
          quickSaveBtn.classList.remove("is-saving");
        }
      });
    } else {
      // Desktop: carousel behavior
      const snapToIndex = (index) => {
        if (!carousel || !detailCards[index]) return;
        const target = detailCards[index];
        const left = target.offsetLeft - carousel.offsetLeft;
        carousel.scrollTo({ left, behavior: "smooth" });
      };

      const renderDots = () => {
        if (!dotsContainer) return;
        dotsContainer.innerHTML = "";
        detailCards.forEach((_, idx) => {
          const dot = document.createElement("button");
          dot.className = "carousel-dot";
          dot.setAttribute("aria-label", `Go to card ${idx + 1}`);
          dot.addEventListener("click", () => snapToIndex(idx));
          dotsContainer.appendChild(dot);
        });
      };

      const updateActiveDot = () => {
        if (!carousel || !dotsContainer) return;
        const scrollLeft = carousel.scrollLeft;
        let activeIdx = 0;
        let bestDistance = Number.POSITIVE_INFINITY;
        detailCards.forEach((cardEl, idx) => {
          const distance = Math.abs(cardEl.offsetLeft - carousel.offsetLeft - scrollLeft);
          if (distance < bestDistance) {
            bestDistance = distance;
            activeIdx = idx;
          }
        });
        dotsContainer.querySelectorAll(".carousel-dot").forEach((dot, idx) => {
          dot.classList.toggle("active", idx === activeIdx);
        });
      };

      if (carousel) {
        renderDots();
        updateActiveDot();
        carousel.addEventListener("scroll", () => {
          window.requestAnimationFrame(updateActiveDot);
        });
      }

      if (prevBtn) {
        prevBtn.addEventListener("click", () => {
          const active = dotsContainer?.querySelector(".carousel-dot.active");
          const idx = active ? Array.from(dotsContainer.children).indexOf(active) : 0;
          snapToIndex(Math.max(0, idx - 1));
        });
      }

      if (nextBtn) {
        nextBtn.addEventListener("click", () => {
          const active = dotsContainer?.querySelector(".carousel-dot.active");
          const idx = active ? Array.from(dotsContainer.children).indexOf(active) : 0;
          snapToIndex(Math.min(detailCards.length - 1, idx + 1));
        });
      }
    }

    card.querySelectorAll(".copy-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const jobId = btn.dataset.jobId;
        const copyType = btn.dataset.copyType;
        const target = state.jobs.find((item) => item.id === jobId);
        if (!target) return;
        const text =
          copyType === "bullets"
            ? (target.tailored_cv_bullets || []).join("\n")
            : target.cover_letter || "";
        copyToClipboard(text);
      });
    });

    card.querySelectorAll(".prep-qa__select").forEach((select) => {
      const answerEl = select.closest(".prep-qa")?.querySelector(".prep-qa__answer");
      select.addEventListener("change", () => {
        const selected = select.selectedOptions[0];
        if (!answerEl) return;
        const raw = selected?.dataset?.answer || "";
        let decoded = raw;
        try {
          decoded = decodeURIComponent(raw);
        } catch (error) {
          decoded = raw;
        }
        answerEl.innerHTML = formatInlineText(decoded || "Not available yet.");
      });
    });

    // Tailored CV: Download PDF
    const downloadCvBtn = card.querySelector(".download-cv-btn");
    if (downloadCvBtn) {
      downloadCvBtn.addEventListener("click", () => {
        if (typeof html2pdf === "undefined") {
          showToast("PDF library failed to load. Check your connection.");
          return;
        }
        const target = state.jobs.find((item) => item.id === downloadCvBtn.dataset.jobId);
        if (!target) return;
        const htmlEl = buildTailoredCvHtml(target);
        const companySlug = (target.company || "Company").replace(/[^a-zA-Z0-9]/g, "");
        html2pdf().set({
          margin: [10, 15],
          filename: `AdeOmosanya_CV_${companySlug}.pdf`,
          html2canvas: { scale: 2 },
          jsPDF: { unit: "mm", format: "a4" },
        }).from(htmlEl).save();
        showToast("Generating PDF…");
      });
    }

    // Tailored CV: Copy as text
    const copyCvTextBtn = card.querySelector(".copy-cv-text-btn");
    if (copyCvTextBtn) {
      copyCvTextBtn.addEventListener("click", () => {
        const target = state.jobs.find((item) => item.id === copyCvTextBtn.dataset.jobId);
        if (!target) return;
        copyToClipboard(getTailoredCvPlainText(target));
      });
    }

    const saveBtn = card.querySelector(".save-tracking");
    const statusEl = card.querySelector(".tracking-status");
    const appliedEl = card.querySelector(".tracking-applied");
    const lastTouchEl = card.querySelector(".tracking-last-touch");
    const nextActionEl = card.querySelector(".tracking-next-action");
    const notesEl = card.querySelector(".tracking-notes");
    const salaryEl = card.querySelector(".tracking-salary");
    const appliedViaEl = card.querySelector(".tracking-applied-via");
    const followUpEl = card.querySelector(".tracking-follow-up");
    const interviewerNameEl = card.querySelector(".tracking-interviewer-name");
    const interviewerEmailEl = card.querySelector(".tracking-interviewer-email");
    const interviewDateEl = card.querySelector(".tracking-interview-date");
    const statusMsg = card.querySelector(".tracking-status-msg");
    const validationMsg = card.querySelector(".tracking-validation-msg");

    saveBtn.addEventListener("click", async () => {
      if (!db) {
        statusMsg.textContent = "Missing Firebase config.";
        return;
      }

      // Interview date validation
      if (validationMsg) validationMsg.textContent = "";
      if (statusEl.value === "interview" && interviewDateEl && !interviewDateEl.value) {
        if (validationMsg) validationMsg.textContent = "Please set an interview date.";
        interviewDateEl.focus();
        interviewDateEl.style.borderColor = "#dc2626";
        return;
      }
      if (interviewDateEl) interviewDateEl.style.borderColor = "";

      // Auto-fill applied date when status is "applied" and date is empty
      const todayStr = new Date().toISOString().slice(0, 10);
      if (statusEl.value === "applied" && !appliedEl.value) {
        appliedEl.value = todayStr;
      }
      // Every tracking save is a "touch"
      lastTouchEl.value = todayStr;

      const toIsoDate = (val) => val ? `${val}T00:00:00.000Z` : "";
      const payload = {
        application_status: statusEl.value,
        application_date: toIsoDate(appliedEl.value),
        last_touch_date: toIsoDate(lastTouchEl.value),
        next_action: nextActionEl.value,
        application_notes: notesEl.value,
        salary_range: salaryEl.value,
        applied_via: appliedViaEl.value,
        follow_up_date: toIsoDate(followUpEl.value),
        interviewer_name: interviewerNameEl.value,
        interviewer_email: interviewerEmailEl.value,
        interview_date: toIsoDate(interviewDateEl.value),
        updated_at: new Date().toISOString(),
      };
      try {
        await updateDoc(doc(db, collectionName, job.id), payload);
        job.application_status = payload.application_status;
        job.application_date = payload.application_date;
        job.last_touch_date = payload.last_touch_date;
        job.next_action = payload.next_action;
        job.application_notes = payload.application_notes;
        job.salary_range = payload.salary_range;
        job.applied_via = payload.applied_via;
        job.follow_up_date = payload.follow_up_date;
        job.interviewer_name = payload.interviewer_name;
        job.interviewer_email = payload.interviewer_email;
        job.interview_date = payload.interview_date;
        statusMsg.textContent = "Saved.";
      } catch (error) {
        console.error(error);
        statusMsg.textContent = "Save failed.";
      }
    });
  });

  // ── Mobile job nav bar (prev / counter / next) ──
  const existingNav = document.querySelector(".mobile-job-nav");
  if (existingNav) existingNav.remove();

  if (isMobile && filtered.length > 0) {
    const nav = document.createElement("div");
    nav.className = "mobile-job-nav";

    const prevBtn = document.createElement("button");
    prevBtn.className = "mobile-job-nav__btn";
    prevBtn.textContent = "\u2039";
    prevBtn.setAttribute("aria-label", "Previous job");

    const counter = document.createElement("span");
    counter.className = "mobile-job-nav__counter";
    counter.textContent = `1 of ${filtered.length}`;

    const nextBtn = document.createElement("button");
    nextBtn.className = "mobile-job-nav__btn";
    nextBtn.textContent = "\u203A";
    nextBtn.setAttribute("aria-label", "Next job");

    nav.appendChild(prevBtn);
    nav.appendChild(counter);
    nav.appendChild(nextBtn);

    jobsContainer.parentNode.insertBefore(nav, jobsContainer);

    const cards = Array.from(jobsContainer.querySelectorAll(".job-card"));
    let currentIndex = 0;

    const scrollToCard = (index) => {
      if (cards[index]) {
        cards[index].scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
      }
    };

    prevBtn.addEventListener("click", () => {
      if (currentIndex > 0) {
        currentIndex--;
        scrollToCard(currentIndex);
      }
    });

    nextBtn.addEventListener("click", () => {
      if (currentIndex < cards.length - 1) {
        currentIndex++;
        scrollToCard(currentIndex);
      }
    });

    // IntersectionObserver to update counter on swipe
    mobileNavObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const idx = cards.indexOf(entry.target);
            if (idx !== -1) {
              currentIndex = idx;
              counter.textContent = `${idx + 1} of ${filtered.length}`;
            }
          }
        });
      },
      { root: jobsContainer, threshold: 0.6 }
    );

    cards.forEach((c) => mobileNavObserver.observe(c));
  }

  if (!filtered.length) {
    jobsContainer.innerHTML = `<div class="detail-box">No roles match these filters yet. Try lowering the fit threshold or clearing filters.</div>`;
  }
};

const renderSourceStats = (statsDocs) => {
  if (!statsDocs.length) {
    sourceStatsContainer.innerHTML = "";
    return;
  }
  const latest = statsDocs[0];
  const counts = latest.counts || {};
  const total = latest.total || 0;
  const sevenDayTotal = statsDocs.reduce((acc, doc) => acc + (doc.total || 0), 0);
  const avg = statsDocs.length ? Math.round(sevenDayTotal / statsDocs.length) : 0;

  const cards = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(
      ([source, count]) => `
      <div class="stat-card">
        <div class="stat-card__label">${escapeHtml(source)}</div>
        <div class="stat-card__value">${count}</div>
        <div class="stat-card__trend">7‑day avg: ${avg}</div>
      </div>`
    )
    .join("");

  sourceStatsContainer.innerHTML = `
    <div class="stat-card">
      <div class="stat-card__label">Total (today)</div>
      <div class="stat-card__value">${total}</div>
      <div class="stat-card__trend">7‑day total: ${sevenDayTotal}</div>
    </div>
    ${cards}
  `;
};

const renderRoleSuggestions = (doc) => {
  if (!doc || !doc.roles || !doc.roles.length) {
    roleSuggestionsContainer.classList.add("hidden");
    roleSuggestionsContainer.innerHTML = "";
    return;
  }
  roleSuggestionsContainer.classList.remove("hidden");
  roleSuggestionsContainer.innerHTML = `
    <div class="section-title">Adjacent roles to consider</div>
    <div>${formatList(doc.roles)}</div>
    <div style="margin-top:8px;">${formatInlineText(doc.rationale || "")}</div>
  `;
};

const renderCandidatePrep = (doc) => {
  if (!doc) {
    candidatePrepContainer.classList.add("hidden");
    candidatePrepContainer.innerHTML = "";
    return;
  }
  candidatePrepContainer.classList.remove("hidden");
  candidatePrepContainer.innerHTML = `
    <div class="section-title">Your interview cheat sheet</div>
    <div><strong>Quick pitch</strong></div>
    <div>${formatInlineText(doc.quick_pitch || "Not available yet.")}</div>
    <div style="margin-top:8px;"><strong>Key stats</strong></div>
    ${formatList(doc.key_stats || [])}
    <div style="margin-top:8px;"><strong>Key talking points</strong></div>
    ${formatList(doc.key_talking_points || [])}
    <div style="margin-top:8px;"><strong>Strengths to emphasise</strong></div>
    ${formatList(doc.strengths || [])}
    <div style="margin-top:8px;"><strong>Risk mitigations</strong></div>
    ${formatList(doc.risk_mitigations || [])}
    <div style="margin-top:8px;"><strong>STAR stories (10/10)</strong></div>
    ${formatList(doc.star_stories || [])}
    <div style="margin-top:8px;"><strong>Interview questions to rehearse</strong></div>
    ${formatList(doc.interview_questions || [])}
  `;
};

const renderDashboardStats = (jobs) => {
  if (!dashboardStatsContainer) return;

  const now = new Date();
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);
  const startYesterday = new Date(startToday);
  startYesterday.setDate(startYesterday.getDate() - 1);
  const last24 = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const last72 = new Date(now.getTime() - 72 * 60 * 60 * 1000);

  const safeStatus = (job) => (job.application_status || "saved").toLowerCase();
  const updatedDates = jobs.map((job) => parseDateValue(job.updated_at)).filter(Boolean);

  const newLast24 = updatedDates.filter((dt) => dt >= last24).length;
  const newLast72 = updatedDates.filter((dt) => dt >= last72).length;

  const appliedToday = jobs.filter((job) => {
    if (safeStatus(job) !== "applied") return false;
    const dt = parseDateValue(job.application_date);
    return dt && dt >= startToday;
  }).length;

  const appliedYesterday = jobs.filter((job) => {
    if (safeStatus(job) !== "applied") return false;
    const dt = parseDateValue(job.application_date);
    return dt && dt >= startYesterday && dt < startToday;
  }).length;

  const savedCount = jobs.filter((job) => safeStatus(job) === "saved").length;
  const shortlistedCount = jobs.filter((job) => safeStatus(job) === "shortlisted").length;
  const readyToApplyCount = jobs.filter((job) => safeStatus(job) === "ready_to_apply").length;
  const interviewCount = jobs.filter((job) => safeStatus(job) === "interview").length;
  const offerCount = jobs.filter((job) => safeStatus(job) === "offer").length;
  const uniqueCompanies = new Set(jobs.map((job) => job.company).filter(Boolean)).size;

  dashboardStatsContainer.innerHTML = `
    <div class="stat-card stat-card--clickable" data-stat="links">
      <div class="stat-card__label">Links sent</div>
      <div class="stat-card__value">${jobs.length}</div>
      <div class="stat-card__trend">Live roles in feed</div>
    </div>
    <div class="stat-card stat-card--clickable" data-stat="new24">
      <div class="stat-card__label">New (24h)</div>
      <div class="stat-card__value">${newLast24}</div>
      <div class="stat-card__trend">Updated in last day</div>
    </div>
    <div class="stat-card stat-card--clickable" data-stat="new72">
      <div class="stat-card__label">New (72h)</div>
      <div class="stat-card__value">${newLast72}</div>
      <div class="stat-card__trend">Updated in last 3 days</div>
    </div>
    <div class="stat-card stat-card--clickable" data-stat="appliedToday">
      <div class="stat-card__label">Applied today</div>
      <div class="stat-card__value">${appliedToday}</div>
      <div class="stat-card__trend">Since midnight</div>
    </div>
    <div class="stat-card stat-card--clickable" data-stat="appliedYesterday">
      <div class="stat-card__label">Applied yesterday</div>
      <div class="stat-card__value">${appliedYesterday}</div>
      <div class="stat-card__trend">Previous day</div>
    </div>
    <div class="stat-card stat-card--clickable" data-stat="saved">
      <div class="stat-card__label">Saved</div>
      <div class="stat-card__value">${savedCount}</div>
      <div class="stat-card__trend">Tap to triage</div>
    </div>
    <div class="stat-card stat-card--clickable" data-stat="shortlisted">
      <div class="stat-card__label">Shortlisted</div>
      <div class="stat-card__value">${shortlistedCount}</div>
      <div class="stat-card__trend">Worth a closer look</div>
    </div>
    <div class="stat-card stat-card--clickable" data-stat="readyToApply">
      <div class="stat-card__label">Ready to Apply</div>
      <div class="stat-card__value">${readyToApplyCount}</div>
      <div class="stat-card__trend">Open Apply Hub</div>
    </div>
    <div class="stat-card stat-card--clickable" data-stat="interview">
      <div class="stat-card__label">Interviews</div>
      <div class="stat-card__value">${interviewCount}</div>
      <div class="stat-card__trend">Active</div>
    </div>
    <div class="stat-card stat-card--clickable" data-stat="offer">
      <div class="stat-card__label">Offers</div>
      <div class="stat-card__value">${offerCount}</div>
      <div class="stat-card__trend">Win rate tracker</div>
    </div>
    <div class="stat-card stat-card--clickable" data-stat="uniqueCompanies">
      <div class="stat-card__label">Unique companies</div>
      <div class="stat-card__value">${uniqueCompanies}</div>
      <div class="stat-card__trend">Company spread</div>
    </div>
  `;

  dashboardStatsContainer.querySelectorAll(".stat-card--clickable").forEach((card) => {
    const stat = card.dataset.stat;
    card.addEventListener("click", () => {
      if (stat === "links") {
        applyQuickFilter({ label: "All roles", predicate: null, status: "" });
        return;
      }
      if (stat === "new24") {
        applyQuickFilter({
          label: "Updated in last 24 hours",
          predicate: (job) => {
            const dt = parseDateValue(job.updated_at);
            return dt && dt >= last24;
          },
        });
        return;
      }
      if (stat === "new72") {
        applyQuickFilter({
          label: "Updated in last 72 hours",
          predicate: (job) => {
            const dt = parseDateValue(job.updated_at);
            return dt && dt >= last72;
          },
        });
        return;
      }
      if (stat === "appliedToday") {
        applyQuickFilter({
          label: "Applied today",
          status: "applied",
          predicate: (job) => {
            const dt = parseDateValue(job.application_date);
            return dt && dt >= startToday;
          },
        });
        return;
      }
      if (stat === "appliedYesterday") {
        applyQuickFilter({
          label: "Applied yesterday",
          status: "applied",
          predicate: (job) => {
            const dt = parseDateValue(job.application_date);
            return dt && dt >= startYesterday && dt < startToday;
          },
        });
        return;
      }
      if (stat === "saved") {
        const savedJobs = jobs.filter((j) => safeStatus(j) === "saved");
        if (savedJobs.length > 0) {
          openTriageMode(savedJobs);
        } else {
          applyQuickFilter({ label: "Saved roles", status: "saved" });
        }
        return;
      }
      if (stat === "shortlisted") {
        applyQuickFilter({ label: "Shortlisted roles", status: "shortlisted" });
        return;
      }
      if (stat === "readyToApply") {
        setActiveTab("top");
        return;
      }
      if (stat === "interview") {
        applyQuickFilter({ label: "Interview stage", status: "interview" });
        return;
      }
      if (stat === "offer") {
        applyQuickFilter({ label: "Offers", status: "offer" });
        return;
      }
      if (stat === "uniqueCompanies") {
        applyQuickFilter({ label: "Unique companies", uniqueCompanies: true });
        return;
      }
    });
  });
};

const renderPipelineView = (jobs) => {
  const container = document.getElementById("pipeline-view");
  if (!container) return;

  const safeStatus = (job) => (job.application_status || "saved").toLowerCase();
  const statuses = ["saved", "shortlisted", "ready_to_apply", "applied", "interview", "offer", "rejected"];
  const labels = { saved: "Saved", shortlisted: "Shortlisted", ready_to_apply: "Ready to Apply", applied: "Applied", interview: "Interview", offer: "Offer", rejected: "Rejected" };
  const groups = {};
  statuses.forEach((s) => (groups[s] = []));
  jobs.forEach((job) => {
    const s = safeStatus(job);
    if (groups[s]) groups[s].push(job);
  });

  container.innerHTML = `
    <div class="section-title" style="margin-bottom:12px;">Pipeline</div>
    <div class="pipeline-columns">
      ${statuses
        .map(
          (s) => `
        <div class="pipeline-col" data-pipeline-status="${s}">
          <div class="pipeline-col__header">${labels[s]} <span class="pipeline-col__count">(${groups[s].length})</span></div>
          <div class="pipeline-col__jobs">
            ${groups[s]
              .slice(0, 8)
              .map(
                (job) =>
                  `<div class="pipeline-job" data-job-id="${escapeHtml(job.id)}"><div class="pipeline-job__role">${escapeHtml(job.role)}</div><div class="pipeline-job__company">${escapeHtml(job.company)}</div></div>`
              )
              .join("")}
            ${groups[s].length > 8 ? `<div class="pipeline-job__more">+${groups[s].length - 8} more</div>` : ""}
          </div>
        </div>`
        )
        .join("")}
    </div>
  `;

  container.querySelectorAll(".pipeline-col").forEach((col) => {
    col.addEventListener("click", () => {
      const s = col.dataset.pipelineStatus;
      applyQuickFilter({ label: `${labels[s]} roles`, status: s });
    });
  });
};

const renderFollowUps = (jobs) => {
  const container = document.getElementById("follow-ups");
  if (!container) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const safeStatus = (job) => (job.application_status || "saved").toLowerCase();

  const overdue = jobs.filter((job) => {
    const s = safeStatus(job);
    if (s === "rejected" || s === "offer") return false;
    const dt = parseDateValue(job.follow_up_date);
    return dt && dt <= today;
  }).sort((a, b) => {
    const da = parseDateValue(a.follow_up_date);
    const db2 = parseDateValue(b.follow_up_date);
    return (da || 0) - (db2 || 0);
  });

  if (!overdue.length) {
    container.innerHTML = "";
    return;
  }

  const daysDiff = (date) => {
    const diff = today - date;
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  };

  container.innerHTML = `
    <div class="section-title" style="margin-bottom:12px;">Follow-ups Due</div>
    <div class="follow-ups-list">
      ${overdue
        .map((job) => {
          const dt = parseDateValue(job.follow_up_date);
          const days = daysDiff(dt);
          const label = days === 0 ? "Due today" : `${days}d overdue`;
          return `<div class="follow-up-card" data-job-id="${escapeHtml(job.id)}">
            <div class="follow-up-card__role">${escapeHtml(job.role)}</div>
            <div class="follow-up-card__company">${escapeHtml(job.company)}</div>
            <div class="follow-up-card__overdue">${label}</div>
          </div>`;
        })
        .join("")}
    </div>
  `;

  container.querySelectorAll(".follow-up-card").forEach((el) => {
    el.addEventListener("click", () => {
      const jobId = el.dataset.jobId;
      setActiveTab("live");
      setTimeout(() => {
        const target = document.querySelector(`#carousel-${jobId}`)?.closest(".job-card");
        if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
    });
  });
};

const setActiveTab = (tabId) => {
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.classList.toggle("nav-item--active", btn.dataset.tab === tabId);
  });
  document.querySelectorAll(".tab-section").forEach((section) => {
    section.classList.toggle("hidden", section.dataset.tab !== tabId);
  });
  if (breadcrumbLine) {
    const activeBtn = document.querySelector(`.nav-item[data-tab="${tabId}"]`);
    const label = activeBtn ? activeBtn.textContent.trim() : tabId;
    breadcrumbLine.textContent = `Home / ${label}`;
  }
  if (tabId !== "live") {
    state.selectedJobs.clear();
    updateBulkBar();
  }
};

document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    setActiveTab(btn.dataset.tab);
  });
});

if (prepCloseBtn) {
  prepCloseBtn.addEventListener("click", closePrepMode);
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (!triageOverlay.classList.contains("hidden")) {
      closeTriageMode();
    } else {
      closePrepMode();
    }
    return;
  }

  if (triageOverlay && !triageOverlay.classList.contains("hidden")) {
    const focusTag = (event.target.tagName || "").toUpperCase();
    if (["INPUT", "TEXTAREA", "SELECT"].includes(focusTag)) return;
    if (event.key === "ArrowLeft") {
      handleTriageAction("dismiss");
    } else if (event.key === "ArrowRight") {
      handleTriageAction("shortlist");
    } else if (event.key === "ArrowUp") {
      handleTriageAction("apply");
    } else if (event.key === " ") {
      event.preventDefault();
      handleTriageAction("skip");
    }
  }
});

document.querySelectorAll(".prep-tab").forEach((btn) => {
  btn.addEventListener("click", () => switchPrepTab(btn.dataset.prepTab));
});

setActiveTab("dashboard");

const loadJobs = async () => {
  summaryLine.textContent = "Fetching latest roles…";
  if (alertBanner) {
    alertBanner.classList.add("hidden");
    alertBanner.textContent = "";
  }

  if (!window.FIREBASE_CONFIG) {
    summaryLine.textContent = "Missing Firebase config. Add config.js first.";
    if (alertBanner) {
      alertBanner.classList.remove("hidden");
      alertBanner.innerHTML =
        "<strong>Setup required:</strong> Add your Firebase config in <code>config.js</code>.";
    }
    return;
  }

  try {
    const app = initializeApp(window.FIREBASE_CONFIG);
    db = getFirestore(app);
    collectionName = window.FIREBASE_COLLECTION || "jobs";
    statsCollection = window.FIREBASE_STATS_COLLECTION || "job_stats";
    suggestionsCollection = window.FIREBASE_SUGGESTIONS_COLLECTION || "role_suggestions";
    candidatePrepCollection = window.FIREBASE_CANDIDATE_PREP_COLLECTION || "candidate_prep";
    runRequestsCollection = window.FIREBASE_RUN_REQUESTS_COLLECTION || "run_requests";

    const jobsRef = collection(db, collectionName);
    const jobsQuery = query(jobsRef, orderBy("fit_score", "desc"), limit(200));
    const snapshot = await getDocs(jobsQuery);

    const jobs = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      prep_questions: doc.data().prep_questions || [],
    }));

    state.jobs = jobs;
    state.sources = new Set(jobs.map((job) => job.source).filter(Boolean));
    state.locations = new Set(jobs.map((job) => job.location).filter(Boolean));

    renderDashboardStats(jobs);
    renderPipelineView(jobs);
    renderFollowUps(jobs);
    renderFilters();
    renderJobs();
    renderApplyHub();

    summaryLine.textContent = `${jobs.length} roles loaded · Last update ${new Date().toLocaleString()}`;
  } catch (error) {
    console.error(error);
    const message = error?.message || "Unknown error";
    summaryLine.textContent = `Failed to load roles: ${message}`;
    if (alertBanner) {
      alertBanner.classList.remove("hidden");
      if (String(message).toLowerCase().includes("permissions")) {
        alertBanner.innerHTML =
          "<strong>Permission error:</strong> Update your Firestore rules to allow read access to the jobs collection.";
      } else {
        alertBanner.innerHTML = `<strong>Load error:</strong> ${escapeHtml(message)}`;
      }
    }
    return;
  }

  const warnParts = [];
  try {
    const statsRef = collection(db, statsCollection);
    const statsQuery = query(statsRef, orderBy("date", "desc"), limit(7));
    const statsSnap = await getDocs(statsQuery);
    const statsDocs = statsSnap.docs.map((doc) => doc.data());
    renderSourceStats(statsDocs);
  } catch (error) {
    console.error(error);
    warnParts.push({ name: "source stats", error });
  }

  try {
    const suggestionsRef = collection(db, suggestionsCollection);
    const suggestionsQuery = query(suggestionsRef, orderBy("date", "desc"), limit(1));
    const suggestionsSnap = await getDocs(suggestionsQuery);
    const suggestionDoc = suggestionsSnap.docs[0]?.data();
    renderRoleSuggestions(suggestionDoc);
  } catch (error) {
    console.error(error);
    warnParts.push({ name: "role suggestions", error });
  }

  try {
    const prepRef = collection(db, candidatePrepCollection);
    const prepQuery = query(prepRef, orderBy("date", "desc"), limit(1));
    const prepSnap = await getDocs(prepQuery);
    const prepDoc = prepSnap.docs[0]?.data();
    state.candidatePrep = prepDoc || {};
    renderCandidatePrep(prepDoc);
  } catch (error) {
    console.error(error);
    warnParts.push({ name: "candidate prep", error });
  }

  if (warnParts.length && alertBanner) {
    const detailList = warnParts
      .map((item) => {
        const message = item.error?.message || "Unknown error";
        return `<li>${escapeHtml(item.name)} — ${escapeHtml(message)}</li>`;
      })
      .join("");
    alertBanner.classList.remove("hidden");
    alertBanner.classList.add("alert--warning");
    alertBanner.innerHTML = `
      <strong>Limited data:</strong> Some collections could not load.
      <ul>${detailList}</ul>
      <div style="margin-top:6px;">Check Firestore rules for <code>job_stats</code>, <code>role_suggestions</code>, and <code>candidate_prep</code>.</div>
    `;
  }
};

refreshBtn.addEventListener("click", loadJobs);
searchInput.addEventListener("input", renderJobs);
minFitSelect.addEventListener("change", renderJobs);
sourceSelect.addEventListener("change", renderJobs);
locationSelect.addEventListener("change", renderJobs);
statusSelect.addEventListener("change", renderJobs);
ukOnlyCheckbox.addEventListener("change", renderJobs);

runNowBtn.addEventListener("click", async () => {
  if (!db) {
    runStatusLine.textContent = "Not connected.";
    runStatusLine.classList.remove("hidden");
    return;
  }
  runNowBtn.disabled = true;
  runNowBtn.textContent = "Triggering…";
  runStatusLine.textContent = "Sending run request…";
  runStatusLine.classList.remove("hidden");

  const ref = doc(db, runRequestsCollection, "latest");
  await setDoc(ref, { status: "pending", requested_at: new Date().toISOString() });

  runStatusLine.textContent = "Run triggered — waiting for Mac watcher (~2 min)…";
  const start = Date.now();
  const poll = setInterval(async () => {
    try {
      const snap = await getDoc(ref);
      const data = snap.data();
      const status = data?.status;
      if (status === "running") {
        runStatusLine.textContent = "Running — fetching jobs…";
      } else if (status === "done") {
        clearInterval(poll);
        runStatusLine.textContent = "Done — refreshing results…";
        runNowBtn.disabled = false;
        runNowBtn.textContent = "Run now";
        await loadJobs();
        runStatusLine.textContent = "Complete.";
      } else if (status === "error") {
        clearInterval(poll);
        const tail = data?.error_tail ? `\n${data.error_tail}` : "";
        runStatusLine.textContent = `Run failed — check watcher log on Mac.${tail}`;
        runNowBtn.disabled = false;
        runNowBtn.textContent = "Run now";
      } else if (Date.now() - start > 300_000) {
        clearInterval(poll);
        runStatusLine.textContent = "Timed out — run may still complete in background.";
        runNowBtn.disabled = false;
        runNowBtn.textContent = "Run now";
      }
    } catch (err) {
      clearInterval(poll);
      console.error("Poll error:", err);
      runStatusLine.textContent = "Connection error during polling.";
      runNowBtn.disabled = false;
      runNowBtn.textContent = "Run now";
    }
  }, 10_000);
});

// ── Notification permission toggle ──
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

// ── Browser notifications for new high-fit jobs ──
const checkNewJobNotifications = (jobs) => {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const knownRaw = localStorage.getItem("known_job_ids");
    const knownIds = knownRaw ? new Set(JSON.parse(knownRaw)) : new Set();
    const currentIds = jobs.map((j) => j.id);
    const newHighFit = jobs.filter((j) => !knownIds.has(j.id) && j.fit_score >= 80);
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

// Wrap loadJobs to add notification check after load
const loadJobsAndNotify = async () => {
  await loadJobs();
  if (state.jobs.length) checkNewJobNotifications(state.jobs);
};

loadJobsAndNotify();
