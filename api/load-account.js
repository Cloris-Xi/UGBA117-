const { loadAccountData } = require("../shared/account-core");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  let payload = req.body;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload || "{}");
    } catch {
      res.status(400).json({ error: "请求格式有误。" });
      return;
    }
  }
  const { status, body } = await loadAccountData(payload || {});
  res.status(status).json(body);
};
