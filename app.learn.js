const CATEGORY_META = {
  platforms: {
    title: "Your Platforms",
    subtitle: "Systems, orchestration and integration patterns you have already delivered.",
    badge: "Platforms",
  },
  domains: {
    title: "Your Domains",
    subtitle: "The regulated workflows, controls and operating questions you keep returning to.",
    badge: "Domains",
  },
  pm_craft: {
    title: "PM Craft",
    subtitle: "How you frame problems, sequence delivery and get execution through governance.",
    badge: "PM Craft",
  },
};

const learnState = {
  activeGuideId: null,
  activeSlideIndex: 0,
};

const paragraphs = (...items) => items.map((item) => `<p>${item}</p>`).join("");

const diagramBox = (label, tone = "") => {
  const toneClass = tone ? ` diagram-box--${tone}` : "";
  return `<div class="diagram-box${toneClass}">${label}</div>`;
};

const flowDiagram = (items, options = {}) => {
  const { caption = "", direction = "row", tones = [] } = options;
  const layoutClass = direction === "col" ? "diagram-col" : "diagram-row";
  const content = items
    .map((item, index) => {
      const box = diagramBox(item, tones[index] || "");
      const arrow = index < items.length - 1 ? '<div class="diagram-arrow">-&gt;</div>' : "";
      return `${box}${arrow}`;
    })
    .join("");

  return `
    <div class="diagram">
      <div class="${layoutClass}">${content}</div>
      ${caption ? `<div class="diagram-caption">${caption}</div>` : ""}
    </div>
  `;
};

const funnelDiagram = (steps, caption = "") => `
  <div class="diagram">
    <div class="diagram-funnel">
      ${steps.map((step) => `<div class="diagram-funnel-step">${step}</div>`).join("")}
    </div>
    ${caption ? `<div class="diagram-caption">${caption}</div>` : ""}
  </div>
`;

const phaseDiagram = (phases, caption = "") => `
  <div class="diagram">
    <div class="diagram-row">
      ${phases
        .map((phase, index) => `
          <div class="diagram-phase">
            <div class="diagram-phase__step">Phase ${index + 1}</div>
            <div class="diagram-phase__title">${phase}</div>
          </div>
        `)
        .join("")}
    </div>
    ${caption ? `<div class="diagram-caption">${caption}</div>` : ""}
  </div>
`;

const metricDiagram = (value, label, caption = "", tone = "success") => `
  <div class="diagram">
    <div class="diagram-metric diagram-metric--${tone}">
      <div class="diagram-metric__value">${value}</div>
      <div class="diagram-metric__label">${label}</div>
    </div>
    ${caption ? `<div class="diagram-caption">${caption}</div>` : ""}
  </div>
`;

const compareDiagram = ({ beforeTitle, beforeItems, afterTitle, afterItems, caption = "" }) => `
  <div class="diagram">
    <div class="diagram-compare">
      <div class="diagram-compare__col">
        <h4>${beforeTitle}</h4>
        ${beforeItems.map((item) => `<div class="diagram-box diagram-box--warning">${item}</div>`).join("")}
      </div>
      <div class="diagram-compare__col">
        <h4>${afterTitle}</h4>
        ${afterItems.map((item) => `<div class="diagram-box diagram-box--success">${item}</div>`).join("")}
      </div>
    </div>
    ${caption ? `<div class="diagram-caption">${caption}</div>` : ""}
  </div>
`;

const matrixDiagram = (columns, caption = "") => `
  <div class="diagram">
    <div class="diagram-compare">
      ${columns
        .map(
          (column) => `
            <div class="diagram-compare__col">
              <h4>${column.title}</h4>
              ${column.items.map((item) => `<div class="diagram-box">${item}</div>`).join("")}
            </div>
          `,
        )
        .join("")}
    </div>
    ${caption ? `<div class="diagram-caption">${caption}</div>` : ""}
  </div>
`;

