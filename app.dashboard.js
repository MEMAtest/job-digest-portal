import {
  state,
  dashboardStatsContainer,
  sourceStatsContainer,
  followUpBanner,
  triagePrompt,
  db,
  collectionName,
  doc,
  updateDoc,
  formatInlineText,
  formatList,
  normaliseList,
  escapeHtml,
  parseDateValue,
  safeLocalStorageGet,
  safeLocalStorageSet,
  getTodayKey,
  TRIAGE_PROMPT_THRESHOLD,
  applyQuickFilter,
  showToast,
} from "./app.core.js";
import { openTriageMode } from "./app.triage.js";

const prepCardList = document.getElementById("prep-card-list");
const prepDetailTitle = document.getElementById("prep-detail-title");
const prepDetailMeta = document.getElementById("prep-detail-meta");
const prepDetailTabs = document.getElementById("prep-detail-tabs");
const prepDetailContent = document.getElementById("prep-detail-content");
const contractCalculator = document.getElementById("contract-calculator");

let prepActiveSection = null;
let prepActiveTab = "star";
const prepExpanded = {};

const truncateText = (text, len = 120) => {
  const value = String(text || "").trim();
  if (!value) return "";
  return value.length > len ? `${value.slice(0, len)}…` : value;
};

const CONTRACT_STORAGE_KEY = "contract_calc_v1";
const CONTRACT_DEFAULTS = {
  minRate: "",
  maxRate: "",
  daysPerWeek: "",
  weeksPerYear: "",
};

const readContractSettings = () => {
  try {
    const stored = safeLocalStorageGet(CONTRACT_STORAGE_KEY);
    if (stored) return { ...CONTRACT_DEFAULTS, ...JSON.parse(stored) };
  } catch (error) {
    // ignore
  }
  return { ...CONTRACT_DEFAULTS };
};

const saveContractSettings = (settings) => {
  try {
    safeLocalStorageSet(CONTRACT_STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    // ignore
  }
};

const renderContractCalculator = () => {
  if (!contractCalculator) return;
  const current = readContractSettings();

  contractCalculator.innerHTML = `
    <div class="contract-card__header">
      <div>
        <h3>Contract rate calculator</h3>
        <p>Estimate gross earnings from day rates (no tax applied).</p>
      </div>
    </div>
    <div class="contract-grid">
      <div class="contract-field">
        <label>Day rate (min)</label>
        <input type="number" class="contract-input" data-field="minRate" min="0" value="${current.minRate}" placeholder="e.g. 650" />
      </div>
      <div class="contract-field">
        <label>Day rate (max)</label>
        <input type="number" class="contract-input" data-field="maxRate" min="0" value="${current.maxRate}" placeholder="e.g. 825" />
      </div>
      <div class="contract-field">
        <label>Days per week</label>
        <input type="number" class="contract-input" data-field="daysPerWeek" min="1" max="7" value="${current.daysPerWeek}" placeholder="e.g. 5" />
      </div>
      <div class="contract-field">
        <label>Weeks per year</label>
        <input type="number" class="contract-input" data-field="weeksPerYear" min="1" max="52" value="${current.weeksPerYear}" placeholder="e.g. 46" />
      </div>
    </div>
    <div class="contract-results">
      <div class="contract-result" data-result="min">
        <span class="contract-result__label">Min rate estimate</span>
        <span class="contract-result__value">—</span>
      </div>
      <div class="contract-result" data-result="max">
        <span class="contract-result__label">Max rate estimate</span>
        <span class="contract-result__value">—</span>
      </div>
    </div>
  `;

  const formatter = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  });

  const updateResults = () => {
    const inputs = contractCalculator.querySelectorAll(".contract-input");
    const settings = { ...CONTRACT_DEFAULTS };
    inputs.forEach((input) => {
      const key = input.dataset.field;
      const raw = input.value;
      settings[key] = raw;
    });

    const days = Number(settings.daysPerWeek);
    const weeks = Number(settings.weeksPerYear);
    const hasSchedule = Number.isFinite(days) && days > 0 && Number.isFinite(weeks) && weeks > 0;
    const minRate = Number(settings.minRate);
    const maxRate = Number(settings.maxRate);

    const minEl = contractCalculator.querySelector('[data-result="min"] .contract-result__value');
    const maxEl = contractCalculator.querySelector('[data-result="max"] .contract-result__value');

    if (!hasSchedule) {
      if (minEl) minEl.textContent = "Enter days/week + weeks/year";
      if (maxEl) maxEl.textContent = "Enter days/week + weeks/year";
      saveContractSettings(settings);
      return;
    }

    if (minEl) {
      if (Number.isFinite(minRate) && minRate > 0) {
        const minAnnual = minRate * days * weeks;
        const minMonthly = minAnnual / 12;
        minEl.textContent = `${formatter.format(minAnnual)} / year · ${formatter.format(minMonthly)} / month`;
      } else {
        minEl.textContent = "Enter a day rate";
      }
    }
    if (maxEl) {
      if (Number.isFinite(maxRate) && maxRate > 0) {
        const maxAnnual = maxRate * days * weeks;
        const maxMonthly = maxAnnual / 12;
        maxEl.textContent = `${formatter.format(maxAnnual)} / year · ${formatter.format(maxMonthly)} / month`;
      } else {
        maxEl.textContent = "Enter a day rate";
      }
    }

    saveContractSettings(settings);
  };

  contractCalculator.querySelectorAll(".contract-input").forEach((input) => {
    input.addEventListener("input", updateResults);
  });

  updateResults();
};

