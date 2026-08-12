// -----------------------------------------------------------------------
// Shared core logic for a TEAM-shared plan — a link/code your whole team
// can use to view and update the same plan, no Google login required.
//
// Storage: same Upstash Redis database as reminders/account-sync.
// Anyone who has the code can read AND write this record — there's no
// per-person auth here, the code itself is the "key." That's the whole
// point (low friction for teammates), but it does mean the code should
// be treated like a shareable link, not posted somewhere public.
//
// Handles three actions via a single entrypoint (handleTeamPlanAction)
// so both platform adapters only need one file each:
//   - create: save the current plan under a freshly generated code
//   - save:   overwrite the plan stored under an existing code
//   - load:   fetch the plan stored under a code
// -----------------------------------------------------------------------

const { upstashConfigured, redisCommand } = require("./redis-client");

function teamPlanKey(code) {
  return `teamflow:teamplan:${code}`;
}

function generateTeamCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O, 1/I
  let code = "";
  for (let i = 0; i < 7; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function createTeamPlan(payload) {
  const { planData } = payload || {};
  if (!planData) return { status: 400, body: { error: "没有可分享的计划数据。" } };

  let code;
  for (let attempt = 0; attempt < 5; attempt++) {
    code = generateTeamCode();
    const existing = await redisCommand(["GET", teamPlanKey(code)]);
    if (!existing) break;
  }

  const record = { planData, updatedAt: new Date().toISOString() };
  await redisCommand(["SET", teamPlanKey(code), JSON.stringify(record)]);
  return { status: 200, body: { code, updatedAt: record.updatedAt } };
}

async function saveTeamPlan(payload) {
  const { code, planData } = payload || {};
  if (!code) return { status: 400, body: { error: "缺少分享代码。" } };
  if (!planData) return { status: 400, body: { error: "没有可保存的计划数据。" } };

  const existing = await redisCommand(["GET", teamPlanKey(code)]);
  if (!existing) return { status: 404, body: { error: "找不到这个分享代码对应的计划,可能输错了或已经删除。" } };

  const record = { planData, updatedAt: new Date().toISOString() };
  await redisCommand(["SET", teamPlanKey(code), JSON.stringify(record)]);
  return { status: 200, body: { ok: true, updatedAt: record.updatedAt } };
}

async function loadTeamPlan(payload) {
  const { code } = payload || {};
  if (!code) return { status: 400, body: { error: "缺少分享代码。" } };

  const raw = await redisCommand(["GET", teamPlanKey(code)]);
  if (!raw) return { status: 404, body: { error: "找不到这个分享代码对应的计划,检查一下代码是不是输对了。" } };

  const record = JSON.parse(raw);
  return { status: 200, body: { planData: record.planData, updatedAt: record.updatedAt } };
}

async function handleTeamPlanAction(payload) {
  if (!upstashConfigured()) {
    return { status: 500, body: { error: "服务器未配置存储服务(UPSTASH_REDIS_REST_URL / TOKEN)。" } };
  }
  const { action } = payload || {};
  if (action === "create") return createTeamPlan(payload);
  if (action === "save") return saveTeamPlan(payload);
  if (action === "load") return loadTeamPlan(payload);
  return { status: 400, body: { error: "未知操作。" } };
}

module.exports = { handleTeamPlanAction };