const LEARN_GUIDES = [
  {
    id: "fenergo-clm",
    title: "Fenergo CLM",
    icon: "🧩",
    category: "platforms",
    blurb: "How CLM captured entity data, risk decisions and approval routing in one controlled flow.",
    slides: [
      {
        title: "What Fenergo did in the stack",
        visual: flowDiagram(["Front-door intake", "Fenergo CLM", "Risk and approval routing", "Case completion"], {
          caption: "Fenergo becomes the system of record for onboarding progression.",
          tones: ["primary", "primary", "warning", "success"],
        }),
        explanation: paragraphs(
          "Fenergo mattered because it pulled fragmented onboarding steps into one auditable workflow. Instead of collecting core data in one place, approvals in another and exceptions in email, the platform gave one operating spine.",
          "That matters for product leadership because process design, role permissions, policy rules and MI all sit on top of that system choice.",
        ),
      },
      {
        title: "Journey design across entity and service capture",
        visual: funnelDiagram([
          "Entity and ownership data",
          "Products and jurisdictions in scope",
          "Document and evidence capture",
          "Risk triggers and control questions",
        ], "Each stage narrows uncertainty before the case can progress."),
        explanation: paragraphs(
          "The core design problem is not just data collection. It is sequencing the right questions so the client experience stays clean while compliance gets what it needs at the correct point in the journey.",
          "Good CLM design therefore combines UX, rules and operational handoff design rather than treating onboarding as a static form.",
        ),
      },
      {
        title: "Risk assessment and approval routing",
        visual: flowDiagram(["CDD baseline", "Risk scoring", "EDD trigger", "Approver queue", "Decision outcome"], {
          caption: "Control logic sits inside the case rather than outside it.",
          tones: ["", "warning", "warning", "primary", "success"],
        }),
        explanation: paragraphs(
          "A strong CLM implementation embeds risk logic directly into the case lifecycle. That means high-risk triggers, missing evidence and jurisdiction-specific controls can create the right review queue automatically.",
          "The product challenge is to preserve control quality without forcing every case through the slowest path.",
        ),
      },
      {
        title: "Integration and data mapping",
        visual: matrixDiagram(
          [
            { title: "Inputs", items: ["CRM / channel data", "KYC evidence", "Reference data"] },
            { title: "Fenergo core", items: ["Client record", "Workflow state", "Decision history"] },
            { title: "Outputs", items: ["Ops queues", "MI", "Downstream servicing"] },
          ],
          "The CLM model only works when the data model is explicit and stable.",
        ),
        explanation: paragraphs(
          "Integration work is usually where CLM programmes become expensive. The hard part is not calling an API; it is agreeing what each field means, where the golden record lives and what happens when systems disagree.",
          "That is why product ownership here is partly data governance and partly workflow design.",
        ),
      },
      {
        title: "Go-live and operating ownership",
        visual: phaseDiagram(["Design and build", "UAT and defect burn-down", "Cutover", "Hypercare", "Steady-state governance"], "A CLM go-live is only successful if ownership is clear after release."),
        explanation: paragraphs(
          "The platform is only half the answer. The other half is the operating model after go-live: who tunes rules, who owns backlog, who closes audit actions and who governs changes to journeys and data requirements.",
          "That is where long-term product credibility is built.",
        ),
      },
    ],
  },
  {
    id: "napier-screening",
    title: "Napier Screening",
    icon: "🛡️",
    category: "platforms",
    blurb: "Alert quality, threshold tuning and case flow for sanctions and adverse-media screening.",
    slides: [
      {
        title: "Screening architecture",
        visual: flowDiagram(["Customer data", "Napier rules", "Alert queue", "Analyst review", "Decision log"], {
          caption: "Alert quality depends on both data quality and screening configuration.",
          tones: ["", "primary", "warning", "primary", "success"],
        }),
        explanation: paragraphs(
          "Napier sits between source data and operational review. The system is only as effective as the completeness of names, aliases and jurisdictional attributes entering it.",
          "That makes platform work inseparable from upstream data hygiene.",
        ),
      },
      {
        title: "Threshold tuning model",
        visual: compareDiagram({
          beforeTitle: "Untuned state",
          beforeItems: ["Low precision", "Analyst overload", "Escalations everywhere"],
          afterTitle: "Tuned state",
          afterItems: ["Sharper match bands", "Tiered review", "Cleaner triage"],
          caption: "Tuning is about signal quality, not just lower volume.",
        }),
        explanation: paragraphs(
          "Threshold tuning needs a control mindset. A lower alert count is only useful if true positive coverage remains intact.",
          "That means every threshold decision needs QA evidence and a clear rationale for compliance and audit stakeholders.",
        ),
      },
      {
        title: "QA sampling and case handling",
        visual: funnelDiagram(["Sample population", "Analyst review", "Quality calibration", "Rule adjustment"], "QA creates the feedback loop needed for sustainable tuning."),
        explanation: paragraphs(
          "Screening improvements should never be based on anecdote. Sampling, reason codes and reviewer calibration provide the evidence needed to change rules with confidence.",
          "That is also how product and compliance teams keep trust while iterating.",
        ),
      },
      {
        title: "Operational capacity planning",
        visual: matrixDiagram(
          [
            { title: "Demand drivers", items: ["Customer growth", "Batch refreshes", "New lists"] },
            { title: "Controls", items: ["Threshold bands", "Queues", "Escalation logic"] },
            { title: "Outcomes", items: ["SLA stability", "Lower backlog", "Better analyst focus"] },
          ],
          "The point of tuning is to protect both control effectiveness and human capacity.",
        ),
        explanation: paragraphs(
          "A good screening operating model is not just a technology configuration. It is a capacity system: queue design, staffing assumptions, refresh windows and escalation criteria all matter.",
          "That is why platform and domain understanding need to sit together.",
        ),
      },
    ],
  },
  {
    id: "enate-orchestration",
    title: "Enate Orchestration",
    icon: "🔀",
    category: "platforms",
    blurb: "How orchestration kept onboarding work moving cleanly across queues, teams and systems.",
    slides: [
      {
        title: "Where orchestration fits",
        visual: flowDiagram(["Client request", "Enate workflow", "Specialist task queues", "Completion and handoff"], {
          caption: "Enate coordinates people and systems across the same journey.",
          tones: ["", "primary", "warning", "success"],
        }),
        explanation: paragraphs(
          "Enate is useful when onboarding is no longer a single-team process. It gives you a workflow layer for assigning, sequencing and tracking work across operations teams and dependent systems.",
          "That becomes particularly valuable once cases split into specialist steps like screening, EDD and approval.",
        ),
      },
      {
        title: "Stage handoffs",
        visual: funnelDiagram(["Case intake", "Data validation", "Control checks", "Approvals", "Activation"], "Clear stage ownership prevents silent work-in-progress build-up."),
        explanation: paragraphs(
          "The major orchestration benefit is explicit ownership at each stage. Every handoff becomes visible, measurable and governable rather than implied inside inboxes and side conversations.",
          "That helps both SLA control and root-cause analysis.",
        ),
      },
      {
        title: "Workflow triggers",
        visual: flowDiagram(["Missing data", "Risk trigger", "Return to owner", "Re-entry"], {
          caption: "Trigger logic keeps exception handling systematic rather than ad hoc.",
          direction: "col",
          tones: ["warning", "warning", "primary", "success"],
        }),
        explanation: paragraphs(
          "A mature orchestration layer uses trigger logic for missing information, policy exceptions and escalation thresholds. That keeps exception handling consistent and leaves an audit trail behind each rework loop.",
          "It is also the basis for useful operational MI.",
        ),
      },
      {
        title: "Why orchestration beats fragmented manual flow",
        visual: compareDiagram({
          beforeTitle: "Fragmented flow",
          beforeItems: ["Email chasing", "Hidden blockers", "Weak MI"],
          afterTitle: "Orchestrated flow",
          afterItems: ["Visible queues", "Explicit owners", "Reliable cycle-time data"],
          caption: "Workflow visibility is the main value, not just automation for its own sake.",
        }),
        explanation: paragraphs(
          "Without orchestration, the business sees onboarding only as a case status. With orchestration, you can see exactly where work stalls, what is waiting on whom and what kind of change will reduce lead time.",
          "That is where process ownership becomes practical rather than theoretical.",
        ),
      },
    ],
  },
  {
    id: "salesforce-fenergo-migration",
    title: "Salesforce to Fenergo Migration",
    icon: "🔄",
    category: "platforms",
    blurb: "Legacy-to-target migration design, cutover control and large-scale record migration into CLM.",
    slides: [
      {
        title: "Legacy versus target state",
        visual: compareDiagram({
          beforeTitle: "Legacy Salesforce-centric",
          beforeItems: ["Case fragmentation", "Manual routing", "Weak audit trail"],
          afterTitle: "Target Fenergo-centric",
          afterItems: ["Single case spine", "Embedded controls", "Structured approvals"],
          caption: "The migration was about operating model quality, not just technology replacement.",
        }),
        explanation: paragraphs(
          "Migration programmes fail when they are framed as a replatform only. The real shift is moving from partial workflow visibility to a target model where data, decisions and control evidence live together.",
          "That requires clear articulation of what improves on day one versus what stabilises later.",
        ),
      },
      {
        title: "Migration phases",
        visual: phaseDiagram(["Data assessment", "Field mapping", "Dress rehearsal", "Cutover", "Hypercare"], "Sequence matters because cutover risk is cumulative."),
        explanation: paragraphs(
          "A good migration plan separates design certainty from operational certainty. Mapping can look complete on paper and still fail in cutover if legacy data quality, workflow assumptions and exception volumes are not rehearsed early.",
          "That is why dry runs and fallback criteria matter.",
        ),
      },
      {
        title: "50k records cutover and mapping",
        visual: metricDiagram("50k records", "Mapped and migrated into the target state", "Record migration only works if identifiers, status mapping and document logic stay coherent.", "primary"),
        explanation: paragraphs(
          "The headline number matters because it signals scale, but the harder problem is record interpretation. Each migrated record needs clean status logic, document linkage and an unambiguous future path in the target workflow.",
          "Bad mapping turns scale into hidden debt.",
        ),
      },
      {
        title: "Zero-downtime controls",
        visual: flowDiagram(["Freeze window", "Dual-run checks", "Cutover controls", "Exception desk"], {
          caption: "The business needs service continuity while the control environment changes underneath it.",
          tones: ["warning", "primary", "warning", "success"],
        }),
        explanation: paragraphs(
          "Cutover control is a governance exercise as much as a technical one. You need decision rights, rollback conditions, reconciliations and clear ownership of exceptions during the crossover window.",
          "That keeps migration risk explicit.",
        ),
      },
      {
        title: "Post-migration operating model",
        visual: matrixDiagram(
          [
            { title: "Product", items: ["Backlog", "Tuning", "Journey changes"] },
            { title: "Operations", items: ["Queues", "SLAs", "Defect feedback"] },
            { title: "Governance", items: ["Controls", "Audit evidence", "Change approvals"] },
          ],
          "The migration only pays back if the target-state ownership model is clearer than the old one.",
        ),
        explanation: paragraphs(
          "The post-cutover phase decides whether the programme becomes durable. Once on the new platform, backlog ownership, defect routing and governance routines have to settle quickly or the business experiences the new system as unstable.",
          "That is why post-migration operating design belongs in the original programme scope.",
        ),
      },
    ],
  },
  {
    id: "api-integration-patterns",
    title: "API Integration Patterns",
    icon: "🔌",
    category: "platforms",
    blurb: "The practical patterns behind onboarding APIs, vendor dependencies and operational resilience.",
    slides: [
      {
        title: "Vendor and endpoint landscape",
        visual: matrixDiagram(
          [
            { title: "Core systems", items: ["CLM", "CRM", "Workflow"] },
            { title: "Control vendors", items: ["Screening", "Risk", "Identity"] },
            { title: "Outputs", items: ["Cases", "MI", "Activation"] },
          ],
          "The product problem is coordinating dependencies, not just wiring endpoints together.",
        ),
        explanation: paragraphs(
          "Integration patterns are driven by workflow intent. Each system needs a clear contract: what it owns, what it receives and what it returns into the journey.",
          "That is how you prevent brittle dependencies and duplicated logic.",
        ),
      },
      {
        title: "Payload and field design",
        visual: flowDiagram(["Source payload", "Validation layer", "Canonical model", "Vendor-specific mapping"], {
          caption: "A canonical model reduces rework when platforms or providers change.",
          direction: "col",
          tones: ["", "warning", "primary", "success"],
        }),
        explanation: paragraphs(
          "The most important design choice is usually the canonical model. If every integration maps directly to every other system, change becomes expensive. If the data contract is explicit, platform evolution gets easier.",
          "That is a product architecture decision, not just an engineering concern.",
        ),
      },
      {
        title: "Error handling and retries",
        visual: funnelDiagram(["Primary request", "Validation failure", "Retry or repair", "Exception queue", "Resolution"], "Resilience needs explicit paths for both transient and structural failures."),
        explanation: paragraphs(
          "API work should assume failure. The system needs different responses for timeouts, malformed payloads, upstream outages and policy conflicts. Otherwise operations absorbs the ambiguity manually.",
          "Good error design keeps failures visible and recoverable.",
        ),
      },
      {
        title: "Reporting outputs and dependency management",
        visual: compareDiagram({
          beforeTitle: "Weak integration governance",
          beforeItems: ["Opaque failures", "No owner", "Patchy MI"],
          afterTitle: "Managed integration stack",
          afterItems: ["Named owners", "Error telemetry", "Decision-grade reporting"],
          caption: "Operational resilience depends on named ownership across system boundaries.",
        }),
        explanation: paragraphs(
          "Once multiple platforms contribute to one onboarding flow, dependency management becomes a management problem. It needs service expectations, named owners, monitoring signals and a decision process for defects and vendor changes.",
          "That is how integration patterns stay workable at scale.",
        ),
      },
    ],
  },
  {
    id: "mi-reporting-stack",
    title: "MI and Reporting Stack",
    icon: "📊",
    category: "platforms",
    blurb: "How operational MI supports control decisions, backlog prioritisation and executive visibility.",
    slides: [
      {
        title: "Power BI and Fabric reporting view",
        visual: flowDiagram(["Source systems", "Modelled data layer", "Power BI dashboards", "Executive and ops decisions"], {
          caption: "Useful MI starts with modelled operational definitions, not dashboard styling.",
          tones: ["", "primary", "primary", "success"],
        }),
        explanation: paragraphs(
          "MI becomes powerful when the business trusts the definitions behind it. Lead time, queue age, exception volume and risk outcomes all need stable calculation logic before they can support decision-making.",
          "That is why reporting architecture belongs close to process ownership.",
        ),
      },
      {
        title: "Operational metrics and dashboards",
        visual: matrixDiagram(
          [
            { title: "Flow", items: ["Cycle time", "Stage ageing", "Rework"] },
            { title: "Controls", items: ["EDD rate", "Screening alerts", "Approvals"] },
            { title: "Delivery", items: ["Backlog", "Defects", "Release impact"] },
          ],
          "A useful dashboard ties workflow, control and delivery signals together.",
        ),
        explanation: paragraphs(
          "Dashboards should help answer action-oriented questions: where is work stuck, what changed this week, which controls are driving load and what intervention should happen next.",
          "Reporting that cannot drive an action is usually too abstract.",
        ),
      },
      {
        title: "Regulatory visibility",
        visual: compareDiagram({
          beforeTitle: "Low-visibility state",
          beforeItems: ["Lagging updates", "Manual packs", "Weak traceability"],
          afterTitle: "Visible control state",
          afterItems: ["Evidence-backed metrics", "Drill-down", "Named remediation owners"],
          caption: "Regulatory reporting needs traceability into operational facts.",
        }),
        explanation: paragraphs(
          "For regulated operations, MI is not just internal management tooling. It also needs to support remediation, audit follow-up and regulator-facing confidence that the process is understood and governed.",
          "That changes the standard for data lineage and documentation.",
        ),
      },
      {
        title: "Decision-making loops",
        visual: funnelDiagram(["Observe", "Diagnose", "Prioritise", "Change", "Measure"], "MI is most valuable when it feeds a repeatable governance loop."),
        explanation: paragraphs(
          "The reporting stack becomes durable when it is built into governance rhythm: weekly ops review, monthly steering, remediation tracking and release impact review.",
          "That closes the loop between data, product and operating performance.",
        ),
      },
    ],
  },
  {
    id: "kyc-cdd-edd",
    title: "KYC, CDD and EDD",
    icon: "🪪",
    category: "domains",
    blurb: "The distinctions, triggers and workflow consequences across baseline due diligence and enhanced review.",
    slides: [
      {
        title: "Core distinction",
        visual: matrixDiagram(
          [
            { title: "KYC", items: ["Identity", "Entity facts", "Ownership basics"] },
            { title: "CDD", items: ["Purpose", "Risk profile", "Standard evidence"] },
            { title: "EDD", items: ["Escalated evidence", "Deeper review", "Senior approval"] },
          ],
          "The three labels only help when the workflow consequences are explicit.",
        ),
        explanation: paragraphs(
          "These concepts are often used loosely, but operationally they mean different evidence, different routing and different turnaround expectations. Product design needs those distinctions embedded clearly in the case path.",
          "Otherwise teams improvise and policy intent is lost in execution.",
        ),
      },
      {
        title: "Where EDD escalates",
        visual: funnelDiagram(["Higher-risk jurisdiction", "Complex ownership", "PEP or sanctions linkage", "EDD review"], "EDD should trigger from clear, explainable conditions."),
        explanation: paragraphs(
          "EDD is not a generic backlog bucket. It should be driven by explainable triggers tied to policy, risk appetite and jurisdiction-specific expectations.",
          "That makes it possible to tune capacity and still defend the control framework.",
        ),
      },
      {
        title: "Platform and workflow implications",
        visual: flowDiagram(["Standard journey", "Risk trigger", "EDD branch", "Approval gate", "Back to main flow"], {
          caption: "Domain logic becomes real when the case path changes automatically.",
          tones: ["", "warning", "warning", "primary", "success"],
        }),
        explanation: paragraphs(
          "Product ownership here means deciding how the workflow branches, what data is re-used, what evidence becomes mandatory and what approvals are needed before the case can return to the main path.",
          "That is where domain knowledge becomes design value.",
        ),
      },
      {
        title: "Jurisdiction-specific decisioning",
        visual: compareDiagram({
          beforeTitle: "One-size-fits-all",
          beforeItems: ["Over-collection", "Slow reviews", "Weak local fit"],
          afterTitle: "Jurisdiction-aware",
          afterItems: ["Targeted evidence", "Cleaner routing", "Defensible controls"],
          caption: "Global onboarding only works when local requirements can be handled without chaos.",
        }),
        explanation: paragraphs(
          "Global products need a rule model that supports local nuance without fragmenting the user experience. Jurisdiction-aware logic helps preserve both efficiency and compliance credibility.",
          "That balance is one of the hardest design problems in regulated onboarding.",
        ),
      },
    ],
  },
  {
    id: "client-onboarding",
    title: "Client Onboarding",
    icon: "🚪",
    category: "domains",
    blurb: "The journey from initial request to activation, including friction points, handoffs and control stages.",
    slides: [
      {
        title: "End-to-end onboarding journey",
        visual: flowDiagram(["Initial intake", "Data and document collection", "Control checks", "Approvals", "Activation"], {
          caption: "The customer experiences one journey even when five teams are involved behind the scenes.",
          tones: ["", "primary", "warning", "primary", "success"],
        }),
        explanation: paragraphs(
          "Client onboarding looks simple from the outside, but inside it spans operations, compliance, product, platform and relationship teams. The design task is to make those handoffs coherent and visible.",
          "That is what turns a procedure into an operating system.",
        ),
      },
      {
        title: "Drop-off and friction points",
        visual: funnelDiagram(["Application start", "Missing data", "Document loops", "Approval waiting", "Completed onboarding"], "Lead time expands where the workflow asks for too much too late or too often."),
        explanation: paragraphs(
          "Most onboarding friction comes from rework loops, unclear requests and poorly sequenced evidence capture. Those issues are usually design issues rather than simple execution failures.",
          "That is why process metrics and user feedback both matter.",
        ),
      },
      {
        title: "Team and platform handoffs",
        visual: matrixDiagram(
          [
            { title: "Commercial", items: ["Request context", "Client expectation"] },
            { title: "Operations", items: ["Case handling", "Document checks"] },
            { title: "Compliance", items: ["Risk review", "Approvals"] },
          ],
          "Handoffs fail when ownership is implied instead of designed.",
        ),
        explanation: paragraphs(
          "Every handoff needs a clear trigger, owner and done condition. Without that, the business sees delay but cannot identify the real bottleneck.",
          "Product design should make the handoff logic explicit, measurable and improvable.",
        ),
      },
      {
        title: "Outcome design",
        visual: compareDiagram({
          beforeTitle: "Poor onboarding outcome",
          beforeItems: ["Slow activation", "High rework", "Unclear status"],
          afterTitle: "Good onboarding outcome",
          afterItems: ["Predictable path", "Controlled decisions", "Clear client comms"],
          caption: "A good onboarding product reduces ambiguity for both the client and the internal teams.",
        }),
        explanation: paragraphs(
          "The right outcome is not just faster onboarding. It is an onboarding experience that is predictable, controlled and operationally intelligible.",
          "That is the difference between a busy process and a scalable one.",
        ),
      },
    ],
  },
  {
    id: "false-positive-reduction",
    title: "False Positive Reduction",
    icon: "🎯",
    category: "domains",
    blurb: "How threshold analysis and QA reduce screening noise without weakening the control set.",
    slides: [
      {
        title: "False-positive anatomy",
        visual: funnelDiagram(["Broad matching", "Alert flood", "Low-value review", "Analyst fatigue"], "Most false-positive pain starts in data quality and rule tuning, not analyst effort."),
        explanation: paragraphs(
          "False positives create cost, but the deeper problem is that they bury genuine risk signals inside operational noise. A reduction programme therefore has to improve alert quality without weakening the protection intent.",
          "That is why tuning needs evidence and control discipline.",
        ),
      },
      {
        title: "Threshold band analysis",
        visual: compareDiagram({
          beforeTitle: "Flat thresholding",
          beforeItems: ["One-size review", "Weak prioritisation", "Backlog build-up"],
          afterTitle: "Band-based thresholding",
          afterItems: ["Tiered review", "Smarter escalation", "Clearer triage"],
          caption: "Banding lets the operation focus effort where risk signal is stronger.",
        }),
        explanation: paragraphs(
          "Threshold bands make the alert population more manageable. They help separate low-confidence noise from alerts that justify closer attention, while preserving a defensible audit trail for why thresholds were changed.",
          "That improves both workflow and governance quality.",
        ),
      },
      {
        title: "Ebury reduction result",
        visual: metricDiagram("38%", "False-positive reduction at Ebury", "The point was not a lower alert count alone; it was better analyst capacity with control coverage intact.", "success"),
        explanation: paragraphs(
          "The Ebury result matters because it shows that quality improvements can be material without weakening the control position. The work combined threshold review, sampling evidence and operational design rather than blunt suppression.",
          "That is the standard regulators and compliance leaders can accept.",
        ),
      },
      {
        title: "Control preservation and QA",
        visual: flowDiagram(["Sample design", "Analyst calibration", "Rule change", "QA confirmation"], {
          caption: "Reduction is only credible if the operating evidence still supports the control story.",
          direction: "col",
          tones: ["primary", "", "warning", "success"],
        }),
        explanation: paragraphs(
          "Every reduction initiative needs a structured QA loop. Without that, the organisation cannot show that it improved quality rather than simply lowering operational pressure.",
          "That is why metric improvement and control evidence need to travel together.",
        ),
      },
      {
        title: "Why this mattered operationally",
        visual: matrixDiagram(
          [
            { title: "Analysts", items: ["Cleaner queue", "Better focus"] },
            { title: "Management", items: ["Lower backlog risk", "More confidence in MI"] },
            { title: "Controls", items: ["Defensible tuning", "Preserved coverage"] },
          ],
          "A good false-positive programme improves both capacity and confidence.",
        ),
        explanation: paragraphs(
          "The best outcome is not just faster case handling. It is an operation where capacity, alert quality and control rationale all improve together.",
          "That is why false-positive reduction is a product and operating-model problem, not just a tuning exercise.",
        ),
      },
    ],
  },
  {
    id: "edd-automation",
    title: "EDD Automation",
    icon: "⚙️",
    category: "domains",
    blurb: "Triggering, routing and automating the repeatable parts of enhanced due diligence without losing judgement.",
    slides: [
      {
        title: "Manual versus automated EDD flow",
        visual: compareDiagram({
          beforeTitle: "Manual-heavy EDD",
          beforeItems: ["Analyst triage", "Email chasing", "Inconsistent routing"],
          afterTitle: "Automated EDD path",
          afterItems: ["Rules-based trigger", "Structured evidence", "Clear escalation"],
          caption: "Automation should remove repeatable work, not remove judgement from high-risk cases.",
        }),
        explanation: paragraphs(
          "EDD often contains repetitive data gathering and routing work that does not need senior human judgement. Automating those parts makes the specialist review step more valuable rather than more crowded.",
          "The design boundary is knowing what remains expert work.",
        ),
      },
      {
        title: "Trigger model",
        visual: funnelDiagram(["Jurisdiction trigger", "Ownership complexity", "PEP or sanctions proximity", "EDD branch"], "Automated trigger logic keeps escalation consistent."),
        explanation: paragraphs(
          "The trigger model is the core of EDD automation. If the conditions are clear and policy-linked, the system can do the first routing and evidence setup reliably before an analyst applies deeper judgement.",
          "That is where throughput gains are created safely.",
        ),
      },
      {
        title: "70% automation callout",
        visual: metricDiagram("70%", "EDD workflow automation", "Automation was about removing repeatable steps and standardising the case path.", "success"),
        explanation: paragraphs(
          "The 70% figure signals that a substantial share of the EDD process can be standardised without pretending the whole domain is mechanistic. The value comes from routing, collection and evidence preparation.",
          "Specialist judgement remains where it should remain.",
        ),
      },
      {
        title: "Review and escalation path",
        visual: flowDiagram(["Automated preparation", "Analyst review", "Senior approval", "Close or further action"], {
          caption: "Automation prepares the work; it does not erase the control path.",
          tones: ["primary", "", "warning", "success"],
        }),
        explanation: paragraphs(
          "The target state still needs explicit review and approval points. What changes is that analysts receive better-prepared cases and spend less time reconstructing context or chasing standard evidence.",
          "That improves both quality and speed.",
        ),
      },
    ],
  },
  {
    id: "transaction-monitoring",
    title: "Transaction Monitoring",
    icon: "📡",
    category: "domains",
    blurb: "Product thinking applied to monitoring controls, remediation requirements and operational review design.",
    slides: [
      {
        title: "Detection logic overview",
        visual: flowDiagram(["Transaction events", "Scenario logic", "Alert creation", "Case review", "Decision outcome"], {
          caption: "Monitoring design is a chain of assumptions from event to decision.",
          tones: ["", "primary", "warning", "primary", "success"],
        }),
        explanation: paragraphs(
          "Transaction monitoring can look purely technical, but it is really a control product. Thresholds, segmentation and scenario design all shape both risk detection and operational demand.",
          "That is why product thinking is useful here.",
        ),
      },
      {
        title: "Requirements under remediation",
        visual: matrixDiagram(
          [
            { title: "Findings", items: ["Coverage gaps", "Weak segmentation", "Poor evidence"] },
            { title: "Product work", items: ["Requirement rewrite", "Data fixes", "Scenario changes"] },
            { title: "Outcome", items: ["Clear controls", "Trackable closure", "Safer operations"] },
          ],
          "Remediation turns abstract findings into specific product and operating changes.",
        ),
        explanation: paragraphs(
          "When monitoring sits inside a remediation programme, the work moves from abstract compliance concern to concrete delivery. You need traceable requirements, operating changes and evidence that issues were actually resolved.",
          "That is where structure matters.",
        ),
      },
      {
        title: "Product and control embedding",
        visual: compareDiagram({
          beforeTitle: "Detached controls",
          beforeItems: ["Limited ownership", "Poor roadmap fit", "Slow fixes"],
          afterTitle: "Embedded controls",
          afterItems: ["Named owners", "Roadmap alignment", "Faster closure"],
          caption: "Control effectiveness improves when it is embedded into product governance.",
        }),
        explanation: paragraphs(
          "Monitoring improves when product, compliance and operations all see the same system. That means requirements, defects, scenario tuning and evidence all need one delivery frame.",
          "Otherwise remediation drifts into theatre.",
        ),
      },
      {
        title: "Review operating model",
        visual: funnelDiagram(["Alert queue", "Analyst review", "Escalation", "SAR or closure"], "The operating model must fit alert volume and control expectations at the same time."),
        explanation: paragraphs(
          "The review model matters as much as the scenario logic. Queue design, escalation thresholds and quality review determine whether the control is actually workable in practice.",
          "That is where product, operations and compliance need a common frame.",
        ),
      },
    ],
  },
  {
    id: "sanctions-screening",
    title: "Sanctions Screening",
    icon: "🚫",
    category: "domains",
    blurb: "How screening design, list management and alert quality shape real operational performance.",
    slides: [
      {
        title: "Screening flow and decision logic",
        visual: flowDiagram(["Name and entity data", "Screening engine", "Alert review", "Decision and evidence"], {
          caption: "Sanctions screening is a workflow, not just a list check.",
          tones: ["", "primary", "warning", "success"],
        }),
        explanation: paragraphs(
          "Sanctions screening has to produce a defensible outcome for each case. That means matching logic, review rules, evidence capture and decision records all matter together.",
          "A technically accurate engine alone does not make an effective control.",
        ),
      },
      {
        title: "Lists, thresholds and alert quality",
        visual: matrixDiagram(
          [
            { title: "Inputs", items: ["Watchlists", "Aliases", "Jurisdiction data"] },
            { title: "Configuration", items: ["Thresholds", "Match rules", "Suppression logic"] },
            { title: "Outputs", items: ["Alert volume", "Hit quality", "Review effort"] },
          ],
          "Alert quality is shaped by data, rules and list strategy together.",
        ),
        explanation: paragraphs(
          "If list refreshes, alias handling or threshold logic are weak, alert volume becomes a management problem. Strong screening therefore needs both technical configuration and operational feedback loops.",
          "That is the basis for sustainable control quality.",
        ),
      },
      {
        title: "Capacity effects",
        visual: compareDiagram({
          beforeTitle: "Poor alert quality",
          beforeItems: ["Backlogs", "Analyst fatigue", "Slow decisions"],
          afterTitle: "Better alert quality",
          afterItems: ["Focused reviews", "Stable SLA", "Lower noise"],
          caption: "Capacity improvements should come from sharper signal quality, not weaker controls.",
        }),
        explanation: paragraphs(
          "Screening configuration affects staffing, queue design and turnaround times immediately. That is why product and controls teams need the same view of what quality improvement actually means.",
          "Otherwise operational relief is achieved by the wrong mechanism.",
        ),
      },
      {
        title: "Regulatory effectiveness",
        visual: funnelDiagram(["Policy intent", "System rules", "Operational review", "Evidence retained"], "The control is only as strong as its weakest operational link."),
        explanation: paragraphs(
          "An effective sanctions control needs a complete chain from policy to system logic to operational decisions and evidence retention. Breaks in any part of that chain weaken the overall control position.",
          "That is why screening has to be managed as a system, not a single tool.",
        ),
      },
    ],
  },
  {
    id: "regulatory-remediation",
    title: "Regulatory Remediation",
    icon: "📚",
    category: "domains",
    blurb: "Turning findings into product and operating changes that can actually close risk and stand up to scrutiny.",
    slides: [
      {
        title: "What remediation means operationally",
        visual: flowDiagram(["Finding", "Root cause", "Requirement set", "Delivery change", "Closure evidence"], {
          caption: "Remediation is a structured operating change, not just a document exercise.",
          tones: ["warning", "", "primary", "primary", "success"],
        }),
        explanation: paragraphs(
          "Regulatory remediation only works when findings are translated into concrete changes to systems, workflows, controls and governance. A narrative alone does not reduce risk.",
          "That is why traceability matters from the first requirement onward.",
        ),
      },
      {
        title: "Translating findings into product work",
        visual: matrixDiagram(
          [
            { title: "Finding type", items: ["Policy gap", "Control gap", "Data gap"] },
            { title: "Delivery response", items: ["Requirement", "Backlog item", "Ownership"] },
            { title: "Evidence", items: ["Test results", "MI", "Governance records"] },
          ],
          "Product framing makes remediation executable.",
        ),
        explanation: paragraphs(
          "The shift from finding to product work is where many programmes struggle. Each issue needs a named owner, a defined change and a credible way to demonstrate that the weakness is closed.",
          "That is the core operating discipline.",
        ),
      },
      {
        title: "Audit-point closure model",
        visual: phaseDiagram(["Define", "Deliver", "Validate", "Evidence pack"], "Closure is a sequence, not a status label."),
        explanation: paragraphs(
          "Audit and regulatory stakeholders want confidence that controls are genuinely stronger, not merely renamed. That means the closure model needs clear deliverables, test evidence and governance sign-off.",
          "Anything looser becomes contestable later.",
        ),
      },
      {
        title: "Sustainable operating-state design",
        visual: compareDiagram({
          beforeTitle: "Temporary remediation",
          beforeItems: ["Project-only fixes", "Manual workarounds", "Weak ownership"],
          afterTitle: "Sustained control state",
          afterItems: ["Embedded ownership", "Steady MI", "Governed changes"],
          caption: "The real finish line is durable control ownership after the programme ends.",
        }),
        explanation: paragraphs(
          "A remediation is only complete when the operating state is sustainable. That means the control logic, MI, ownership and change routines have to persist after the project team steps away.",
          "That is the difference between closure and recurrence.",
        ),
      },
    ],
  },
  {
    id: "operating-model-design",
    title: "Operating Model Design",
    icon: "🏗️",
    category: "domains",
    blurb: "Designing teams, queues, governance and ownership so the workflow scales without ambiguity.",
    slides: [
      {
        title: "Teams and responsibilities",
        visual: matrixDiagram(
          [
            { title: "Front office", items: ["Client context", "Expectation setting"] },
            { title: "Operations", items: ["Case handling", "Evidence collection"] },
            { title: "Compliance", items: ["Decision review", "Approvals"] },
          ],
          "Operating design starts with clear boundaries and explicit handoffs.",
        ),
        explanation: paragraphs(
          "Operating models fail when responsibilities overlap without being designed. Clear roles let each team understand its trigger, output and decision rights.",
          "That makes both governance and improvement work much easier.",
        ),
      },
      {
        title: "Workflow ownership",
        visual: flowDiagram(["Intake owner", "Case owner", "Control owner", "Escalation owner"], {
          caption: "Named ownership turns workflow visibility into operational accountability.",
          tones: ["primary", "", "warning", "success"],
        }),
        explanation: paragraphs(
          "For a complex workflow to scale, ownership cannot stop at team level. Important transitions need named responsibility so bottlenecks and defects can be attributed and fixed quickly.",
          "That is how operating clarity becomes real.",
        ),
      },
      {
        title: "Governance checkpoints",
        visual: phaseDiagram(["Weekly ops review", "Monthly steering", "Risk oversight", "Change approval"], "Operating governance should match the rhythm of real decisions."),
        explanation: paragraphs(
          "Governance needs to be practical. Different forums exist for service performance, backlog choices, control concerns and structural decisions, and they should not all be collapsed into one meeting.",
          "Good operating design respects those different purposes.",
        ),
      },
      {
        title: "Capacity and scaling",
        visual: compareDiagram({
          beforeTitle: "Reactive scaling",
          beforeItems: ["Queue shocks", "Hiring lag", "Poor prioritisation"],
          afterTitle: "Planned scaling",
          afterItems: ["Volume signals", "Clear queues", "Targeted automation"] ,
          caption: "Scaling gets easier when queue design and demand signals are explicit.",
        }),
        explanation: paragraphs(
          "Capacity planning depends on good queue structure and demand visibility. If all work appears identical, staffing and automation choices stay blunt. If work types and stages are explicit, scaling becomes much more controlled.",
          "That is one of the strongest reasons to invest in operating-model design.",
        ),
      },
    ],
  },
  {
    id: "business-case-design",
    title: "Business Case Design",
    icon: "💷",
    category: "pm_craft",
    blurb: "Problem framing, cost-benefit logic and decision packaging that makes change fundable.",
    slides: [
      {
        title: "Problem framing",
        visual: flowDiagram(["Pain or risk", "Quantified impact", "Target state", "Investment ask"], {
          caption: "A business case works when the causal story is clear and evidence-backed.",
          tones: ["warning", "", "primary", "success"],
        }),
        explanation: paragraphs(
          "The first job of a business case is not the spreadsheet. It is the logic chain between the current problem, the change being proposed and the outcomes the business should expect if it funds the work.",
          "Weak framing usually leads to weak approval conversations.",
        ),
      },
      {
        title: "Cost-benefit structure",
        visual: matrixDiagram(
          [
            { title: "Costs", items: ["Implementation", "Operating change", "Training"] },
            { title: "Benefits", items: ["Cycle time", "Capacity", "Risk reduction"] },
            { title: "Risks", items: ["Delivery risk", "Adoption risk", "Control risk"] },
          ],
          "A credible business case shows tradeoffs, not just upside.",
        ),
        explanation: paragraphs(
          "A decision-maker needs to see both the benefit logic and the uncertainty. If the case hides risk or assumes perfect adoption, credibility drops immediately.",
          "That is why good business cases are balanced and specific.",
        ),
      },
      {
        title: "400k business case structure",
        visual: metricDiagram("£400k", "Business case value framed for decision-makers", "The number matters because it was tied to a clear structure of costs, returns and risk arguments.", "primary"),
        explanation: paragraphs(
          "The GBP 400k callout matters because it shows the case was concrete enough to be actioned. The important point is not the number alone, but how the investment was linked to operational and control outcomes.",
          "That is what gets a case funded.",
        ),
      },
      {
        title: "Decision forum and approval path",
        visual: funnelDiagram(["Author and sponsor", "Steering review", "Challenge and refine", "Approval decision"], "Decision forums need a clean pack, clear ask and explicit owner."),
        explanation: paragraphs(
          "A business case should be written for the decision forum that will receive it. The audience needs a clear ask, a clear owner and a defined choice to make.",
          "That is why packaging and sequencing matter as much as the analysis.",
        ),
      },
    ],
  },
  {
    id: "vendor-selection-scorecards",
    title: "Vendor Selection and Scorecards",
    icon: "🧮",
    category: "pm_craft",
    blurb: "How to evaluate vendors systematically across control fit, platform fit and delivery realism.",
    slides: [
      {
        title: "Selection criteria",
        visual: matrixDiagram(
          [
            { title: "Capability", items: ["Functional fit", "Configuration depth", "Reporting"] },
            { title: "Delivery", items: ["Implementation effort", "Support model", "Change risk"] },
            { title: "Control", items: ["Auditability", "Governance fit", "Data model"] },
          ],
          "Good selection criteria reflect how the platform will really be used, not just demo strengths.",
        ),
        explanation: paragraphs(
          "Vendor choice should reflect target operating design, not just feature breadth. The best-looking tool in a demo may be a poor fit once governance, data migration and workflow complexity are considered.",
          "That is why criteria need to be anchored in the real use case.",
        ),
      },
      {
        title: "Scorecard model",
        visual: flowDiagram(["Weighted criteria", "Vendor evidence", "Panel scoring", "Decision recommendation"], {
          caption: "Scorecards create transparency and defendability in selection conversations.",
          tones: ["primary", "", "primary", "success"],
        }),
        explanation: paragraphs(
          "A scorecard turns vendor choice into a reasoned decision rather than a personality contest. The weighting logic matters because it reveals what the organisation values most in the target state.",
          "That also helps later when the decision is challenged.",
        ),
      },
      {
        title: "Tradeoff comparison",
        visual: compareDiagram({
          beforeTitle: "Vendor A strength",
          beforeItems: ["Fast setup", "Good demo", "Limited depth"],
          afterTitle: "Vendor B strength",
          afterItems: ["Deeper fit", "Stronger controls", "Heavier implementation"],
          caption: "Most selections are tradeoffs, not obvious wins.",
        }),
        explanation: paragraphs(
          "The real value in a structured selection process is making tradeoffs explicit. It allows the organisation to choose deliberately between speed, flexibility, control depth and implementation burden.",
          "That is how selection decisions become defensible.",
        ),
      },
      {
        title: "Decision output",
        visual: funnelDiagram(["Recommendation", "Rationale", "Risks and assumptions", "Mobilisation"], "A selection process is only useful if it ends in a decision the business can act on."),
        explanation: paragraphs(
          "The final output should give sponsors enough clarity to commit. That means naming the recommended option, why it won, what the risks are and what the next mobilisation step looks like.",
          "Anything more vague creates drift.",
        ),
      },
    ],
  },
  {
    id: "zero-to-one-product-discovery",
    title: "Zero-to-One Product Discovery",
    icon: "🌱",
    category: "pm_craft",
    blurb: "How to move from a blank page to a proposition with proof, feedback and commercial traction.",
    slides: [
      {
        title: "Blank-page discovery",
        visual: flowDiagram(["Observed problem", "Hypothesis", "Target user", "Prototype direction"], {
          caption: "Discovery starts by narrowing uncertainty, not by building too early.",
          tones: ["warning", "", "primary", "success"],
        }),
        explanation: paragraphs(
          "Zero-to-one work is mostly about disciplined learning. At the start, the product team does not need certainty; it needs a better-defined problem and a credible hypothesis for who cares about it.",
          "That is what gives the next step shape.",
        ),
      },
      {
        title: "Client and problem definition",
        visual: matrixDiagram(
          [
            { title: "Who", items: ["Target buyers", "Operators", "Decision-makers"] },
            { title: "What hurts", items: ["Current friction", "Risk exposure", "Workaround cost"] },
            { title: "What matters", items: ["Speed", "Confidence", "Decision quality"] },
          ],
          "Strong discovery turns a broad idea into a specific customer problem.",
        ),
        explanation: paragraphs(
          "The biggest discovery mistake is trying to solve for everyone. A tighter problem frame gives better interviews, better prototypes and better positioning.",
          "That is what allows a proposition to become real.",
        ),
      },
      {
        title: "PoC path",
        visual: phaseDiagram(["Interview and validate", "Prototype", "Pilot", "Commercial proof"], "Discovery should converge toward a testable proposition."),
        explanation: paragraphs(
          "The purpose of the PoC path is to test the proposition under real constraints. A pilot that cannot reveal adoption, willingness to pay or deployment friction is not doing enough work.",
          "Good discovery uses every stage to collapse uncertainty.",
        ),
      },
      {
        title: "Elucidate commercial signal",
        visual: metricDiagram("£120k ARR", "Commercial traction created from zero-to-one discovery at Elucidate", "The point is that discovery moved into revenue, not just insight decks.", "success"),
        explanation: paragraphs(
          "The ARR metric matters because it shows the work moved beyond internal exploration. The discovery process produced something a client would adopt and pay for.",
          "That is the practical test of proposition quality.",
        ),
      },
      {
        title: "From PoC to deployable proposition",
        visual: compareDiagram({
          beforeTitle: "PoC only",
          beforeItems: ["Interesting insight", "Limited packaging", "Low repeatability"],
          afterTitle: "Deployable proposition",
          afterItems: ["Clear buyer story", "Defined operating model", "Commercial path"],
          caption: "The hard step is turning learning into something repeatable and sellable.",
        }),
        explanation: paragraphs(
          "A zero-to-one product only becomes valuable when the insight, user journey and commercial packaging all line up. That means the product needs enough clarity to repeat, not just enough novelty to impress once.",
          "That is where discovery becomes product management.",
        ),
      },
    ],
  },
  {
    id: "onboarding-time-reduction",
    title: "Onboarding Time Reduction",
    icon: "⏱️",
    category: "pm_craft",
    blurb: "Diagnosing the lead-time problem, sequencing fixes and proving the impact on the operating model.",
    slides: [
      {
        title: "Baseline process",
        visual: flowDiagram(["Request", "Evidence collection", "Review loops", "Approvals", "Activation"], {
          caption: "Long lead time usually comes from combined friction across several stages.",
          tones: ["", "primary", "warning", "primary", "success"],
        }),
        explanation: paragraphs(
          "You cannot reduce onboarding time by looking only at the headline metric. You need stage-level visibility: where rework appears, where work waits and which controls create the longest branches.",
          "That gives the improvement effort shape.",
        ),
      },
      {
        title: "Pain points and delay sources",
        visual: funnelDiagram(["Repeated data requests", "Manual routing", "EDD congestion", "Approval waits"], "Lead time compresses only when the dominant causes are removed, not when pressure is applied evenly."),
        explanation: paragraphs(
          "Cycle-time reduction depends on diagnosing the dominant causes properly. Some delays are process design issues, some are control issues and some are ownership issues. Treating them all the same wastes effort.",
          "That is why flow analysis matters.",
        ),
      },
      {
        title: "Vistra lead-time change",
        visual: metricDiagram("45 days -> 20 days", "Vistra onboarding cycle time improvement", "The change mattered because it showed the operating model and platform changes were affecting real delivery.", "success"),
        explanation: paragraphs(
          "The 45-to-20-day reduction gives a concrete picture of what better workflow, ownership and platform design can do. It also provides a management anchor for explaining why the change programme mattered.",
          "Visible outcomes build confidence in the operating model.",
        ),
      },
      {
        title: "55% reduction",
        visual: metricDiagram("55% reduction", "Measured lead-time improvement", "The percentage matters because it expresses the scale of change in a way governance forums can compare and reuse.", "primary"),
        explanation: paragraphs(
          "The percentage framing helps leadership understand that the change was structural, not marginal. It communicates programme value quickly and makes tradeoffs around investment and sequencing easier to discuss.",
          "That is why both absolute and relative metrics are useful.",
        ),
      },
      {
        title: "Why the reduction happened",
        visual: compareDiagram({
          beforeTitle: "Before",
          beforeItems: ["Fragmented ownership", "Manual loops", "Queue opacity"],
          afterTitle: "After",
          afterItems: ["Cleaner routing", "Workflow visibility", "Targeted control paths"],
          caption: "Sustained speed gains come from structural fixes, not one-off effort spikes.",
        }),
        explanation: paragraphs(
          "The important question is always why the metric moved. In this case the gains came from clearer workflow design, better routing and stronger operating ownership rather than simple pressure on the teams.",
          "That makes the improvement repeatable.",
        ),
      },
    ],
  },
  {
    id: "roadmap-sequencing",
    title: "Roadmap Sequencing",
    icon: "🗺️",
    category: "pm_craft",
    blurb: "Sequencing cross-platform change when dependencies, controls and stakeholder readiness all matter.",
    slides: [
      {
        title: "Inter-platform sequencing",
        visual: flowDiagram(["Data foundations", "Workflow layer", "Control tooling", "MI and optimisation"], {
          caption: "Some capabilities only make sense after earlier dependencies are stable.",
          tones: ["primary", "primary", "warning", "success"],
        }),
        explanation: paragraphs(
          "Roadmap sequencing is mostly dependency management. The right question is not just what matters most, but what has to exist first so later capabilities can work as intended.",
          "That is especially true across platform stacks.",
        ),
      },
      {
        title: "Dependency-driven roadmap",
        visual: matrixDiagram(
          [
            { title: "Dependencies", items: ["Data quality", "Integration readiness", "Owner capacity"] },
            { title: "Change items", items: ["Feature work", "Migration", "Governance changes"] },
            { title: "Release choice", items: ["Now", "Later", "Blocked"] },
          ],
          "A strong roadmap explains why work is sequenced, not just when it is scheduled.",
        ),
        explanation: paragraphs(
          "A roadmap becomes credible when it makes blockers visible. That lets stakeholders understand why some work is urgent but cannot safely go first, and why enabling work deserves attention.",
          "That is how sequencing becomes strategic rather than political.",
        ),
      },
      {
        title: "Regulatory urgency versus readiness",
        visual: compareDiagram({
          beforeTitle: "Urgent but unready",
          beforeItems: ["High pressure", "Poor execution", "Rework risk"],
          afterTitle: "Urgent and prepared",
          afterItems: ["Clear prerequisites", "Realistic delivery", "Better evidence"],
          caption: "Urgency does not remove the need for dependency discipline.",
        }),
        explanation: paragraphs(
          "Regulatory or leadership pressure often distorts sequencing. The product job is to keep urgency visible while still protecting the dependency logic that prevents failure and rework.",
          "That is what makes the roadmap defensible.",
        ),
      },
      {
        title: "Example phased rollout",
        visual: phaseDiagram(["Stabilise foundations", "Pilot critical flow", "Extend coverage", "Optimise and tune"], "Phasing helps prove value while controlling change risk."),
        explanation: paragraphs(
          "Phased rollout is often the right answer when platform, process and control changes interact. It allows early value and learning without forcing the organisation into an over-broad cutover.",
          "That improves both delivery confidence and adoption quality.",
        ),
      },
    ],
  },
  {
    id: "stakeholder-governance",
    title: "Stakeholder Governance",
    icon: "🤝",
    category: "pm_craft",
    blurb: "How to keep sponsors, operators and control owners aligned without drowning delivery in meetings.",
    slides: [
      {
        title: "Stakeholder map",
        visual: matrixDiagram(
          [
            { title: "Sponsors", items: ["Budget", "Direction", "Escalation"] },
            { title: "Operators", items: ["Workflow reality", "Pain points", "Adoption"] },
            { title: "Control owners", items: ["Risk stance", "Approvals", "Evidence"] },
          ],
          "A good map shows decision rights, not just names on a slide.",
        ),
        explanation: paragraphs(
          "Stakeholder governance works when each group knows what kind of decision it owns and what information it needs to make it. Otherwise every forum turns into a status meeting.",
          "That wastes momentum and hides real disagreements.",
        ),
      },
      {
        title: "Governance cadence",
        visual: phaseDiagram(["Weekly delivery", "Fortnightly operations", "Monthly steering", "Quarterly control review"], "Different decisions need different forums and rhythms."),
        explanation: paragraphs(
          "Cadence matters because stakeholders consume different kinds of information. Delivery requires short feedback loops, while strategic direction and control oversight need a broader view.",
          "Separating those rhythms keeps governance useful.",
        ),
      },
      {
        title: "Escalation path",
        visual: flowDiagram(["Working-level issue", "Named owner", "Escalation forum", "Decision or unblock"], {
          caption: "Escalation should shorten time to decision, not simply raise temperature.",
          direction: "col",
          tones: ["warning", "", "primary", "success"],
        }),
        explanation: paragraphs(
          "Escalation only works when it is predictable. People need to know what gets raised, who resolves it and what information is expected so that blockers do not linger in ambiguity.",
          "That is how governance protects delivery speed.",
        ),
      },
      {
        title: "Decision hygiene",
        visual: compareDiagram({
          beforeTitle: "Poor hygiene",
          beforeItems: ["No owner", "No next step", "No decision log"],
          afterTitle: "Good hygiene",
          afterItems: ["Clear choice", "Named owner", "Tracked action"],
          caption: "The practical output of governance is a better decision trail.",
        }),
        explanation: paragraphs(
          "Stakeholder governance should leave behind a clean decision trail. That makes delivery more predictable and prevents key choices from being reopened without cause.",
          "It also improves accountability when programmes become complex.",
        ),
      },
    ],
  },
  {
    id: "uat-go-live-hypercare",
    title: "UAT, Go-Live and Hypercare",
    icon: "🚀",
    category: "pm_craft",
    blurb: "The final delivery stages that turn a build into a controlled and adoptable release.",
    slides: [
      {
        title: "UAT readiness",
        visual: flowDiagram(["Scope confirmed", "Test data ready", "Users aligned", "Entry criteria met"], {
          caption: "UAT works when the cases, users and success criteria are prepared before execution starts.",
          tones: ["primary", "", "primary", "success"],
        }),
        explanation: paragraphs(
          "UAT often fails because readiness is assumed. Good readiness means realistic cases, the right users, clear defect triage and an agreed definition of what passing actually means.",
          "That turns testing into evidence.",
        ),
      },
      {
        title: "Release and go-live controls",
        visual: funnelDiagram(["Defect review", "Release sign-off", "Cutover checklist", "Go-live decision"], "Go-live should be a decision supported by evidence, not a date that arrives by default."),
        explanation: paragraphs(
          "Release governance needs explicit controls because the cost of ambiguity rises sharply near go-live. Everyone needs clarity on blockers, waivers and who has authority to proceed.",
          "That is how delivery stays controlled under pressure.",
        ),
      },
      {
        title: "Hypercare loop",
        visual: flowDiagram(["Issue capture", "Daily triage", "Fix or workaround", "Stability trend"], {
          caption: "Hypercare converts early noise into structured stabilisation work.",
          tones: ["warning", "primary", "", "success"],
        }),
        explanation: paragraphs(
          "Hypercare is not just extra support. It is a structured period where the team learns how the release behaves under real demand and makes fast decisions on defects, training gaps and routing issues.",
          "That is what protects adoption confidence.",
        ),
      },
      {
        title: "Stabilisation and handover",
        visual: compareDiagram({
          beforeTitle: "Noisy post-go-live state",
          beforeItems: ["Unclear owners", "Recurring issues", "Weak feedback loop"],
          afterTitle: "Stabilised state",
          afterItems: ["Named ownership", "Managed backlog", "Steady governance"],
          caption: "The end goal is stable ownership, not endless hypercare.",
        }),
        explanation: paragraphs(
          "The final stage is handover into a stable operating model. That requires known owners, a clean backlog process and clear rules for what remains project work versus business-as-usual support.",
          "That is what completes the delivery cycle properly.",
        ),
      },
    ],
  },
];

