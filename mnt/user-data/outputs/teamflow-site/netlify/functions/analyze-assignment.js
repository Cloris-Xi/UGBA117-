// -----------------------------------------------------------------------
// Netlify adapter — POST /.netlify/functions/analyze-assignment
// Thin wrapper around the shared logic in shared/analyze-core.js so the
// Netlify and Vercel versions never drift out of sync.
// -----------------------------------------------------------------------

const { runAnalysis } = require("../../shared/analyze-core");

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "请求格式有误。" }) };
  }

  const { status, body } = await runAnalysis(payload);
  return { statusCode: status, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
};
