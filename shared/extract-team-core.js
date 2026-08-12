// -----------------------------------------------------------------------
// Shared core logic for the team-extraction endpoint. Used by both
// netlify/functions/extract-team.js and api/extract-team.js.
//
// Body: {
//   teamText?: string,
//   teamImage?: { mediaType: string, data: string (base64, no data: prefix) }
// }
// Returns: { status, body } where body is { members: [{name, skills, availability, email}] }
//
// Requires ANTHROPIC_API_KEY. Nothing here is stored anywhere — the
// upload is forwarded to the AI model for this one request and discarded.
// -----------------------------------------------------------------------

const SYSTEM_PROMPT = `You are TeamFlow's team-roster reader. You'll be given an image and/or text describing a group's members — this could be a schedule screenshot, a roster list, a group chat screenshot, a sign-up sheet, or plain text.

Extract every team member you can identify. For each one, include:
- name
- skills (if mentioned or reasonably inferable from context, otherwise an empty string)
- availability (if mentioned — days, times, or general availability — otherwise an empty string)
- email (only if an actual email address is visible, otherwise an empty string)

Do not invent members or details that aren't supported by the input. If you can only find names, that's fine — leave the other fields empty.

Respond with STRICT JSON only, no markdown fences, no commentary, in exactly this shape:
{
  "members": [
    { "name": "string", "skills": "string", "availability": "string", "email": "string" }
  ]
}`;

async function runTeamExtraction(payload) {
  const { teamText, teamImages, teamDocuments } = payload || {};

  const images = Array.isArray(teamImages) ? teamImages.filter((i) => i && i.data && i.mediaType) : [];
  const documents = Array.isArray(teamDocuments) ? teamDocuments.filter((d) => d && d.data && d.mediaType) : [];
  const hasText = !!(teamText && teamText.trim().length >= 3);
  const hasAttachments = images.length > 0 || documents.length > 0;

  if (!hasText && !hasAttachments) {
    return { status: 400, body: { error: "请上传一张图片或文件,或者粘贴一些团队信息文字。" } };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      status: 500,
      body: { error: "服务器未配置 ANTHROPIC_API_KEY。请在项目的环境变量设置里添加它,然后重新部署。" },
    };
  }

  const userContent = [];
  images.forEach((img) => {
    userContent.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } });
  });
  documents.forEach((doc) => {
    userContent.push({ type: "document", source: { type: "base64", media_type: doc.mediaType, data: doc.data } });
  });
  userContent.push({
    type: "text",
    text: `TEAM INFO${hasAttachments ? " (attached files/images are also part of this — read all of them)" : ""}:\n${
      teamText && teamText.trim() ? teamText : "(see attached files/images)"
    }`,
  });

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return { status: 502, body: { error: "AI 服务调用失败,请稍后重试。", detail: errText } };
    }

    const data = await response.json();
    const textBlock = (data.content || []).find((b) => b.type === "text");
    if (!textBlock) {
      return { status: 502, body: { error: "AI 没有返回可用内容。" } };
    }

    const cleaned = textBlock.text.replace(/```json|```/g, "").trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch {
          // fall through
        }
      }
    }

    if (!parsed || !Array.isArray(parsed.members)) {
      return { status: 502, body: { error: "AI 返回的内容无法解析为结构化数据。", raw: cleaned.slice(0, 2000) } };
    }

    return { status: 200, body: parsed };
  } catch (err) {
    return { status: 500, body: { error: (err && err.message) || "未知错误" } };
  }
}

module.exports = { runTeamExtraction };
