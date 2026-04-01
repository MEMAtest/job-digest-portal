import {
  state,
  prepOverlay,
  prepOverlayTitle,
  prepOverlayMeta,
  prepOverlayContent,
  showToast,
  formatInlineText,
  normaliseList,
  formatList,
  escapeHtml,
  copyToClipboard,
  safeLocalStorageGet,
  safeLocalStorageSet,
} from "./app.core.js";
import { renderInterviewReview, cleanupInterviewReview } from "./app.interview-review.js";

export const buildPrepQa = (job) => {
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
          currentIndex += 1;
          render();
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

export const openPrepMode = (jobId) => {
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

export const closePrepMode = () => {
  if (!prepOverlay) return;
  cleanupInterviewReview();
  prepOverlay.classList.add("hidden");
  document.body.style.overflow = "";
  state.activePrepJob = null;
  if (prepOverlayContent) {
    prepOverlayContent.innerHTML = "";
  }
};

const getRehearsalKey = (jobId, slug) => `prep_rehearsal_${jobId}_${slug}`;

const renderSpokenAnswers = (container, job) => {
  if (!job.spoken_intro_60s) {
    container.innerHTML = `
      <div class="spoken-empty">
        <p>No spoken answers yet. Generate natural interview answers you can actually rehearse.</p>
        <button class="btn btn-primary generate-spoken-btn" data-job-id="${escapeHtml(job.id)}">Generate spoken answers</button>
      </div>
    `;
    const btn = container.querySelector(".generate-spoken-btn");
    if (btn) {
      btn.addEventListener("click", async () => {
        btn.textContent = "Generating...";
        btn.disabled = true;
        try {
          const res = await fetch("/.netlify/functions/generate-prep", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobId: job.id }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Generation failed");
          // Apply spoken fields directly to the in-memory job object
          const liveJob = state.jobs.find((j) => j.id === job.id) || job;
          liveJob.spoken_intro_60s = data.spoken_intro_60s || "";
          liveJob.spoken_intro_90s = data.spoken_intro_90s || "";
          liveJob.spoken_why_role = data.spoken_why_role || "";
          liveJob.spoken_working_style = data.spoken_working_style || "";
          liveJob.spoken_stories = data.spoken_stories || [];
          liveJob.power_questions = data.power_questions || [];
          state.activePrepJob = liveJob;
          showToast("Spoken answers generated");
          renderSpokenAnswers(container, liveJob);
        } catch (err) {
          showToast("Generation failed: " + err.message);
          btn.textContent = "Generate spoken answers";
          btn.disabled = false;
        }
      });
    }
    return;
  }

  let introVersion = "60s";

  const getIntroText = () =>
    introVersion === "90s"
      ? job.spoken_intro_90s || job.spoken_intro_60s || ""
      : job.spoken_intro_60s || "";

  const extractHook = (text) => {
    if (!text) return "";
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
    return sentences.slice(0, 2).join(" ").trim() || text.slice(0, 120);
  };

  const spokenSection = (titleText, bodyText, slug) => {
    const hook = extractHook(bodyText);
    const rehKey = getRehearsalKey(job.id, slug);
    const count = parseInt(safeLocalStorageGet(rehKey) || "0", 10);
    return `
      <div class="spoken-section" data-slug="${escapeHtml(slug)}">
        <h3 class="spoken-section__title">${escapeHtml(titleText)}</h3>
        <p class="spoken-section__hook">${formatInlineText(hook)}</p>
        <button class="spoken-reveal btn btn-secondary">Reveal full answer</button>
        <div class="spoken-full hidden">${formatInlineText(bodyText)}</div>
        <div class="spoken-actions">
          <button class="spoken-copy btn btn-ghost" data-text="${escapeHtml(bodyText)}">Copy</button>
          <button class="spoken-rehearsed btn btn-ghost" data-key="${escapeHtml(rehKey)}" data-count="${count}">
            ${count > 0 ? `Rehearsed ${count}&times;` : "Mark rehearsed"}
          </button>
        </div>
      </div>
    `;
  };

  const stories = (Array.isArray(job.spoken_stories) ? job.spoken_stories : []).filter(
    (s) => s && typeof s === "object"
  );
  const questions = Array.isArray(job.power_questions) ? job.power_questions : [];

  const storiesHtml = stories
    .map((s, i) => {
      const slug = `story-${i}-${slugify(s.title || String(i))}`;
      const rehKey = getRehearsalKey(job.id, slug);
      const count = parseInt(safeLocalStorageGet(rehKey) || "0", 10);
      return `
        <div class="spoken-section spoken-story" data-slug="${escapeHtml(slug)}">
          <h3 class="spoken-section__title">${escapeHtml(s.title || `Story ${i + 1}`)}</h3>
          <p class="spoken-section__hook">${formatInlineText(s.hook || "")}</p>
          <button class="spoken-reveal btn btn-secondary">Reveal full answer</button>
          <div class="spoken-full hidden">${formatInlineText(s.full || "")}</div>
          <div class="spoken-actions">
            <button class="spoken-copy btn btn-ghost" data-text="${escapeHtml(s.full || "")}">Copy</button>
            <button class="spoken-rehearsed btn btn-ghost" data-key="${escapeHtml(rehKey)}" data-count="${count}">
              ${count > 0 ? `Rehearsed ${count}&times;` : "Mark rehearsed"}
            </button>
          </div>
        </div>
      `;
    })
    .join("");

  const questionsHtml = questions.length
    ? `
      <div class="spoken-questions">
        <h3 class="spoken-section__title">Questions to ask</h3>
        <ol class="spoken-questions__list">
          ${questions.map((q) => `<li>${formatInlineText(q)}</li>`).join("")}
        </ol>
      </div>
    `
    : "";

  container.innerHTML = `
    <div class="spoken-answers">
      <div class="spoken-section spoken-intro" data-slug="intro">
        <h3 class="spoken-section__title">Tell me about yourself</h3>
        <div class="spoken-intro__toggle">
          <button class="btn btn-ghost spoken-toggle ${introVersion === "60s" ? "spoken-toggle--active" : ""}" data-version="60s">60s</button>
          <button class="btn btn-ghost spoken-toggle ${introVersion === "90s" ? "spoken-toggle--active" : ""}" data-version="90s">90s</button>
        </div>
        <p class="spoken-section__hook spoken-intro__hook">${formatInlineText(extractHook(getIntroText()))}</p>
        <button class="spoken-reveal btn btn-secondary">Reveal full answer</button>
        <div class="spoken-full hidden spoken-intro__full">${formatInlineText(getIntroText())}</div>
        <div class="spoken-actions">
          <button class="spoken-copy btn btn-ghost spoken-intro__copy" data-text="${escapeHtml(getIntroText())}">Copy</button>
          ${(() => {
            const introRehCount = parseInt(safeLocalStorageGet(getRehearsalKey(job.id, "intro")) || "0", 10);
            return `<button class="spoken-rehearsed btn btn-ghost" data-key="${escapeHtml(getRehearsalKey(job.id, "intro"))}" data-count="${introRehCount}">${introRehCount > 0 ? `Rehearsed ${introRehCount}&times;` : "Mark rehearsed"}</button>`;
          })()}
        </div>
      </div>
      ${job.spoken_why_role ? spokenSection("Why this role?", job.spoken_why_role, "why-role") : ""}
      ${job.spoken_working_style ? spokenSection("How do you work with teams?", job.spoken_working_style, "working-style") : ""}
      ${stories.length ? `<h2 class="spoken-heading">Stories</h2>${storiesHtml}` : ""}
      ${questionsHtml}
    </div>
  `;

  // 60s/90s toggle
  container.querySelectorAll(".spoken-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      introVersion = btn.dataset.version;
      container.querySelectorAll(".spoken-toggle").forEach((b) =>
        b.classList.toggle("spoken-toggle--active", b.dataset.version === introVersion)
      );
      const newText = getIntroText();
      const hookEl = container.querySelector(".spoken-intro__hook");
      const fullEl = container.querySelector(".spoken-intro__full");
      const copyBtn = container.querySelector(".spoken-intro__copy");
      const revealBtn = container.querySelector(".spoken-section.spoken-intro .spoken-reveal");
      if (hookEl) hookEl.innerHTML = formatInlineText(extractHook(newText));
      if (fullEl) { fullEl.innerHTML = formatInlineText(newText); fullEl.classList.add("hidden"); }
      if (revealBtn) revealBtn.classList.remove("hidden");
      if (copyBtn) copyBtn.dataset.text = newText;
    });
  });

  // Reveal buttons
  container.querySelectorAll(".spoken-reveal").forEach((btn) => {
    btn.addEventListener("click", () => {
      const section = btn.closest(".spoken-section");
      const fullEl = section && section.querySelector(".spoken-full");
      if (fullEl) {
        fullEl.classList.remove("hidden");
        btn.classList.add("hidden");
      }
    });
  });

  // Copy buttons
  container.querySelectorAll(".spoken-copy").forEach((btn) => {
    btn.addEventListener("click", () => {
      copyToClipboard(btn.dataset.text || "");
      showToast("Copied");
    });
  });

  // Rehearsed buttons
  container.querySelectorAll(".spoken-rehearsed").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.key;
      const newCount = (parseInt(btn.dataset.count || "0", 10) + 1);
      safeLocalStorageSet(key, String(newCount));
      btn.dataset.count = String(newCount);
      btn.innerHTML = `Rehearsed ${newCount}&times;`;
    });
  });
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
  ]
    .filter(Boolean)
    .join("");

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

