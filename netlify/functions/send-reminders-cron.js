// Netlify Scheduled Function — see the [functions."send-reminders-cron"]
// schedule entry in netlify.toml. Runs the daily reminder sweep.
const { runReminderSweep } = require("../../shared/reminder-core");

exports.handler = async function () {
  const { status, body } = await runReminderSweep();
  return { statusCode: status, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
};
