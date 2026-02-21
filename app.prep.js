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

export const switchPrepTab = (tabName) => {
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