const getLearnContainer = () => document.getElementById("learn-content");

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const getGuideById = (guideId) => LEARN_GUIDES.find((guide) => guide.id === guideId) || null;

const getGuidesByCategory = (category) => LEARN_GUIDES.filter((guide) => guide.category === category);

const validateGuideCatalog = () => {
  const counts = {
    platforms: getGuidesByCategory("platforms").length,
    domains: getGuidesByCategory("domains").length,
    pm_craft: getGuidesByCategory("pm_craft").length,
  };

  const isValid =
    LEARN_GUIDES.length === 21 && counts.platforms === 6 && counts.domains === 8 && counts.pm_craft === 7;

  if (!isValid) {
    console.warn("Learn guide catalog does not match the expected 21/6/8/7 structure.", counts);
  }
};

const renderGuideCard = (guide) => `
  <button class="learn-card" type="button" data-learn-guide-id="${guide.id}">
    <span class="learn-card__icon" aria-hidden="true">${guide.icon}</span>
    <span class="learn-card__title">${guide.title}</span>
    <span class="learn-card__blurb">${guide.blurb}</span>
    <span class="learn-card__meta">${guide.slides.length} slides</span>
  </button>
`;

const renderGuideGrid = () => {
  const sections = ["platforms", "domains", "pm_craft"]
    .map((category) => {
      const meta = CATEGORY_META[category];
      const guides = getGuidesByCategory(category);
      return `
        <section class="learn-section">
          <div class="learn-section__heading-wrap">
            <h2 class="learn-section__heading">${meta.title}</h2>
            <p class="learn-section__subtitle">${meta.subtitle}</p>
          </div>
          <div class="learn-grid">
            ${guides.map(renderGuideCard).join("")}
          </div>
        </section>
      `;
    })
    .join("");

  return `
    <div class="learn-shell">
      <header class="learn-header">
        <h1 class="learn-header__title">Visual Guides</h1>
        <p class="learn-header__subtitle">Platform, domain and product-delivery diagrams drawn from your experience.</p>
      </header>
      ${sections}
    </div>
  `;
};

