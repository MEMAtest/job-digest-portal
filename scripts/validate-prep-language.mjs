import { createRequire } from "module";

const require = createRequire(import.meta.url);
const {
  validateSpokenPayload,
  validateDebriefPayload,
  validateInterviewAnalysisPayload,
} = require("../netlify/functions/_prep_language_validator.js");

const context = {
  jobRole: "Head of Fraud Operations",
  jobCompany: "Lendable",
};

const goodSpoken = {
  spoken_intro_60s:
    "Most of my work has been in onboarding, screening and financial crime product change across regulated fintech and banking environments. At Vistra and Ebury, I worked on the operating decisions that sit behind good client journeys, from KYC and screening through to workflow design, migrations and control changes. What that means in practice is taking messy compliance processes, turning them into clear product and operating outcomes, and making sure the teams using them can actually move faster without weakening control. That mix of product thinking, delivery detail and regulated execution is the thread through my background.",
  spoken_intro_90s:
    "Most of my background sits where product, onboarding and financial crime controls meet. Over the last few years, I have worked on KYC, screening, onboarding and workflow design across firms like Vistra and Ebury, usually in situations where the process was too manual, the tooling was fragmented or the control environment needed to improve. The role I tend to play is turning that into something operationally usable: clearer journeys, better routing, stronger integrations and more sensible governance around what the teams are actually doing day to day. I have worked closely with operations, compliance, technology and vendors, so I am comfortable moving between the detail of a platform change and the wider operating model it needs to support. The common thread is regulated delivery that improves both the client journey and the quality of control.",
  spoken_why_role:
    "This role makes sense for me because it sits right in the space where I have done my strongest work: financial crime operations, control design and product change. Lendable is clearly dealing with scale, speed and control at the same time, and that is the kind of environment I know well. What interests me is the chance to shape how fraud operations actually works in practice, not just review it from the side. That blend of operational ownership, decision quality and product thinking is a very good fit with the work I have been doing.",
  spoken_working_style:
    "I work best when the problem is clear, the decision owner is clear and the team is honest about the constraints. In practice, that means I spend time early on aligning operations, compliance and product on what good looks like, where the friction is and which trade-offs are real. From there I like to break the work into something teams can actually deliver, while keeping the end-to-end outcome visible. People usually find me calm, direct and useful in complex environments because I do not overcomplicate the problem, but I also do not lose the detail that matters.",
  spoken_stories: [
    {
      title: "Ebury screening tuning",
      hook: "At Ebury, I worked on screening changes where the core issue was alert quality rather than just alert volume.",
      full: "At Ebury, I worked on screening changes where the core issue was alert quality rather than just alert volume. The team was spending too much time on false positives, which slowed case handling and pulled attention away from higher-value work. I worked across product, compliance and operational stakeholders to review the thresholds, understand where the noise was coming from and tighten the logic without weakening control. That meant being precise about what needed to change, testing it properly and making sure the operational teams trusted the new setup. The outcome was a cleaner flow for analysts, better use of capacity and a material reduction in false positives without losing the control intent behind the screening process.",
    },
    {
      title: "Vistra onboarding flow",
      hook: "One of the biggest pieces of work at Vistra was reducing friction in the onboarding journey without weakening KYC control.",
      full: "One of the biggest pieces of work at Vistra was reducing friction in the onboarding journey without weakening KYC control. The process had too many hand-offs, too much duplication and too little visibility on where cases were really getting stuck. I worked on the journey design, the routing logic and the operational changes needed to make the workflow more usable for the teams running it. That included getting the right stakeholders aligned on what should be automated, what still needed judgement and where the platform had to support better data capture. The result was a faster onboarding process, clearer ownership across the workflow and a setup that was easier to manage at scale.",
    },
    {
      title: "Cross-functional delivery",
      hook: "A lot of my work has involved sitting between product, operations and compliance when priorities were pulling in different directions.",
      full: "A lot of my work has involved sitting between product, operations and compliance when priorities were pulling in different directions. In those situations, the risk is that each team optimises for its own objective and the overall process gets worse. My approach is usually to get very clear on the outcome, the points of friction and the decision that actually needs to be made. From there I translate the problem into something each function can work with, whether that is a process change, a workflow rule or a delivery sequence. That tends to reduce noise in the discussion and move the team towards practical decisions that improve both execution and control.",
    },
  ],
  power_questions: [
    "Where does fraud ops friction hurt decision quality most today?",
    "Which fraud controls are hardest to scale without slowing customers down?",
    "How do product and operations currently decide what to change first?",
    "What would strong performance in this role look like after six months?",
    "Which parts of the fraud workflow need clearer ownership right now?",
  ],
};

