const ALLOWED_ORIGIN = process.env.SITE_URL || "https://jobsapp-3a2e2.netlify.app";
const withCors = (body, statusCode = 200) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  },
  body: JSON.stringify(body),
});
const handleOptions = () => withCors({}, 204);
module.exports = { withCors, handleOptions };
