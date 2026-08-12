const { runReminderSweep } = require("../shared/reminder-core");

module.exports = async function handler(req, res) {
  const { status, body } = await runReminderSweep();
  res.status(status).json(body);
};
