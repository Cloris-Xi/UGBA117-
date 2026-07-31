// -----------------------------------------------------------------------
// POST /.netlify/functions/analyze-assignment
//
// Body: { assignmentText: string, teamMembers: [{ name, skills, availability }] }
// Returns: { deadline, deliverables[], gradingCriteria[], tasks[] }
//
// Requires an ANTHROPIC_API_KEY environment variable set in the Netlify
// site settings (Site configuration > Environment variables). The key is
// only ever read on the server side here — it is never sent to the browser.
// -----------------------------------------------------------------------

const SYSTEM_PROMPT = `You are TeamFlow's assignment-analysis assistant for college group projects.
Read the assignment description and:
1. Identify the deadline (as stated or implied).
2. List the required deliverables.
3. List the grading criteria if mentioned.
4. Break the work into 4-8 concrete, specific tasks.
5. For each task, suggest one owner from the given team members, and estimate the hours it will take, aiming to keep total hours roughly balanced across members. Use each member's stated skills and availability as a factor, not the only factor.

Respond with STRICT JSON only, no markdown fences, no commentary, in exactly this shape:
{
  "deadline": "string",
  "deliverables": ["string", "..."],
  "gradingCriteria": ["string", "..."],
  "tasks": [
    { "name": "string", "owner": "member name", "hours": number, "due": "string" }
  ]
}`;

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

  const { assignmentText, teamMembers } = payload;

  if (!assignmentText || assignmentText.trim().length < 15) {
    return { statusCode: 400, body: JSON.stringify({ error: "请粘贴完整一些的作业说明(至少一两句话)。" }) };
  }
  if (!Array.isArray(teamMembers) || teamMembers.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: "请至少填写一位团队成员。" }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "服务器未配置 ANTHROPIC_API_KEY。请在 Netlify 后台的环境变量中添加它,然后重新部署。",
      }),
    };
  }

  const teamDescription = teamMembers
    .map((m) => `- ${m.name}: skills = ${m.skills || "not specified"}; availability = ${m.availability || "not specified"}`)
    .join("\n");

  const userMessage = `ASSIGNMENT DESCRIPTION:\n${assignmentText}\n\nTEAM MEMBERS:\n${teamDescription}`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return { statusCode: 502, body: JSON.stringify({ error: "AI 服务调用失败,请稍后重试。", detail: errText }) };
    }

    const data = await response.json();
    const textBlock = (data.content || []).find((b) => b.type === "text");
    if (!textBlock) {
      return { statusCode: 502, body: JSON.stringify({ error: "AI 没有返回可用内容。" }) };
    }

    const cleaned = textBlock.text.replace(/```json|```/g, "").trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return { statusCode: 502, body: JSON.stringify({ error: "AI 返回的内容无法解析为结构化数据。", raw: cleaned }) };
    }

    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || "未知错误" }) };
  }
};
