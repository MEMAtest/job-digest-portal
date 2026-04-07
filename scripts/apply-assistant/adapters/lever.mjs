import { waitForDom, uploadFile, fillStandardPersonFields, fillNarrativeFields, finishWithoutSubmitting, submitAndClose } from "./common.mjs";

export const runLeverAdapter = async ({ page, answers, cvPdfPath, autoSubmit = false }) => {
  await waitForDom(page);
  const filled = [];
  const skipped = [];
  const notes = [];

  const uploaded = await uploadFile(page, cvPdfPath);
  if (uploaded) filled.push("resume_upload");
  else skipped.push("resume_upload");

  const person = await fillStandardPersonFields(page, answers);
  filled.push(...person.filled);
  skipped.push(...person.skipped);

  const narrative = await fillNarrativeFields(page, answers);
  filled.push(...narrative.filled);
  skipped.push(...narrative.skipped);

  if (autoSubmit) {
    await submitAndClose(page);
    notes.push("Form submitted automatically");
    return { status: "submitted", filled, skipped, notes };
  }

  await finishWithoutSubmitting(page);
  notes.push("Stopped before final submit");
  return { status: "review_required", filled, skipped, notes };
};