const ratingLabel = (rating) => {
  const map = { strong: "Strong", adequate: "Adequate", weak: "Weak", missed: "Missed" };
  return map[rating] || "Adequate";
};

const renderDebrief = (container, job) => {
  // State C — analysis exists (non-empty questions array)
  if (Array.isArray(job.debrief_questions) && job.debrief_questions.length > 0) {
    const strengths = Array.isArray(job.debrief_strengths) ? job.debrief_strengths : [];
    const focus = Array.isArray(job.debrief_round2_focus) ? job.debrief_round2_focus : [];
    const watchOuts = Array.isArray(job.debrief_watch_outs) ? job.debrief_watch_outs : [];

    const toList = (items) =>
      items.map((s) => `<li>${escapeHtml(s)}</li>`).join("");

    const questionCards = job.debrief_questions
      .map((q, i) => {
        const rating = q.rating || "adequate";
        return `
          <div class="debrief-card">
            <div class="debrief-card__header">
              <span class="debrief-rating debrief-rating--${escapeHtml(rating)}">${ratingLabel(rating)}</span>
              <div class="debrief-card__question">${escapeHtml(q.question || "")}</div>
            </div>
            <p class="debrief-card__summary">${formatInlineText(q.your_answer_summary || "")}</p>
            <button class="spoken-reveal btn btn-secondary">See improved answer ▼</button>
            <div class="spoken-full hidden debrief-improved-wrap">
              <div class="debrief-improved">${formatInlineText(q.improved_answer || "")}</div>
              <div class="debrief-why-better">${escapeHtml(q.why_better || "")}</div>
            </div>
          </div>
        `;
      })
      .join("");

    container.innerHTML = `
      <div class="debrief-results">
        <div class="debrief-summary-grid">
          ${strengths.length ? `<div class="debrief-strengths"><h4>What landed well</h4><ul>${toList(strengths)}</ul></div>` : ""}
          ${focus.length ? `<div class="debrief-focus"><h4>Round 2 focus</h4><ul>${toList(focus)}</ul></div>` : ""}
          ${watchOuts.length ? `<div class="debrief-watchouts"><h4>Watch outs</h4><ul>${toList(watchOuts)}</ul></div>` : ""}
        </div>
        <p class="debrief-questions-heading">Questions asked (${job.debrief_questions.length})</p>
        ${questionCards}
        <div class="debrief-reanalyse-row">
          <button class="btn btn-secondary debrief-reanalyse-btn">Re-analyse with new transcript</button>
        </div>
      </div>
    `;

    container.querySelectorAll(".spoken-reveal").forEach((btn) => {
      btn.addEventListener("click", () => {
        const card = btn.closest(".debrief-card");
        const fullEl = card && card.querySelector(".spoken-full");
        if (fullEl) {
          fullEl.classList.remove("hidden");
          btn.classList.add("hidden");
        }
      });
    });

    const reanalyseBtn = container.querySelector(".debrief-reanalyse-btn");
    if (reanalyseBtn) {
      reanalyseBtn.addEventListener("click", () => {
        const savedTranscript = job.debrief_transcript || "";
        renderDebriefInputState(container, job, savedTranscript);
      });
    }
    return;
  }

  // State B — transcript saved but analysis did not complete or returned empty (e.g. GPT error, page refresh mid-flight)
  if (job.debrief_transcript) {
    container.innerHTML = `
      <div class="debrief-empty">
        <p>Transcript saved, but the analysis did not complete. Click Re-analyse to retry.</p>
        <button class="btn btn-secondary debrief-reanalyse-btn">Re-analyse</button>
      </div>
    `;
    const btn = container.querySelector(".debrief-reanalyse-btn");
    if (btn) {
      btn.addEventListener("click", () => {
        renderDebriefInputState(container, job, job.debrief_transcript || "");
      });
    }
    return;
  }

  // State A — no transcript yet
  renderDebriefInputState(container, job, "");
};