const stripMarkdown = (value) =>
  String(value || "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/[_`]/g, "")
    .replace(/\\n/g, " ")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const summariseStar = (value) => {
  const cleaned = stripMarkdown(value);
  const match = cleaned.match(/Situation\s*['"]?\s*:\s*([^\.]+)\.?/i);
  if (match && match[1]) return match[1].trim();
  return cleaned;
};

const parseStarStory = (value) => {
  const cleaned = stripMarkdown(value);
  const matches = [...cleaned.matchAll(/(Situation|Task|Action|Result)\s*['"]?\s*:/gi)];
  if (!matches.length) return { raw: cleaned };

  const parts = { situation: "", task: "", action: "", result: "", raw: cleaned };
  matches.forEach((match, index) => {
    const key = match[1].toLowerCase();
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? cleaned.length;
    parts[key] = cleaned.slice(start, end).trim();
  });
  return parts;
};

const buildModelAnswer = (question, prep) => {
  const stats = normaliseList(prep.key_stats || []).slice(0, 2);
  const strengths = normaliseList(prep.strengths || []).slice(0, 2);
  const example = summariseStar(normaliseList(prep.star_stories || [])[0] || "");

  const opener = prep.quick_pitch
    ? truncateText(stripMarkdown(prep.quick_pitch), 200)
    : "Start with a crisp one-line summary of your fit.";

  const blocks = [
    `<p><strong>Open with:</strong> ${formatInlineText(opener)}</p>`,
  ];

  if (stats.length) {
    blocks.push(`<div><strong>Evidence:</strong>${formatList(stats)}</div>`);
  }
  if (strengths.length) {
    blocks.push(`<div><strong>Strengths to weave in:</strong>${formatList(strengths)}</div>`);
  }
  if (example) {
    blocks.push(`<p><strong>Example:</strong> ${formatInlineText(example)}</p>`);
  }
  blocks.push(`<p><strong>Close:</strong> Tie the impact back to this role’s outcomes.</p>`);
  return blocks.join("");
};

const buildPrepCards = () => {
  const prep = state.candidatePrep || {};
  const suggestions = state.roleSuggestions || {};

  const starStories = normaliseList(prep.star_stories || []);
  const questions = normaliseList(prep.interview_questions || []);
  const talking = normaliseList(prep.key_talking_points || []);
  const stats = normaliseList(prep.key_stats || []);
  const strengths = normaliseList(prep.strengths || []);
  const risks = normaliseList(prep.risk_mitigations || []);
  const roles = normaliseList(suggestions.roles || []);

  return [
    {
      id: "quick_pitch",
      title: "Quick Pitch",
      meta: "Summary snapshot",
      preview: truncateText(stripMarkdown(prep.quick_pitch || "Not available yet.")),
    },
    {
      id: "star",
      title: "STAR Stories",
      meta: `${starStories.length} stories`,
      preview: truncateText(summariseStar(starStories[0] || "Not available yet.")),
    },
    {
      id: "qa",
      title: "Interview Q&A",
      meta: `${questions.length} questions`,
      preview: truncateText(stripMarkdown(questions[0] || "Not available yet.")),
    },
    {
      id: "talking",
      title: "Talking Points",
      meta: `${talking.length} points`,
      preview: truncateText(stripMarkdown(talking[0] || "Not available yet.")),
    },
    {
      id: "key_stats",
      title: "Key Stats",
      meta: `${stats.length} items`,
      preview: truncateText(stripMarkdown(stats[0] || "Not available yet.")),
    },
    {
      id: "strengths",
      title: "Strengths",
      meta: `${strengths.length} items`,
      preview: truncateText(stripMarkdown(strengths[0] || "Not available yet.")),
    },
    {
      id: "risk_mitigations",
      title: "Risk Mitigations",
      meta: `${risks.length} items`,
      preview: truncateText(stripMarkdown(risks[0] || "Not available yet.")),
    },
    {
      id: "adjacent_roles",
      title: "Adjacent Roles",
      meta: `${roles.length} roles`,
      preview: truncateText(stripMarkdown(roles[0] || "Not available yet.")),
    },
  ];
};

const renderPrepDetail = () => {
  if (!prepDetailContent) return;
  const prep = state.candidatePrep || {};
  const suggestions = state.roleSuggestions || {};

  if (!prepActiveSection) {
    prepDetailContent.innerHTML = `<div class="prep-detail-empty">Select a card to view details.</div>`;
    return;
  }

  const setTabsVisible = (visible) => {
    if (!prepDetailTabs) return;
    prepDetailTabs.classList.toggle("hidden", !visible);
    prepDetailTabs.style.display = visible ? "flex" : "none";
    prepDetailTabs.hidden = !visible;
    prepDetailTabs.setAttribute("aria-hidden", (!visible).toString());
  };

  const renderDetailCards = (items, labelPrefix = "Item", activeKey = "", options = {}) => {
    const isMobile = window.matchMedia("(max-width: 900px)").matches;
    const maxItems = isMobile ? 3 : items.length;
    const expanded = prepExpanded[activeKey];
    const visibleItems = expanded ? items : items.slice(0, maxItems);
    if (!items.length) {
      return `<div class="prep-detail-empty">Not available yet.</div>`;
    }
    const renderSummary = options.renderSummary;
    const renderBody = options.renderBody;
    const cards = visibleItems
      .map((item, idx) => {
        const title = `${labelPrefix} ${idx + 1}`;
        const summaryHtml = renderSummary ? renderSummary(item, idx, title) : escapeHtml(title);
        const bodyHtml = renderBody ? renderBody(item, idx, title) : formatInlineText(item);
        return `
          <details class="prep-detail-card">
            <summary>${summaryHtml}</summary>
            <div class="prep-detail-card__body">${bodyHtml}</div>
          </details>
        `;
      })
      .join("");
    if (items.length > maxItems) {
      const label = expanded ? "Show fewer" : `Show all (${items.length})`;
      return `${cards}<button class="btn btn-tertiary prep-detail-more" data-more="${escapeHtml(activeKey)}">${label}</button>`;
    }
    return cards;
  };

  const useTabs = ["star", "qa", "talking"].includes(prepActiveSection);
  if (useTabs) {
    setTabsVisible(true);
    if (prepActiveTab !== "star" && prepActiveTab !== "qa" && prepActiveTab !== "talking") {
      prepActiveTab = prepActiveSection;
    }
  } else {
    setTabsVisible(false);
  }

  if (prepDetailTabs) {
    prepDetailTabs.querySelectorAll(".prep-detail-tab").forEach((btn) => {
      btn.classList.toggle("prep-detail-tab--active", btn.dataset.prepTab === prepActiveTab);
    });
  }

  const activeKey = useTabs ? prepActiveTab : prepActiveSection;

  if (activeKey === "star") {
    const starStories = normaliseList(prep.star_stories || []);
    prepDetailTitle.textContent = "STAR Stories";
    prepDetailMeta.textContent = `${starStories.length} stories to rehearse.`;
    prepDetailContent.innerHTML = renderDetailCards(starStories, "STAR Story", "star", {
      renderSummary: (item, idx) => {
        const short = truncateText(summariseStar(item), 90);
        return `
          <span>STAR Story ${idx + 1}</span>
          <span class="prep-detail-summary">${escapeHtml(short || "Overview not available.")}</span>
        `;
      },
      renderBody: (item) => {
        const parsed = parseStarStory(item);
        if (!parsed || (!parsed.situation && !parsed.task && !parsed.action && !parsed.result)) {
          return `<div class="prep-detail-text">${formatInlineText(parsed.raw || item)}</div>`;
        }
        const rows = [
          parsed.situation ? `<div class="prep-star-row"><span>Situation</span><p>${formatInlineText(parsed.situation)}</p></div>` : "",
          parsed.task ? `<div class="prep-star-row"><span>Task</span><p>${formatInlineText(parsed.task)}</p></div>` : "",
          parsed.action ? `<div class="prep-star-row"><span>Action</span><p>${formatInlineText(parsed.action)}</p></div>` : "",
          parsed.result ? `<div class="prep-star-row"><span>Result</span><p>${formatInlineText(parsed.result)}</p></div>` : "",
        ]
          .filter(Boolean)
          .join("");
        return `<div class="prep-star-grid">${rows}</div>`;
      },
    });
    return;
  }
  if (activeKey === "qa") {
    const questions = normaliseList(prep.interview_questions || []);
    prepDetailTitle.textContent = "Interview Q&A";
    prepDetailMeta.textContent = `${questions.length} likely questions.`;
    prepDetailContent.innerHTML = renderDetailCards(questions, "Question", "qa", {
      renderSummary: (item, idx) => {
        const short = truncateText(stripMarkdown(item), 90);
        return `
          <span>Question ${idx + 1}</span>
          <span class="prep-detail-summary">${escapeHtml(short || "Question not available.")}</span>
        `;
      },
      renderBody: (item) => `
        <div class="prep-detail-question">${formatInlineText(item)}</div>
        <div class="prep-detail-answer">${buildModelAnswer(item, prep)}</div>
      `,
    });
    return;
  }
  if (activeKey === "talking") {
    const talking = normaliseList(prep.key_talking_points || []);
    prepDetailTitle.textContent = "Talking Points";
    prepDetailMeta.textContent = `${talking.length} key points.`;
    prepDetailContent.innerHTML = renderDetailCards(talking, "Talking Point", "talking");
    return;
  }

  if (prepActiveSection === "quick_pitch") {
    prepDetailTitle.textContent = "Quick Pitch";
    prepDetailMeta.textContent = "Use this as your opener.";
    prepDetailContent.innerHTML = `
      <details class="prep-detail-card">
        <summary>Quick pitch</summary>
        <div class="prep-detail-card__body">${formatInlineText(prep.quick_pitch || "Not available yet.")}</div>
      </details>
    `;
    return;
  }

  if (prepActiveSection === "key_stats") {
    const stats = normaliseList(prep.key_stats || []);
    prepDetailTitle.textContent = "Key Stats";
    prepDetailMeta.textContent = `${stats.length} proof points.`;
    prepDetailContent.innerHTML = renderDetailCards(stats, "Stat", "key_stats");
    return;
  }

  if (prepActiveSection === "strengths") {
    const strengths = normaliseList(prep.strengths || []);
    prepDetailTitle.textContent = "Strengths";
    prepDetailMeta.textContent = `${strengths.length} themes to emphasise.`;
    prepDetailContent.innerHTML = renderDetailCards(strengths, "Strength", "strengths");
    return;
  }

  if (prepActiveSection === "risk_mitigations") {
    const risks = normaliseList(prep.risk_mitigations || []);
    prepDetailTitle.textContent = "Risk Mitigations";
    prepDetailMeta.textContent = `${risks.length} mitigations ready.`;
    prepDetailContent.innerHTML = renderDetailCards(risks, "Mitigation", "risk_mitigations");
    return;
  }

  if (prepActiveSection === "adjacent_roles") {
    const roles = normaliseList(suggestions.roles || []);
    prepDetailTitle.textContent = "Adjacent Roles";
    prepDetailMeta.textContent = `${roles.length} roles to consider.`;
    prepDetailContent.innerHTML = `
      <details class="prep-detail-card">
        <summary>Roles to consider</summary>
        <div class="prep-detail-card__body">${formatList(roles)}</div>
      </details>
      ${suggestions.rationale ? `<details class="prep-detail-card"><summary>Why these roles</summary><div class="prep-detail-card__body">${formatInlineText(suggestions.rationale)}</div></details>` : ""}
    `;
    return;
  }

  prepDetailContent.innerHTML = `<div class="prep-detail-empty">Select a card to view details.</div>`;
};

const renderPrepBoard = () => {
  if (!prepCardList || !prepDetailContent) return;
  const cards = buildPrepCards();

  if (!prepActiveSection) {
    const preferred = cards.find((card) => card.id === "star" && card.preview && card.preview !== "Not available yet.");
    prepActiveSection = preferred?.id || cards[0]?.id || null;
  }

  prepCardList.innerHTML = cards
    .map(
      (card) => `
      <div class="prep-card ${prepActiveSection === card.id ? "prep-card--active" : ""}" data-section="${card.id}">
        <div class="prep-card__title">${escapeHtml(card.title)}</div>
        <div class="prep-card__meta">${escapeHtml(card.meta)}</div>
        <div class="prep-card__preview">${formatInlineText(card.preview || "Not available yet.")}</div>
      </div>
    `
    )
    .join("");

  prepCardList.querySelectorAll(".prep-card").forEach((cardEl) => {
    cardEl.addEventListener("click", () => {
      prepActiveSection = cardEl.dataset.section;
      if (["star", "qa", "talking"].includes(prepActiveSection)) {
        prepActiveTab = prepActiveSection;
      }
      renderPrepBoard();
    });
  });

  if (prepDetailTabs && prepDetailTabs.dataset.bound !== "true") {
    prepDetailTabs.querySelectorAll(".prep-detail-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        const nextTab = btn.dataset.prepTab;
        prepActiveSection = nextTab;
        prepActiveTab = nextTab;
        renderPrepBoard();
      });
    });
    prepDetailTabs.dataset.bound = "true";
  }

  renderPrepDetail();

  const moreBtn = prepDetailContent?.querySelector?.(".prep-detail-more");
  if (moreBtn) {
    moreBtn.addEventListener("click", () => {
      const key = moreBtn.dataset.more;
      prepExpanded[key] = !prepExpanded[key];
      renderPrepDetail();
    });
  }
};

export const renderSourceStats = (statsDocs) => {
  if (!statsDocs.length) {
    if (sourceStatsContainer) sourceStatsContainer.innerHTML = "";
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

  if (sourceStatsContainer) {
    sourceStatsContainer.innerHTML = `
      <div class="stat-card">
        <div class="stat-card__label">Total (today)</div>
        <div class="stat-card__value">${total}</div>
        <div class="stat-card__trend">7‑day total: ${sevenDayTotal}</div>
      </div>
      ${cards}
    `;
  }
};

export const renderRoleSuggestions = (doc) => {
  state.roleSuggestions = doc || null;
  renderPrepBoard();
};

export const renderCandidatePrep = (doc) => {
  state.candidatePrep = doc || {};
  renderPrepBoard();
};

export const renderDashboardStats = (jobs) => {
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
      <div class="stat-card__label">New</div>
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
        applyQuickFilter({ label: "All roles", predicate: null, status: "", resetFilters: true });
        return;
      }
      if (stat === "new24") {
        applyQuickFilter({
          label: "Updated in last 24 hours",
          predicate: (job) => {
            const dt = parseDateValue(job.updated_at);
            return dt && dt >= last24;
          },
          resetFilters: true,
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
          resetFilters: true,
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
          resetFilters: true,
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
          resetFilters: true,
        });
        return;
      }
      if (stat === "saved") {
        applyQuickFilter({ label: "New roles", status: "saved", resetFilters: true });
        return;
      }
      if (stat === "shortlisted") {
        applyQuickFilter({ label: "Shortlisted roles", status: "shortlisted", resetFilters: true });
        return;
      }
      if (stat === "readyToApply") {
        if (state.handlers.setActiveTab) state.handlers.setActiveTab("top");
        return;
      }
      if (stat === "interview") {
        applyQuickFilter({ label: "Interview stage", status: "interview", resetFilters: true });
        return;
      }
      if (stat === "offer") {
        applyQuickFilter({ label: "Offers", status: "offer", resetFilters: true });
        return;
      }
      if (stat === "uniqueCompanies") {
        applyQuickFilter({ label: "Unique companies", uniqueCompanies: true, resetFilters: true });
        return;
      }
    });
  });

  renderContractCalculator();
};

