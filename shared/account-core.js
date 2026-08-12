// -----------------------------------------------------------------------
// Shared core logic for account-based sync — "log in with the same
// Google account on another device and get your plan back."
//
// Storage: the same Upstash Redis database already configured for
// automatic reminders (shared/redis-client.js) — no new service needed.
//
// Identity: the frontend sends the Google access token it already has
// from "Connect Google." This server verifies it directly with Google
// (via the tokeninfo endpoint) and uses the associated email as the
// storage key — a client can't just claim to be someone else's account
// without actually holding a valid access token for it.
//
// This is a simple one-plan-per-account model (saving overwrites
// whatever was there before) — not a full multi-project account system.
// -----------------------------------------------------------------------

const { upstashConfigured, redisCommand } = require("./redis-client");

function accountKey(email) {
  return `teamflow:account:${email}`;
}

async function verifyGoogleToken(accessToken) {
  if (!accessToken) return null;
  try {
    const res = await fetch(`https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(accessToken)}`);
    if (!res.ok) return null;
    const info = await res.json();
    return info.email || null;
  } catch {
    return null;
  }
}

async function saveAccountData(payload) {
  const { accessToken, planData } = payload || {};

  if (!upstashConfigured()) {
    return { status: 500, body: { error: "服务器未配置存储服务(UPSTASH_REDIS_REST_URL / TOKEN)。" } };
  }

  const email = await verifyGoogleToken(accessToken);
  if (!email) {
    return { status: 401, body: { error: "Google 登录已过期或无效,请重新点击 Connect Google。" } };
  }
  if (!planData) {
    return { status: 400, body: { error: "没有可保存的计划数据。" } };
  }

  const record = { planData, updatedAt: new Date().toISOString() };
  await redisCommand(["SET", accountKey(email), JSON.stringify(record)]);

  return { status: 200, body: { ok: true, email, updatedAt: record.updatedAt } };
}

async function loadAccountData(payload) {
  const { accessToken } = payload || {};

  if (!upstashConfigured()) {
    return { status: 500, body: { error: "服务器未配置存储服务(UPSTASH_REDIS_REST_URL / TOKEN)。" } };
  }

  const email = await verifyGoogleToken(accessToken);
  if (!email) {
    return { status: 401, body: { error: "Google 登录已过期或无效,请重新点击 Connect Google。" } };
  }

  const raw = await redisCommand(["GET", accountKey(email)]);
  if (!raw) {
    return { status: 200, body: { planData: null, email } };
  }

  const record = JSON.parse(raw);
  return { status: 200, body: { planData: record.planData, updatedAt: record.updatedAt, email } };
}

module.exports = { saveAccountData, loadAccountData };