const renderDebriefInputState = (container, job, prefillTranscript) => {
  container.innerHTML = `
    <div class="debrief-empty">
      <p>Paste the transcript to get question-by-question feedback, stronger spoken answers and specific round-two prep.</p>
      <textarea class="debrief-textarea" rows="12" placeholder="Paste the full interview transcript here…">${escapeHtml(prefillTranscript)}</textarea>
      <button class="btn btn-primary debrief-analyse-btn" data-job-id="${escapeHtml(job.id)}">Analyse interview</button>
    </div>
  `;

  const btn = container.querySelector(".debrief-analyse-btn");
  const textarea = container.querySelector(".debrief-textarea");
  if (btn) {
    btn.addEventListener("click", async () => {
      const transcript = (textarea && textarea.value.trim()) || "";
      if (!transcript) {
        showToast("Please paste a transcript first.");
        return;
      }
      btn.textContent = "Analysing…";
      btn.disabled = true;
      try {
        const res = await fetch("/.netlify/functions/generate-prep-from-transcript", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: job.id, transcript }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Analysis failed");
        const liveJob = state.jobs.find((j) => j.id === job.id) || job;
        liveJob.debrief_transcript = transcript;
        liveJob.debrief_questions = data.debrief_questions || [];
        liveJob.debrief_round2_focus = data.debrief_round2_focus || [];
        liveJob.debrief_watch_outs = data.debrief_watch_outs || [];
        liveJob.debrief_strengths = data.debrief_strengths || [];
        liveJob.debrief_analyzed_at = data.debrief_analyzed_at || "";
        state.activePrepJob = liveJob;
        showToast("Debrief complete");
        renderDebrief(container, liveJob);
      } catch (err) {
        showToast("Analysis failed: " + err.message);
        btn.textContent = "Analyse interview";
        btn.disabled = false;
      }
    });
  }
};

export const switchPrepTab = (tabName) => {
  const job = state.activePrepJob;
  if (!job || !prepOverlayContent) return;

  if (tabName !== "review") cleanupInterviewReview();

  document.querySelectorAll(".prep-tab").forEach((btn) => {
    btn.classList.toggle("prep-tab--active", btn.dataset.prepTab === tabName);
  });

  if (tabName === "cheatsheet") {
    renderCheatSheet(prepOverlayContent, job);
  } else if (tabName === "spoken") {
    renderSpokenAnswers(prepOverlayContent, job);
  } else if (tabName === "review") {
    renderInterviewReview(prepOverlayContent, job);
  } else if (tabName === "debrief") {
    renderDebrief(prepOverlayContent, job);
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
