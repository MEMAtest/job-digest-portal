export const waitForDom = async (page) => {
  await page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
};

const firstVisible = async (locator) => {
  const count = await locator.count().catch(() => 0);
  if (!count) return null;
  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);
    if ((await item.isVisible().catch(() => false)) || count === 1) return item;
  }
  return locator.first();
};

export const uploadFile = async (page, filePath) => {
  const locator = page.locator('input[type="file"]');
  const input = await firstVisible(locator);
  if (!input) return false;
  await input.setInputFiles(filePath);
  return true;
};

const selectOptionByText = async (element, value) => {
  const options = await element.locator("option").evaluateAll((nodes) =>
    nodes.map((node) => ({
      value: node.value,
      text: (node.textContent || "").trim(),
    }))
  );
  const wanted = String(value || "").toLowerCase();
  const match = options.find((option) => option.text.toLowerCase().includes(wanted) || option.value.toLowerCase().includes(wanted));
  if (!match) return false;
  await element.selectOption(match.value);
  return true;
};

export const fillUsingStrategies = async (page, strategies, value) => {
  if (!value) return false;
  for (const strategy of strategies) {
    let locator = null;
    if (strategy.kind === "label") locator = page.getByLabel(strategy.value).first();
    if (strategy.kind === "placeholder") locator = page.getByPlaceholder(strategy.value).first();
    if (strategy.kind === "selector") locator = page.locator(strategy.value).first();
    if (!locator) continue;

    const count = await locator.count().catch(() => 0);
    if (!count) continue;
    const element = await firstVisible(locator);
    if (!element) continue;

    const tagName = await element.evaluate((node) => node.tagName.toLowerCase()).catch(() => "");
    if (tagName === "select") {
      const selected = await selectOptionByText(element, value).catch(() => false);
      if (selected) return true;
      continue;
    }

    if (tagName === "textarea" || tagName === "input") {
      await element.fill(String(value));
      return true;
    }
  }
  return false;
};

export const buildTextStrategies = (labelPatterns = [], selectors = []) => {
  const strategies = [];
  labelPatterns.forEach((pattern) => strategies.push({ kind: "label", value: pattern }));
  selectors.forEach((selector) => strategies.push({ kind: "selector", value: selector }));
  return strategies;
};

export const fillStandardPersonFields = async (page, answers) => {
  const filled = [];
  const skipped = [];

  const fullName = String(answers.fullName || "").trim();
  const nameParts = fullName.split(/\s+/).filter(Boolean);
  const firstName = nameParts[0] || fullName;
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";

  const fields = [
    {
      key: "first_name",
      value: firstName,
      strategies: buildTextStrategies([/first name/i, /given name/i], ['input[name*="first" i]', 'input[id*="first" i]']),
    },
    {
      key: "last_name",
      value: lastName,
      strategies: buildTextStrategies([/last name/i, /surname/i, /family name/i], ['input[name*="last" i]', 'input[id*="last" i]']),
    },
    {
      key: "full_name",
      value: fullName,
      strategies: buildTextStrategies([/full name/i, /name/i], [
        'input[name*="name" i]:not([name*="first" i]):not([name*="last" i])',
      ]),
    },
    {
      key: "email",
      value: answers.email,
      strategies: buildTextStrategies([/email/i], ['input[type="email"]', 'input[name*="email" i]']),
    },
    {
      key: "phone",
      value: answers.phone,
      strategies: buildTextStrategies([/phone/i, /mobile/i], ['input[type="tel"]', 'input[name*="phone" i]']),
    },
    {
      key: "location",
      value: answers.location,
      strategies: buildTextStrategies([/location/i, /city/i, /address/i], ['input[name*="location" i]', 'input[name*="city" i]']),
    },
    {
      key: "linkedin",
      value: answers.linkedinUrl,
      strategies: buildTextStrategies([/linkedin/i], ['input[name*="linkedin" i]']),
    },
    {
      key: "portfolio",
      value: answers.portfolioUrl,
      strategies: buildTextStrategies([/website/i, /portfolio/i, /personal site/i], ['input[name*="website" i]', 'input[name*="portfolio" i]']),
    },
    {
      key: "salary",
      value: answers.salaryExpectation,
      strategies: buildTextStrategies([/salary/i, /compensation/i], ['input[name*="salary" i]', 'input[name*="compensation" i]']),
    },
    {
      key: "notice",
      value: answers.noticePeriod,
      strategies: buildTextStrategies([/notice/i, /start date/i, /available/i], ['input[name*="notice" i]', 'input[name*="available" i]']),
    },
    {
      key: "work_authorization",
      value: answers.rightToWorkUk,
      strategies: buildTextStrategies([/right to work/i, /work authorization/i, /authorised to work/i, /eligible to work/i], [
        'select[name*="work" i]',
        'select[name*="authorization" i]',
      ]),
    },
  ];

  for (const field of fields) {
    const ok = await fillUsingStrategies(page, field.strategies, field.value);
    if (ok) filled.push(field.key);
    else if (field.value) skipped.push(field.key);
  }

  return { filled, skipped };
};

export const fillNarrativeFields = async (page, answers) => {
  const filled = [];
  const skipped = [];
  const fields = [
    {
      key: "why_this_role",
      value: answers.whyThisRole,
      strategies: buildTextStrategies(
        [/why.*role/i, /why.*interested/i, /why do you want/i, /motivation/i],
        ['textarea[name*="why" i]', 'textarea[name*="motivation" i]']
      ),
    },
    {
      key: "why_this_company",
      value: answers.whyThisCompany,
      strategies: buildTextStrategies(
        [/why.*company/i, /why.*join/i, /why us/i, /interest in/i],
        ['textarea[name*="company" i]', 'textarea[name*="interest" i]']
      ),
    },
    {
      key: "cover_letter",
      value: answers.coverLetter,
      strategies: buildTextStrategies([/cover letter/i, /additional information/i, /anything else/i], [
        'textarea[name*="cover" i]',
        'textarea[name*="additional" i]',
      ]),
    },
  ];

  for (const field of fields) {
    const ok = await fillUsingStrategies(page, field.strategies, field.value);
    if (ok) filled.push(field.key);
    else if (field.value) skipped.push(field.key);
  }

  return { filled, skipped };
};

export const finishWithoutSubmitting = async (page) => {
  const submitLabels = [
    /submit/i,
    /complete application/i,
    /finish/i,
    /apply now/i,
    /send application/i,
  ];
  for (const label of submitLabels) {
    const button = page.getByRole("button", { name: label }).first();
    const count = await button.count().catch(() => 0);
    if (count) {
      await button.scrollIntoViewIfNeeded().catch(() => {});
      return true;
    }
  }
  return false;
};
