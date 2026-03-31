const CV_REFERENCE_PROFILES = Object.freeze({
  master_default: {
    id: 'master_default',
    label: 'Master Default',
    source_pdf_path: '/Users/adeomosanya/Downloads/Ade_Omosanya_CV_Master_Product_v11.pdf',
    role_family: 'master_default',
    summary_reference:
      'Senior Product Manager across B2B SaaS, fintech and digital banking platforms focused on onboarding, identity, KYC, screening and financial crime.',
    achievement_references: [
      'Standardised onboarding, KYC and screening across 30+ jurisdictions by defining one global product model across Enate, Fenergo and Napier.',
      'Reduced onboarding cycle time by 20% and client outreach touchpoints by 30% through journey redesign, improved data capture and review-trigger changes.',
      'Delivered 20% onboarding conversion uplift and 38% fewer unnecessary screening reviews across Spain, Greece and Germany by optimising ID&V and screening flows.',
    ],
    priority_tags: ['onboarding', 'kyc', 'screening', 'financial_crime', 'api_integrations', 'product_delivery'],
    prompt_guidance:
      'Stay closest to the master CV. Keep the tone compact, factual and grounded in regulated product delivery, onboarding, KYC, screening and financial crime.',
  },
  financial_crime_ops: {
    id: 'financial_crime_ops',
    label: 'Financial Crime & Fraud Operations',
    source_pdf_path: '/Users/adeomosanya/Downloads/AdeOmosanya_CV_myPOS.pdf',
    role_family: 'financial_crime_ops',
    summary_reference:
      'Product Manager with 13+ years building financial crime controls, screening systems and compliance products across digital banking, B2B fintech and RegTech.',
    achievement_references: [
      'Reduced unnecessary screening alerts by 38% at Ebury by classifying false positives by threshold band and implementing revised LexisNexis API configurations.',
      'Reduced manual screening escalations by 30% and improved QA throughput by 15% at Vistra through threshold tuning, QA framework design and MI dashboards across 30+ jurisdictions.',
      'Defined transaction monitoring, sanctions screening and EDD requirements during BaFin remediation at N26 and rationalised sanctions list subscriptions to halve alert volume.',
    ],
    priority_tags: ['financial_crime', 'fraud', 'screening', 'sanctions', 'transaction_monitoring', 'controls', 'mi_dashboards'],
    prompt_guidance:
      'Prioritise fraud, financial crime, screening, sanctions, transaction monitoring, controls, remediation and operational risk evidence. Keep the tone evidence-led and avoid claiming pure fraud-ops ownership where the master only supports product, controls or remediation delivery.',
  },
  product_delivery: {
    id: 'product_delivery',
    label: 'Product Delivery',
    source_pdf_path: '/Users/adeomosanya/Downloads/AdeOmosanya_CV_MB.pdf',
    role_family: 'product_delivery',
    summary_reference:
      'Senior Product Manager with 13+ years owning backlogs, writing user stories and delivering sprint-based change with engineering squads in complex, regulated financial services environments.',
    achievement_references: [
      'Owned backlog, user stories and sprint delivery across multiple concurrent product workstreams at Vistra; managed scope trade-offs and ran QA validation before each release.',
      'Defined API integration requirements across Fenergo, Napier, Power BI and Microsoft Fabric, working with engineers on endpoint specifications, payload structure and error handling through to production.',
      'Closed 12 BaFin audit points at N26 by translating regulatory requirements into product specifications and delivering financial crime controls under direct regulatory scrutiny.',
    ],
    priority_tags: ['product_delivery', 'backlog', 'user_stories', 'engineering', 'api_integrations', 'uat', 'go_live'],
    prompt_guidance:
      'Prioritise backlog ownership, requirements, engineering delivery, API integration, sprint execution, QA and go-live language. Keep the wording execution-focused rather than abstract leadership prose.',
  },
  clm_programme: {
    id: 'clm_programme',
    label: 'CLM Programme',
    source_pdf_path: '/Users/adeomosanya/Downloads/AdeOmosanya_CV_CLM_PD.pdf',
    role_family: 'clm_programme',
    summary_reference:
      'Senior CLM and KYC transformation leader with 13+ years delivering complex, multi-jurisdictional programs across regulated financial services.',
    achievement_references: [
      'Led end-to-end Fenergo CLM implementation across 30+ jurisdictions at Vistra, covering target-state requirements, journey configuration, vendor management and go-live delivery.',
      'Defined and owned a multi-year CLM program roadmap sequencing Enate, Fenergo and Napier rollout by regulatory urgency, team readiness and platform dependency.',
      'Built a £400k+ business case and delivered 18+ MI dashboards across APAC and EMEA for program tracking, operational performance and regulatory visibility.',
    ],
    priority_tags: ['clm', 'onboarding', 'kyc', 'fenergo', 'napier', 'enate', 'programme', 'vendor_management', 'go_live'],
    prompt_guidance:
      'Prioritise enterprise CLM transformation, roadmap sequencing, platform configuration, vendor management, regulatory alignment and go-live delivery evidence already present in the master CV.',
  },
  fenergo_delivery: {
    id: 'fenergo_delivery',
    label: 'Fenergo Delivery',
    source_pdf_path: '/Users/adeomosanya/Downloads/Ade_Omosanya_CV_Fenergo__SPM.pdf',
    role_family: 'fenergo_delivery',
    summary_reference:
      'Senior Product Manager with 13+ years across banking, B2B SaaS and RegTech, including hands-on experience configuring and integrating Fenergo CLM across two organisations and 30+ jurisdictions.',
    achievement_references: [
      'Designed Fenergo CLM journeys across 30+ jurisdictions covering entity capture, risk assessment, document collection, client outreach and approval routing.',
      'Configured Fenergo against local onboarding requirements at Ebury and led Salesforce-to-Fenergo CLM migration of 50k+ client records with zero downtime.',
      'Worked directly with Fenergo APAC delivery teams on configuration, data mapping, sprint delivery, UAT and go-live.',
    ],
    priority_tags: ['fenergo', 'clm', 'api_integrations', 'data_mapping', 'migration', 'uat', 'go_live', 'product_delivery'],
    prompt_guidance:
      'Prioritise hands-on Fenergo configuration, journey design, API integration, data mapping, migration, UAT and go-live evidence. Keep the claims specific to the master evidence base.',
  },
  institutional_clm: {
    id: 'institutional_clm',
    label: 'Institutional CLM',
    source_pdf_path: '/Users/adeomosanya/Downloads/AdeOmosanya_CV_RBC__CLM.pdf',
    role_family: 'institutional_clm',
    summary_reference:
      'Product management experience across global regulated environments, delivering client lifecycle management, onboarding, KYC and screening platforms for corporate and institutional businesses.',
    achievement_references: [
      'Defined and executed a multi-year CLM product roadmap at Vistra, sequencing sanctions screening, onboarding orchestration and KYC workflow across 30+ jurisdictions.',
      'Standardised the global CLM operating model across Enate, Fenergo and Napier, reducing onboarding cycle time by 20% and client outreach touchpoints by 30% across 30+ countries.',
      'Built a £400k+ business case and launched 18+ KPI dashboards across APAC and EMEA to support platform decisions, delivery tracking and operational visibility.',
    ],
    priority_tags: ['clm', 'corporate_clients', 'institutional', 'onboarding', 'kyc', 'screening', 'roadmap', 'architecture'],
    prompt_guidance:
      'Prioritise client lifecycle management for corporate and institutional businesses, product roadmap, architecture, workflow sequencing, platform dependency management and regulatory visibility.',
  },
});

const getCvReferenceProfile = (profileId = 'master_default') =>
  CV_REFERENCE_PROFILES[profileId] || CV_REFERENCE_PROFILES.master_default;

module.exports = {
  CV_REFERENCE_PROFILES,
  getCvReferenceProfile,
};
