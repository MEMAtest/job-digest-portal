/* Podcasts tab — Blinkist-style 2-minute summaries of curated product podcasts.
   Mirrors the Learn-tab card+slide-viewer pattern in app.learn.js. */

import { PODCAST_DIGESTS } from "./app.podcasts.data.js";

const podcastState = {
  activeId: null,
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const escape = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const getContainer = () => document.getElementById("podcasts-content");

const getDigests = () =>
  Array.isArray(PODCAST_DIGESTS) ? PODCAST_DIGESTS : [];

const getById = (id) => getDigests().find((d) => d.episode_number === id);

const groupByShow = (digests) => {
  const groups = new Map();
  digests.forEach((d) => {
    const show = d.show || "Lenny's Podcast";
    if (!groups.has(show)) groups.set(show, []);
    groups.get(show).push(d);
  });
  return Array.from(groups.entries()).map(([show, items]) => ({
    show,
    items: items
      .slice()
      .sort((a, b) => (b.published || "").localeCompare(a.published || "")),
  }));
};

const renderCard = (digest) => {
  const headline = digest.summary?.headline || digest.title || "Untitled";
  const tags = (digest.summary?.framework_tags || []).slice(0, 3).map(
    (t) => `<span class="pod-tag">${escape(t)}</span>`
  ).join("");
  return `
    <button class="pod-card" type="button" data-pod-id="${escape(digest.episode_number)}">
      <span class="pod-card__guest">${escape(digest.guest || "")}</span>
      <span class="pod-card__title">${escape(digest.title || "")}</span>
      <span class="pod-card__headline">${escape(headline)}</span>
      <span class="pod-card__tags">${tags}</span>
      <span class="pod-card__meta">${escape(digest.published || "")} &middot; ${escape(digest.duration || "")}</span>
    </button>
  `;
};

const renderGrid = () => {
  const digests = getDigests();
  if (!digests.length) {
    return `
      <div class="pod-shell">
        <header class="pod-header">
          <h1>Podcasts</h1>
          <p>No podcast summaries yet. Run <code>scripts/job_digest/podcasts/summarise.py</code> to generate.</p>
        </header>
      </div>
    `;
  }
  const sections = groupByShow(digests)
    .map(
      (group) => `
        <section class="pod-section">
          <div class="pod-section__heading">
            <h2>${escape(group.show)}</h2>
            <p>${group.items.length} ${group.items.length === 1 ? "episode" : "episodes"} summarised</p>
          </div>
          <div class="pod-grid">
            ${group.items.map(renderCard).join("")}
          </div>
        </section>
      `
    )
    .join("");
  return `
    <div class="pod-shell">
      <header class="pod-header">
        <h1>Podcasts</h1>
        <p>Two-minute structured takes on curated product-podcast episodes, with a CV-grounded "apply to your prep" line on each.</p>
      </header>
      ${sections}
    </div>
  `;
};

const renderViewer = (digest) => {
  const s = digest.summary || {};
  const listenLinks = [
    digest.youtube_url && `<a class="pod-listen" href="${escape(digest.youtube_url)}" target="_blank" rel="noopener">YouTube</a>`,
    digest.spotify_url && `<a class="pod-listen" href="${escape(digest.spotify_url)}" target="_blank" rel="noopener">Spotify</a>`,
    digest.apple_url && `<a class="pod-listen" href="${escape(digest.apple_url)}" target="_blank" rel="noopener">Apple</a>`,
  ].filter(Boolean).join(" ");
  const takeaways = (s.key_takeaways || []).map((t) => `<li>${escape(t)}</li>`).join("");
  const useCases = (s.use_cases || []).map((t) => `<li>${escape(t)}</li>`).join("");
  const tags = (s.framework_tags || []).map((t) => `<span class="pod-tag">${escape(t)}</span>`).join(" ");
  return `
    <div class="pod-shell pod-viewer">
      <div class="pod-viewer__top">
        <button class="pod-back" type="button" data-pod-action="back">&larr; Back to library</button>
        <div class="pod-viewer__meta">
          <div class="pod-viewer__show">${escape(digest.show || "")}</div>
          <h1>${escape(digest.title || "")}</h1>
          <div class="pod-viewer__sub">${escape(digest.guest || "")} &middot; ${escape(digest.published || "")} &middot; ${escape(digest.duration || "")}</div>
          ${listenLinks ? `<div class="pod-viewer__links">${listenLinks}</div>` : ""}
        </div>
      </div>

      <article class="pod-article">
        <div class="pod-article__headline">${escape(s.headline || "")}</div>

        <section class="pod-article__section">
          <h2>Key product takeaways</h2>
          <ul>${takeaways}</ul>
        </section>

        <section class="pod-article__section">
          <h2>Interesting use cases</h2>
          <ul>${useCases}</ul>
        </section>

        <section class="pod-article__section pod-article__apply">
          <h2>Apply to your prep</h2>
          <p>${escape(s.apply_to_prep || "")}</p>
        </section>

        ${tags ? `<section class="pod-article__tags">${tags}</section>` : ""}
      </article>
    </div>
  `;
};

const render = () => {
  const container = getContainer();
  if (!container) return;
  if (!podcastState.activeId) {
    container.innerHTML = renderGrid();
    return;
  }
  const digest = getById(podcastState.activeId);
  if (!digest) {
    podcastState.activeId = null;
    container.innerHTML = renderGrid();
    return;
  }
  container.innerHTML = renderViewer(digest);
};

const openDigest = (id) => {
  if (!getById(id)) return;
  podcastState.activeId = id;
  render();
};

const closeDigest = () => {
  podcastState.activeId = null;
  render();
};

const bindEvents = () => {
  const container = getContainer();
  if (!container || container.dataset.podBound === "true") return;
  container.addEventListener("click", (event) => {
    const card = event.target.closest("[data-pod-id]");
    if (card) {
      openDigest(card.dataset.podId);
      return;
    }
    const action = event.target.closest("[data-pod-action]");
    if (action?.dataset.podAction === "back") {
      closeDigest();
    }
  });
  container.dataset.podBound = "true";
};

const initializePodcasts = () => {
  if (!getContainer()) return;
  bindEvents();
  render();
};

initializePodcasts();
