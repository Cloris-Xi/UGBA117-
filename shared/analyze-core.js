// -----------------------------------------------------------------------
// Shared core logic for the assignment-analysis endpoint.
// Used by both netlify/functions/analyze-assignment.js (Netlify) and
// api/analyze-assignment.js (Vercel) so the two platforms stay in sync.
//
// Body: {
//   assignmentText: string,
//   assignmentImage?: { mediaType: string, data: string (base64, no data: prefix) },
//   teamMembers: [{ name, skills, availability }]
// }
// Returns: { status, body } where body is the JSON payload to send back.
//
// Requires an ANTHROPIC_API_KEY environment variable set in the hosting
// platform's project settings. The key is only ever read on the server
// side here — it is never sent to the browser. Neither the assignment
// text nor the image are stored anywhere — they're forwarded to the AI
// model for this one request and then discarded.
// -----------------------------------------------------------------------

const SYSTEM_PROMPT = `You are TeamFlow's assignment-analysis assistant for college group projects.
The assignment may be given as text, as an image (a photo or screenshot of a printed, handwritten, or on-screen brief), or both — read whichever is present.
1. Identify the deadline (as stated or implied).
2. List the required deliverables.
3. List the grading criteria if mentioned.
4. Break the work into 4-8 concrete, specific tasks.
5. For each task, suggest one owner from the given team members, and estimate the hours it will take, aiming to keep total hours roughly balanced across members. Use each member's stated skills and availability as a factor, not the only factor.
6. Based on the team members' stated availability, suggest one meeting time (or general time window, e.g. "weekday evenings" if no specific times are given) that would work well for the team, and briefly explain your reasoning.

Respond with STRICT JSON only, no markdown fences, no commentary, in exactly this shape:
{
  "deadline": "string",
  "deliverables": ["string", "..."],
  "gradingCriteria": ["string", "..."],
  "tasks": [
    { "name": "string", "owner": "member name", "hours": number, "due": "string" }
  ],
  "suggestedMeeting": { "time": "string", "reason": "string" }
}`;

async function runAnalysis(payload) {
  const { assignmentText, assignmentImages, assignmentDocuments, teamMembers } = payload || {};

  const images = Array.isArray(assignmentImages) ? assignmentImages.filter((i) => i && i.data && i.mediaType) : [];
  const documents = Array.isArray(assignmentDocuments) ? assignmentDocuments.filter((d) => d && d.data && d.mediaType) : [];
  const hasText = !!(assignmentText && assignmentText.trim().length >= 15);
  const hasAttachments = images.length > 0 || documents.length > 0;

  if (!hasText && !hasAttachments) {
    return { status: 400, body: { error: "请粘贴完整一些的作业说明(至少一两句话),或者上传图片/文件。" } };
  }
  if (!Array.isArray(teamMembers) || teamMembers.length === 0) {
    return { status: 400, body: { error: "请至少填写一位团队成员。" } };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      status: 500,
      body: { error: "服务器未配置 ANTHROPIC_API_KEY。请在项目的环境变量设置里添加它,然后重新部署。" },
    };
  }

  const teamDescription = teamMembers
    .map((m) => `- ${m.name}: skills = ${m.skills || "not specified"}; availability = ${m.availability || "not specified"}`)
    .join("\n");

  const textPrompt = `ASSIGNMENT DESCRIPTION${hasAttachments ? " (attached files/images are also part of the assignment — read all of them)" : ""}:\n${
    assignmentText && assignmentText.trim() ? assignmentText : "(see attached files/images)"
  }\n\nTEAM MEMBERS:\n${teamDescription}`;

  const userContent = [];
  images.forEach((img) => {
    userContent.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } });
  });
  documents.forEach((doc) => {
    userContent.push({ type: "document", source: { type: "base64", media_type: doc.mediaType, data: doc.data } });
  });
  userContent.push({ type: "text", text: textPrompt });

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
        max_tokens: 3000,
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
      // Model added stray text around the JSON despite instructions —
      // try pulling out just the {...} block before giving up.
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch {
          // fall through to the error below
        }
      }
    }

    if (!parsed || !Array.isArray(parsed.tasks)) {
      const truncated = data.stop_reason === "max_tokens";
      return {
        status: 502,
        body: {
          error: truncated
            ? "AI 回复被截断了(内容太长),已经调高了长度上限,请重试一次。"
            : "AI 返回的内容无法解析为结构化数据。",
          raw: cleaned.slice(0, 2000),
        },
      };
    }

    return { status: 200, body: parsed };
  } catch (err) {
    return { status: 500, body: { error: (err && err.message) || "未知错误" } };
  }
}

module.exports = { runAnalysis };