const renderDots = (slideCount, activeSlideIndex) => `
  <div class="learn-viewer__dots" aria-hidden="true">
    ${Array.from({ length: slideCount }, (_, index) => {
      const activeClass = index === activeSlideIndex ? " learn-dot--active" : "";
      return `<span class="learn-dot${activeClass}"></span>`;
    }).join("")}
  </div>
`;

const renderGuideViewer = (guide, slideIndex) => {
  const safeIndex = clamp(slideIndex, 0, guide.slides.length - 1);
  const slide = guide.slides[safeIndex];
  const categoryMeta = CATEGORY_META[guide.category];

  return `
    <div class="learn-shell learn-viewer">
      <div class="learn-viewer__top">
        <button class="learn-viewer__back" type="button" data-learn-action="back">&larr; Back to guides</button>
        <div class="learn-viewer__meta">
          <div class="learn-viewer__eyebrow">${categoryMeta.badge}</div>
          <h1 class="learn-header__title">${guide.title}</h1>
          <div class="learn-viewer__progress">${safeIndex + 1} / ${guide.slides.length}</div>
        </div>
      </div>

      <article class="learn-viewer__slide">
        <h2 class="learn-viewer__slide-title">${slide.title}</h2>
        <div class="learn-viewer__visual">${slide.visual}</div>
        <div class="learn-viewer__explanation">${slide.explanation}</div>
      </article>

      ${renderDots(guide.slides.length, safeIndex)}

      <div class="learn-viewer__footer">
        <button class="learn-nav-btn" type="button" data-learn-action="prev" ${safeIndex === 0 ? "disabled" : ""}>Previous</button>
        <button class="learn-nav-btn learn-nav-btn--primary" type="button" data-learn-action="next" ${safeIndex === guide.slides.length - 1 ? "disabled" : ""}>Next</button>
      </div>
    </div>
  `;
};