const badSpoken = {
  spoken_intro_60s:
    "Results-driven product leader with extensive experience in financial services. I am a dynamic professional with over ten years of experience and a proven track record of leveraging strategic thinking to drive business growth.",
  spoken_intro_90s:
    "Results-driven product leader with extensive experience in financial services. I am a dynamic professional with over ten years of experience and a proven track record of leveraging strategic thinking to drive business growth. Furthermore, I spearheaded transformative initiatives and utilised best practice frameworks to deliver excellence.",
  spoken_why_role:
    "I am passionate about this opportunity and I have a strong understanding of the market. With over a decade of experience, I would be a strong fit.",
  spoken_working_style:
    "I am collaborative; furthermore, I leverage stakeholder management to deliver impact; subsequently, I drive alignment.",
  spoken_stories: [
    {
      title: "Bad story",
      hook: "I am a strong leader.",
      full: "Situation: there was a challenge. Task: I needed to fix it. Action: I leveraged stakeholders. Result: it was successful.",
    },
  ],
  power_questions: ["What does success look like", "How big is the team", "What are the challenges"],
};

const goodDebrief = {
  debrief_questions: [
    {
      question: "Tell me about your background",
      rating: "adequate",
      your_answer_summary: "You gave a fair overview of your background, but you spent too long on chronology and not enough on the thread that connects your experience.",
      improved_answer:
        "Most of my work has been in onboarding, screening and financial crime product change across regulated environments. The common thread is improving how control-heavy processes actually work in practice, whether that is client onboarding, screening logic or the workflow that sits behind those decisions. I tend to work where product, operations and compliance need to line up around a better outcome, and that is the part of the role that fits me best.",
      why_better: "It gets to your core relevance quickly and sounds more like a spoken answer.",
    },
  ],
  debrief_round2_focus: [
    "Tighten your opening answer so the core thread lands in the first 20 seconds.",
    "Use one concrete fraud or screening example earlier in the conversation.",
    "Be more explicit about what you personally decided or changed.",
  ],
  debrief_watch_outs: [
    "Do not drift into chronology before making the relevance clear.",
    "Keep each answer tighter once the point has landed.",
  ],
  debrief_strengths: [
    "You sounded credible when discussing control-heavy delivery.",
    "Your stakeholder examples were practical rather than theoretical.",
  ],
};

const goodAnalysis = {
  overall_score: 7.8,
  overall_verdict:
    "This was a credible interview with clear evidence of regulated product and operational delivery. The main gap was not capability but answer shape: the strongest evidence often landed too late, so the interview did not consistently hear the sharpest version of your fit.\n\nThat is fixable before the next round. You need tighter openings, earlier ownership language and one or two cleaner outcome examples.",
  dimension_scores: [
    { dimension: "Domain knowledge", score: 8.2, note: "You showed solid understanding of onboarding, screening and control-heavy delivery." },
    { dimension: "Structured answers (STAR)", score: 6.9, note: "Several answers had the right substance but reached the result too slowly." },
  ],
  strengths: [
    "You were strongest when describing operational change in regulated workflows.",
    "Your answers showed credible cross-functional work with product, operations and compliance.",
    "You did not sound theoretical when discussing control trade-offs.",
  ],
  gaps: [
    "You sometimes buried the most relevant point too deep in the answer.",
    "Ownership language was not always explicit enough.",
    "Outcome statements could have landed earlier and more cleanly.",
  ],
  intelligence_gathered: [
    {
      signal: "The team is balancing growth pressure with a stricter control environment.",
      implication: "Prepare a tighter example that shows speed and control improving together.",
    },
  ],
  next_round_prep: [
    "Rewrite your opening answer so the core relevance lands in the first two sentences.",
    "Prepare one fraud-focused story and one onboarding-control story with cleaner outcomes.",
    "Answer ownership questions with more direct first-person language.",
    "Have one strong question ready on workflow bottlenecks in fraud operations.",
  ],
  core_gap_summary: "Your evidence is strong enough, but you need tighter spoken structure so the best points land earlier.",
};

const spokenGoodResult = validateSpokenPayload(goodSpoken, context);
const spokenBadResult = validateSpokenPayload(badSpoken, context);
const debriefResult = validateDebriefPayload(goodDebrief, context);
const analysisResult = validateInterviewAnalysisPayload(goodAnalysis, context);

const failures = [];

if (spokenGoodResult.decision !== "accept") {
  failures.push(`Expected good spoken payload to pass, got ${spokenGoodResult.decision}.`);
}
if (spokenBadResult.decision === "accept") {
  failures.push("Expected bad spoken payload to fail or retry, but it passed.");
}
if (debriefResult.decision === "fallback") {
  failures.push("Expected good debrief payload to be usable.");
}
if (analysisResult.decision === "fallback") {
  failures.push("Expected good interview analysis payload to be usable.");
}

if (failures.length) {
  console.error("Prep language validation failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Prep language validation passed.");
console.log(JSON.stringify({
  spokenGood: spokenGoodResult.decision,
  spokenBad: spokenBadResult.decision,
  debrief: debriefResult.decision,
  analysis: analysisResult.decision,
}, null, 2));