export const renderPipelineView = (jobs) => {
  const container = document.getElementById("pipeline-view");
  if (!container) return;

  const safeStatus = (job) => (job.application_status || "saved").toLowerCase();
  const statuses = ["saved", "shortlisted", "ready_to_apply", "applied", "interview", "offer", "rejected"];
  const labels = {
    saved: "New",
    shortlisted: "Shortlisted",
    ready_to_apply: "Ready to Apply",
    applied: "Applied",
    interview: "Interview",
    offer: "Offer",
    rejected: "Rejected",
  };
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

export const renderFollowUps = (jobs) => {
  const container = document.getElementById("follow-ups");
  if (!container) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const safeStatus = (job) => (job.application_status || "saved").toLowerCase();

  const overdue = jobs
    .filter((job) => {
      const s = safeStatus(job);
      if (s === "rejected" || s === "offer") return false;
      const dt = parseDateValue(job.follow_up_date);
      return dt && dt <= today;
    })
    .sort((a, b) => {
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
            <button class="follow-up-card__snooze" data-job-id="${escapeHtml(job.id)}">Snooze 1 day</button>
          </div>`;
        })
        .join("")}
    </div>
  `;

  container.querySelectorAll(".follow-up-card").forEach((el) => {
    el.addEventListener("click", () => {
      const jobId = el.dataset.jobId;
      if (state.handlers.setActiveTab) state.handlers.setActiveTab("live");
      setTimeout(() => {
        const target = document.querySelector(`#carousel-${jobId}`)?.closest(".job-card");
        if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
    });
  });

  container.querySelectorAll(".follow-up-card__snooze").forEach((btn) => {
    btn.addEventListener("click", async (event) => {
      event.stopPropagation();
      const jobId = btn.dataset.jobId;
      const job = state.jobs.find((j) => j.id === jobId);
      if (!job) return;
      const current = parseDateValue(job.follow_up_date) || new Date();
      const next = new Date(current.getTime() + 24 * 60 * 60 * 1000);
      const nextIso = `${next.toISOString().slice(0, 10)}T00:00:00.000Z`;
      try {
        if (db) {
          await updateDoc(doc(db, collectionName, jobId), {
            follow_up_date: nextIso,
            updated_at: new Date().toISOString(),
          });
        }
        job.follow_up_date = nextIso;
        renderFollowUps(state.jobs);
        renderFollowUpBanner(state.jobs);
        showToast("Follow-up snoozed");
      } catch (error) {
        console.error("Snooze failed:", error);
        showToast("Snooze failed");
      }
    });
  });
};

export const renderFollowUpBanner = (jobs) => {
  if (!followUpBanner) return;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const overdue = jobs.filter((job) => {
    const status = (job.application_status || "saved").toLowerCase();
    if (status === "rejected" || status === "offer") return false;
    const dt = parseDateValue(job.follow_up_date);
    return dt && dt <= today;
  });

  if (!overdue.length) {
    followUpBanner.classList.add("hidden");
    followUpBanner.innerHTML = "";
    return;
  }

  followUpBanner.classList.remove("hidden");
  followUpBanner.innerHTML = `
    <div>
      <strong>${overdue.length} follow-up${overdue.length > 1 ? "s" : ""} due</strong>
      <span class="banner__sub">Keep momentum on active applications.</span>
    </div>
    <div class="banner__actions">
      <button class="btn btn-secondary banner-view-followups">View</button>
    </div>
  `;

  const viewBtn = followUpBanner.querySelector(".banner-view-followups");
  if (viewBtn) {
    viewBtn.addEventListener("click", () => {
      applyQuickFilter({
        label: "Follow-ups due",
        predicate: (job) => {
          const status = (job.application_status || "saved").toLowerCase();
          if (status === "rejected" || status === "offer") return false;
          const dt = parseDateValue(job.follow_up_date);
          return dt && dt <= today;
        },
      });
      if (state.handlers.setActiveTab) state.handlers.setActiveTab("live");
    });
  }
};

export const triggerFollowUpNotifications = (jobs) => {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const todayKey = getTodayKey();
  const notifiedRaw = safeLocalStorageGet("followup_notified") || "{}";
  let notified = {};
  try {
    notified = JSON.parse(notifiedRaw) || {};
  } catch (error) {
    notified = {};
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  jobs.forEach((job) => {
    const status = (job.application_status || "saved").toLowerCase();
    if (status === "rejected" || status === "offer") return;
    const dt = parseDateValue(job.follow_up_date);
    if (!dt || dt > today) return;
    const key = `${job.id}-${todayKey}`;
    if (notified[key]) return;
    new Notification(`Follow up: ${job.company}`, {
      body: `${job.role} — due now`,
    });
    notified[key] = true;
  });
  safeLocalStorageSet("followup_notified", JSON.stringify(notified));
};

export const renderTriagePrompt = (jobs) => {
  if (!triagePrompt) return;
  const savedCount = jobs.filter((job) => (job.application_status || "saved").toLowerCase() === "saved").length;
  const todayKey = getTodayKey();
  const lastTriage = safeLocalStorageGet("last_triage_date") || "";

  if (savedCount <= TRIAGE_PROMPT_THRESHOLD || lastTriage === todayKey) {
    triagePrompt.classList.add("hidden");
    triagePrompt.innerHTML = "";
    return;
  }

  triagePrompt.classList.remove("hidden");
  triagePrompt.innerHTML = `
    <div>
      <strong>${savedCount} untriaged roles</strong>
      <span class="banner__sub">Triage now? Takes ~5 minutes.</span>
    </div>
    <div class="banner__actions">
      <button class="btn btn-primary banner-triage-start">Start triaging</button>
      <button class="btn btn-tertiary banner-triage-later">Remind me later</button>
    </div>
  `;

  const startBtn = triagePrompt.querySelector(".banner-triage-start");
  const laterBtn = triagePrompt.querySelector(".banner-triage-later");
  if (startBtn) {
    startBtn.addEventListener("click", () => {
      const triageable = jobs.filter((j) => (j.application_status || "saved").toLowerCase() === "saved");
      safeLocalStorageSet("last_triage_date", todayKey);
      openTriageMode(triageable);
      triagePrompt.classList.add("hidden");
    });
  }
  if (laterBtn) {
    laterBtn.addEventListener("click", () => {
      safeLocalStorageSet("last_triage_date", todayKey);
      triagePrompt.classList.add("hidden");
    });
  }
};

state.handlers.renderDashboardStats = renderDashboardStats;
state.handlers.renderPipelineView = renderPipelineView;
state.handlers.renderFollowUps = renderFollowUps;
state.handlers.renderFollowUpBanner = renderFollowUpBanner;
state.handlers.renderTriagePrompt = renderTriagePrompt;
state.handlers.renderRoleSuggestions = renderRoleSuggestions;
state.handlers.renderSourceStats = renderSourceStats;
state.handlers.renderCandidatePrep = renderCandidatePrep;