const renderEmptyState = () => `
  <div class="learn-shell">
    <header class="learn-header">
      <h1 class="learn-header__title">Visual Guides</h1>
      <p class="learn-header__subtitle">No guides available.</p>
    </header>
  </div>
`;

const renderLearn = () => {
  const container = getLearnContainer();
  if (!container) return;

  if (!LEARN_GUIDES.length) {
    container.innerHTML = renderEmptyState();
    return;
  }

  if (!learnState.activeGuideId) {
    container.innerHTML = renderGuideGrid();
    return;
  }

  const guide = getGuideById(learnState.activeGuideId);
  if (!guide) {
    learnState.activeGuideId = null;
    learnState.activeSlideIndex = 0;
    container.innerHTML = renderGuideGrid();
    return;
  }

  learnState.activeSlideIndex = clamp(learnState.activeSlideIndex, 0, guide.slides.length - 1);
  container.innerHTML = renderGuideViewer(guide, learnState.activeSlideIndex);
};

const openGuide = (guideId) => {
  if (!getGuideById(guideId)) return;
  learnState.activeGuideId = guideId;
  learnState.activeSlideIndex = 0;
  renderLearn();
};

const closeGuide = () => {
  learnState.activeGuideId = null;
  learnState.activeSlideIndex = 0;
  renderLearn();
};

