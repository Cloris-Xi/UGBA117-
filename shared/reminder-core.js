// -----------------------------------------------------------------------
// Shared core logic for AUTOMATIC (scheduled) email reminders.
//
// This is different from the manual "Send reminder email" button — that
// one sends immediately through the user's own Gmail when clicked. This
// one runs on a daily schedule with no one present, so it needs:
//
//  - Storage: Upstash Redis (REST API, plain HTTP, no SDK/npm install
//    needed). Requires UPSTASH_REDIS_REST_URL and
//    UPSTASH_REDIS_REST_TOKEN env vars — free tier at upstash.com.
//  - Sending: Resend (REST API, plain HTTP). Requires RESEND_API_KEY —
//    free tier at resend.com. NOTE: on Resend's free tier, until you
//    verify your own sending domain, you can generally only send to the
//    email address you signed up with — check your Resend dashboard for
//    the current limits before relying on this for real teammates.
//
// A plan is identified by a random planId. Each plan stores a deadline
// date, a list of recipient emails, and a plain-text summary. The sweep
// (runReminderSweep) is called once a day by a scheduled function and
// sends an email for any plan whose deadline is 3 days away, 1 day away,
// or today — each offset only sent once per plan.
// -----------------------------------------------------------------------

const { upstashConfigured, redisCommand } = require("./redis-client");

const INDEX_KEY = "teamflow:reminder-index"; // Redis SET of active plan ids
const REMINDER_OFFSETS = [3, 1, 0]; // days before the deadline to send a reminder

function planKey(planId) {
  return `teamflow:reminder:${planId}`;
}

function offsetDate(dateStr, offsetDays) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

async function saveReminderPlan(payload) {
  const { planId: existingId, deadlineDate, recipients, summaryText } = payload || {};

  if (!upstashConfigured()) {
    return { status: 500, body: { error: "服务器未配置提醒功能所需的存储服务(UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN)。" } };
  }
  if (!deadlineDate || !/^\d{4}-\d{2}-\d{2}$/.test(deadlineDate)) {
    return { status: 400, body: { error: "请提供正确格式的截止日期。" } };
  }
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return { status: 400, body: { error: "至少需要一个团队成员的邮箱才能开启自动提醒。" } };
  }

  const planId = existingId || "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const record = {
    planId,
    deadlineDate,
    recipients,
    summaryText: summaryText || "",
    sentOffsets: [],
    createdAt: new Date().toISOString(),
  };

  await redisCommand(["SET", planKey(planId), JSON.stringify(record)]);
  await redisCommand(["SADD", INDEX_KEY, planId]);

  return {
    status: 200,
    body: { planId, deadlineDate, reminderDates: REMINDER_OFFSETS.map((d) => offsetDate(deadlineDate, -d)) },
  };
}

async function cancelReminderPlan(payload) {
  const { planId } = payload || {};
  if (!upstashConfigured()) {
    return { status: 500, body: { error: "服务器未配置提醒功能所需的存储服务。" } };
  }
  if (!planId) {
    return { status: 400, body: { error: "缺少 planId。" } };
  }
  await redisCommand(["DEL", planKey(planId)]);
  await redisCommand(["SREM", INDEX_KEY, planId]);
  return { status: 200, body: { ok: true } };
}

async function sendReminderEmail(record, offset) {
  const daysWord = offset === 0 ? "today" : `in ${offset} day${offset > 1 ? "s" : ""}`;
  const subject = `TeamFlow reminder — deadline is ${daysWord} (${record.deadlineDate})`;
  const text = `This is an automatic reminder from TeamFlow.\n\nDeadline: ${record.deadlineDate} (${daysWord})\n\n${record.summaryText}\n\n— Sent automatically via TeamFlow`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.REMINDER_FROM_EMAIL || "TeamFlow <onboarding@resend.dev>",
      to: record.recipients,
      subject,
      text,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Resend send failed: ${errText}`);
  }
}

// Called once a day by a scheduled function (Vercel Cron / Netlify
// Scheduled Functions). Checks every saved plan and sends whichever
// reminder emails are due today, then cleans up plans whose deadline has
// passed.
async function runReminderSweep() {
  if (!upstashConfigured()) {
    return { status: 500, body: { error: "存储服务未配置(UPSTASH_REDIS_REST_URL / TOKEN)。" } };
  }
  if (!process.env.RESEND_API_KEY) {
    return { status: 500, body: { error: "邮件发送服务未配置(RESEND_API_KEY)。" } };
  }

  const planIds = (await redisCommand(["SMEMBERS", INDEX_KEY])) || [];
  const today = todayStr();
  let sent = 0;
  let cleaned = 0;

  for (const planId of planIds) {
    const raw = await redisCommand(["GET", planKey(planId)]);
    if (!raw) {
      await redisCommand(["SREM", INDEX_KEY, planId]);
      continue;
    }
    const record = JSON.parse(raw);

    // Clean up plans whose deadline is more than 2 days in the past.
    if (today > offsetDate(record.deadlineDate, 2)) {
      await redisCommand(["DEL", planKey(planId)]);
      await redisCommand(["SREM", INDEX_KEY, planId]);
      cleaned++;
      continue;
    }

    let changed = false;
    for (const offset of REMINDER_OFFSETS) {
      const targetDate = offsetDate(record.deadlineDate, -offset);
      if (targetDate === today && !record.sentOffsets.includes(offset)) {
        try {
          await sendReminderEmail(record, offset);
          record.sentOffsets.push(offset);
          sent++;
          changed = true;
        } catch (err) {
          // Leave it unmarked so tomorrow's sweep (or a retry) can try again.
        }
      }
    }
    if (changed) {
      await redisCommand(["SET", planKey(planId), JSON.stringify(record)]);
    }
  }

  return { status: 200, body: { checked: planIds.length, sent, cleaned } };
}

module.exports = { saveReminderPlan, cancelReminderPlan, runReminderSweep };
