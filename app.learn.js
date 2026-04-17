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
    id: "how-apis-work",
    title: "How APIs Work",
    icon: "🔌",
    category: "platforms",
    blurb: "What APIs actually are, how requests and responses work, and how data flows between platforms you have delivered on.",
    slides: [
      {
        title: "What is an API?",
        visual: flowDiagram(["Building A (your app)", "Courier (API)", "Building B (their system)"], {
          caption: "An API is a courier: it carries requests and returns responses between two systems.",
          tones: ["primary", "warning", "success"],
        }),
        explanation: paragraphs(
          "An API (Application Programming Interface) is a defined contract between two systems. One system sends a request; the other processes it and sends back a response.",
          "Think of two office buildings. Building A needs data from Building B. Instead of direct access, a courier (the API) carries the request over and brings back exactly what was asked for — no more, no less.",
        ),
      },
      {
        title: "GET vs POST — the two main verbs",
        visual: compareDiagram({
          beforeTitle: "GET — fetch data",
          beforeItems: ["Read-only", "No body sent", "e.g. retrieve client record", "Safe to repeat"],
          afterTitle: "POST — send data",
          afterItems: ["Creates or updates", "Body contains payload", "e.g. submit KYC form", "Has side effects"],
          caption: "Choosing the right verb keeps integrations predictable and auditable.",
        }),
        explanation: paragraphs(
          "GET requests read data without changing anything. POST requests send data to create or trigger something.",
          "In a KYC flow, a GET retrieves the client risk profile; a POST submits the completed CDD form. Knowing the difference matters when writing acceptance criteria and debugging failures.",
        ),
      },
      {
        title: "Request and response anatomy",
        visual: flowDiagram(["Headers (auth, format)", "URL + method", "Body (payload)", "→ API →", "Status code + response body"], {
          caption: "A 200 means success. A 400 means bad request. A 500 means the server failed.",
          direction: "col",
          tones: ["", "", "primary", "warning", "success"],
        }),
        explanation: paragraphs(
          "Every API call has the same anatomy: a URL (where to call), a method (what to do), headers (who you are, what format), and optionally a body (the data you are sending).",
          "The response tells you whether it worked. Status codes in the 200s mean success; 400s mean the caller did something wrong; 500s mean the server failed.",
        ),
      },
      {
        title: "Authentication — how systems trust each other",
        visual: matrixDiagram(
          [
            { title: "API Keys", items: ["Simple token", "Passed in header", "Used at Ebury/Napier"] },
            { title: "OAuth 2.0", items: ["Token exchange", "Scoped access", "Common in SaaS"] },
            { title: "mTLS", items: ["Certificate-based", "Both sides verified", "High-security flows"] },
          ],
          "Auth method should match the sensitivity of data crossing the boundary.",
        ),
        explanation: paragraphs(
          "APIs need a way to verify that the caller is who they say they are. API keys are the simplest — a shared secret passed in each request.",
          "OAuth is more sophisticated: the caller first exchanges credentials for a short-lived token, then uses that token. In regulated fintech, cert-based mutual TLS (mTLS) is used where both sides must prove identity.",
        ),
      },
      {
        title: "Salesforce ↔ Fenergo data flow",
        visual: `<div class="diagram"><div class="diagram-row" style="align-items:flex-start;gap:16px;flex-wrap:wrap;">
          <div style="display:flex;flex-direction:column;gap:8px;align-items:center;">
            <div class="diagram-box diagram-box--primary" style="min-width:140px;text-align:center;"><strong>Salesforce</strong><br><span style="font-size:12px;color:#64748b;">CRM — client records, accounts, contacts</span></div>
            <div style="font-size:12px;color:#64748b;">POST /clients → Fenergo</div>
            <div style="font-size:12px;color:#64748b;">GET /risk-profile ← Fenergo</div>
          </div>
          <div class="diagram-arrow" style="align-self:center;font-size:22px;">⇄</div>
          <div style="display:flex;flex-direction:column;gap:8px;align-items:center;">
            <div class="diagram-box diagram-box--success" style="min-width:140px;text-align:center;"><strong>Fenergo</strong><br><span style="font-size:12px;color:#64748b;">CLM — KYC workflow, risk decisions, approvals</span></div>
            <div style="font-size:12px;color:#64748b;">50k records migrated</div>
            <div style="font-size:12px;color:#64748b;">Bi-directional sync</div>
          </div>
        </div><div class="diagram-caption">Salesforce owns the client relationship; Fenergo owns the compliance workflow. The API keeps them in sync.</div></div>`,
        explanation: paragraphs(
          "In the Ebury migration, Salesforce held 50,000 client records. Fenergo needed those records to run KYC workflows — but neither system should hold the other's data redundantly.",
          "The API integration meant Salesforce stayed the CRM source of truth while Fenergo pulled what it needed to drive compliance decisions. Changes in one system propagated to the other via the API contract.",
        ),
      },
      {
        title: "Webhooks — APIs that push instead of pull",
        visual: flowDiagram(["Event happens in System B", "Webhook fires automatically", "System A receives notification", "System A acts on it"], {
          caption: "Webhooks remove the need for System A to keep polling for updates.",
          tones: ["", "warning", "primary", "success"],
        }),
        explanation: paragraphs(
          "Normal APIs require the caller to ask: 'has anything changed?' Webhooks flip this — System B calls System A the moment something happens.",
          "In a KYC context, a webhook might fire when a screening check completes in Napier, automatically updating the case status in Fenergo without any manual polling.",
        ),
      },
      {
        title: "Error handling and retries",
        visual: funnelDiagram(
          ["API call made", "Timeout / 500 error", "Retry (with backoff)", "Still failing → dead-letter queue", "Ops notified → manual resolution"],
          "Good error design keeps failures visible and recoverable — operations should never absorb API failures silently.",
        ),
        explanation: paragraphs(
          "Integrations should never assume success. Transient failures (network blip, server restart) should be retried automatically with backoff. Structural failures (bad payload, auth expired) need different handling — retrying a 400 will never work.",
          "Dead-letter queues catch failures that exhaust retries, making them visible for ops resolution without losing the original request.",
        ),
      },
      {
        title: "How to talk about APIs in interviews",
        visual: matrixDiagram(
          [
            { title: "As a PM, you own", items: ["The contract (what data, what format)", "Acceptance criteria for each endpoint", "Error handling requirements", "Monitoring and alerting spec"] },
            { title: "You do not own", items: ["Implementation language", "Framework choice", "Internal server logic"] },
          ],
          "PMs own the interface contract and operational outcomes — not the implementation details.",
        ),
        explanation: paragraphs(
          "When asked about APIs in interviews, frame your answer around product ownership: what data crosses the boundary, what the success and failure criteria are, and how you ensured the integration stayed reliable in production.",
          "The Salesforce→Fenergo migration is your best example: you defined the field mapping, the data contract, the cutover acceptance criteria, and the monitoring approach for 50k records.",
        ),
      },
    ],
  },
  {
    id: "regtech-stack",
    title: "RegTech Stack at a Glance",
    icon: "📊",
    category: "platforms",
    blurb: "How Salesforce, Fenergo, Napier and Enate connect — and the data that flows between all four.",
    slides: [
      {
        title: "The four platforms and what each owns",
        visual: matrixDiagram(
          [
            { title: "Salesforce", items: ["CRM", "Client records", "Relationship data"] },
            { title: "Fenergo", items: ["CLM", "KYC workflow", "Risk decisions"] },
            { title: "Napier", items: ["AML screening", "Alert generation", "Watchlist matching"] },
            { title: "Enate", items: ["Orchestration", "Work queues", "Task routing"] },
          ],
          "Each platform owns a distinct layer. The integration problem is keeping them coherent.",
        ),
        explanation: paragraphs(
          "The RegTech stack is not one system — it is four systems with distinct responsibilities that need to stay in sync.",
          "Salesforce owns the client relationship. Fenergo owns the compliance workflow. Napier generates AML alerts. Enate orchestrates the work that humans need to do across all three.",
        ),
      },
      {
        title: "How data flows across the full stack",
        visual: `<div class="diagram"><div class="diagram-row" style="flex-wrap:wrap;gap:8px;justify-content:center;align-items:center;">
          <div class="diagram-box diagram-box--primary" style="text-align:center;min-width:110px;"><strong>Salesforce</strong><br><span style="font-size:11px;color:#64748b;">Client record created</span></div>
          <div class="diagram-arrow">→</div>
          <div class="diagram-box diagram-box--success" style="text-align:center;min-width:110px;"><strong>Fenergo</strong><br><span style="font-size:11px;color:#64748b;">KYC case opened</span></div>
          <div class="diagram-arrow">→</div>
          <div class="diagram-box diagram-box--warning" style="text-align:center;min-width:110px;"><strong>Napier</strong><br><span style="font-size:11px;color:#64748b;">Screening run</span></div>
          <div class="diagram-arrow">→</div>
          <div class="diagram-box" style="text-align:center;min-width:110px;border-color:#8b5cf6;background:#f5f3ff;"><strong>Enate</strong><br><span style="font-size:11px;color:#64748b;">Work item routed</span></div>
        </div><div class="diagram-caption">A new client onboarding triggers all four platforms in sequence. Delays in any one block the whole journey.</div></div>`,
        explanation: paragraphs(
          "When a new client is created in Salesforce, Fenergo opens a KYC case. Fenergo triggers Napier to run screening checks. If Napier raises an alert, Enate routes it to the right analyst queue.",
          "This is why integration ownership matters: a failure at any handoff point silently stalls onboarding unless you have explicit monitoring at each boundary.",
        ),
      },
      {
        title: "Where each system sits in the client lifecycle",
        visual: funnelDiagram(
          ["Prospect captured → Salesforce", "Onboarding triggered → Fenergo CLM", "Screening completed → Napier", "Analyst review routed → Enate", "Client activated → back to Salesforce"],
          "The full lifecycle crosses all four platforms. No single system owns the end-to-end journey.",
        ),
        explanation: paragraphs(
          "The client lifecycle is not owned by one system. Salesforce holds the relationship at the start and end. Fenergo holds the compliance decision in the middle. Napier and Enate handle the control layer that sits between collection and decision.",
          "As a PM, you need to understand these boundaries to write requirements that do not assume one system will do what another one owns.",
        ),
      },
      {
        title: "Integration failure points — where things break",
        visual: compareDiagram({
          beforeTitle: "Common failure modes",
          beforeItems: [
            "SF→Fenergo: field mismatch stalls case open",
            "Fenergo→Napier: screening not triggered on update",
            "Napier→Enate: alert lost between queues",
            "No monitoring → silent failure",
          ],
          afterTitle: "Managed integration",
          afterItems: [
            "Canonical field map with owner",
            "Event triggers documented and tested",
            "Dead-letter queue with ops alert",
            "Dashboard per boundary",
          ],
          caption: "Managed integrations have named owners, explicit contracts and visible failure states.",
        }),
        explanation: paragraphs(
          "Most onboarding delays in regulated fintechs trace back to integration failures — not slow analysts. The handoff between systems is where data goes missing, events fail to fire, or queues back up silently.",
          "The fix is not more testing alone. It is explicit ownership of each boundary, documented contracts, and monitoring that alerts before operations absorbs the failure manually.",
        ),
      },
      {
        title: "How to talk about this stack in interviews",
        visual: matrixDiagram(
          [
            { title: "Platforms you have delivered on", items: ["Salesforce (CRM layer)", "Fenergo (CLM — KYC/AML workflows)", "Napier (AML screening, alert tuning)", "Enate (orchestration and queue design)"] },
            { title: "Your integration contribution", items: ["50k records Salesforce→Fenergo", "Napier threshold tuning → 38% FP reduction at Ebury", "Enate queue design for analyst routing", "End-to-end onboarding journey ownership"] },
          ],
          "You have touched all four layers. That is unusually broad for a PM — use it.",
        ),
        explanation: paragraphs(
          "Most PMs have depth in one platform. You have worked across all four layers of the RegTech stack — CRM, CLM, screening and orchestration. That breadth is a differentiator in senior fintech PM interviews.",
          "Frame it as: 'I owned the product across the full client onboarding stack — from CRM capture in Salesforce through KYC workflow in Fenergo, AML screening in Napier, and analyst routing via Enate.' Then anchor it with a metric.",
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