const nextSlide = () => {
  const guide = getGuideById(learnState.activeGuideId);
  if (!guide) return;
  learnState.activeSlideIndex = clamp(learnState.activeSlideIndex + 1, 0, guide.slides.length - 1);
  renderLearn();
};

const prevSlide = () => {
  const guide = getGuideById(learnState.activeGuideId);
  if (!guide) return;
  learnState.activeSlideIndex = clamp(learnState.activeSlideIndex - 1, 0, guide.slides.length - 1);
  renderLearn();
};

const bindLearnEvents = () => {
  const container = getLearnContainer();
  if (!container || container.dataset.learnBound === "true") return;

  container.addEventListener("click", (event) => {
    const guideButton = event.target.closest("[data-learn-guide-id]");
    if (guideButton) {
      openGuide(guideButton.dataset.learnGuideId);
      return;
    }

    const actionButton = event.target.closest("[data-learn-action]");
    if (!actionButton) return;

    const { learnAction } = actionButton.dataset;
    if (learnAction === "back") {
      closeGuide();
    } else if (learnAction === "prev") {
      prevSlide();
    } else if (learnAction === "next") {
      nextSlide();
    }
  });

  container.dataset.learnBound = "true";
};

const initializeLearn = () => {
  const container = getLearnContainer();
  if (!container) return;
  validateGuideCatalog();
  bindLearnEvents();
  renderLearn();
};

initializeLearn();
