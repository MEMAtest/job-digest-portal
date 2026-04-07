const { getFirestore } = require("./_firebase");
const crypto = require("crypto");

const escHtml = (str) =>
  String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const htmlPage = (title, message, color = "#4f46e5") => `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escHtml(title)}</title></head>
<body style="margin:0;padding:40px 20px;background:#f1f5f9;font-family:Inter,Arial,sans-serif;text-align:center;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;box-shadow:0 4px 16px rgba(0,0,0,0.08);">
    <div style="font-size:48px;margin-bottom:16px;">${color === "#dc2626" ? "❌" : color === "#16a34a" ? "✅" : "ℹ️"}</div>
    <h1 style="color:${color};margin:0 0 12px;font-size:22px;">${escHtml(title)}</h1>
    <p style="color:#64748b;margin:0;font-size:15px;line-height:1.6;">${escHtml(message)}</p>
  </div>
</body>
</html>`;

const validateToken = (jobId, token) => {
  const secret = process.env.AUTO_APPLY_HMAC_SECRET;
  if (!secret) throw new Error("AUTO_APPLY_HMAC_SECRET not set");
  const expected = crypto.createHmac("sha256", secret).update(jobId).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  // Decode token — if not valid hex or wrong length, reject without timing attack
  let tokenBuf;
  try {
    tokenBuf = Buffer.from(token, "hex");
  } catch {
    return false;
  }
  if (tokenBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, tokenBuf);
};

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const { jobId, token, decision } = params;
  const siteUrl = (process.env.SITE_URL || "https://adejob.netlify.app").replace(/\/$/, "");

  const errorPage = (msg) => ({
    statusCode: 400,
    headers: { "Content-Type": "text/html" },
    body: htmlPage("Invalid Link", msg, "#dc2626"),
  });

  if (!jobId || !token || !["go", "nogo"].includes(decision)) {
    return errorPage("This link is missing required parameters.");
  }

  let tokenValid = false;
  try {
    tokenValid = validateToken(jobId, token);
  } catch (err) {
    console.error("Token validation error:", err.message);
    // Only HMAC_SECRET missing causes a throw now
    return errorPage("Server configuration error. Please contact support.");
  }

  if (!tokenValid) {
    return errorPage("This link is invalid or has expired. Please use the original email link.");
  }

  let db;
  try {
    db = getFirestore();
  } catch (err) {
    return errorPage("Database connection failed.");
  }

  const jobDoc = await db.collection("jobs").doc(jobId).get().catch(() => null);
  if (!jobDoc || !jobDoc.exists) {
    return errorPage("Job not found.");
  }

  const job = jobDoc.data();
  if (job.auto_apply_status !== "review_pending") {
    return {
      statusCode: 200,
      headers: { "Content-Type": "text/html" },
      body: htmlPage(
        "Already Actioned",
        `This application has already been ${job.auto_apply_status || "actioned"}. No further action needed.`,
        "#4f46e5"
      ),
    };
  }

  const now = new Date().toISOString();
  const jobSnapshot = {
    role: job.role || "",
    company: job.company || "",
    salary_range: job.salary_range || "",
    fit_score: job.fit_score || 0,
    ats_family: job.ats_family || "",
  };

  if (decision === "go") {
    await db.collection("jobs").doc(jobId).update({
      auto_apply_status: "approved",
      auto_apply_decision_at: now,
      updated_at: now,
    });

    await db.collection("auto_apply_decisions").add({
      jobId,
      decision: "go",
      reason: "",
      timestamp: now,
      job_snapshot: jobSnapshot,
    });

    return {
      statusCode: 302,
      headers: { Location: `${siteUrl}/?tab=auto-apply` },
      body: "",
    };
  }

  // nogo
  await db.collection("jobs").doc(jobId).update({
    auto_apply_status: "rejected",
    auto_apply_decision_at: now,
    updated_at: now,
  });

  await db.collection("auto_apply_decisions").add({
    jobId,
    decision: "nogo",
    reason: "",
    timestamp: now,
    job_snapshot: jobSnapshot,
  });

  return {
    statusCode: 302,
    headers: { Location: `${siteUrl}/?nogo=${encodeURIComponent(jobId)}` },
    body: "",
  };
};
