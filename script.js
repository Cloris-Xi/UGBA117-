// -----------------------------------------------------------------------
// TeamFlow demo logic.
//
// Flow:
//  1. User pastes an assignment description and fills in the team form.
//  2. "Build a Team Plan" calls the analyze-assignment function (Vercel's
//     /api route or Netlify's /.netlify/functions route — whichever the
//     site is deployed on),
//     which asks Claude to extract the deadline/deliverables/criteria and
//     suggest a task plan.
//  3. The plan renders into the editable task list (reassign owner, change
//     status) and the workload-balance panel, same as before.
//  4. Everything (assignment text, team, task plan) is saved to
//     localStorage, so it survives a page refresh.
//
// If the AI call fails or hasn't been run yet, the page falls back to the
// static sample data in data.js so the demo is never empty.
// -----------------------------------------------------------------------

(function () {
  "use strict";

  const STORAGE_KEY = "teamflow-plan-v1";
  const COLOR_PALETTE = ["#E7B94A", "#5F7A5E", "#B3514A", "#7C8FA6", "#9B7EDE", "#4C9F9F"];

  const assignmentTextEl = document.getElementById("assignmentText");
  const teamFormEl = document.getElementById("teamForm");
  const analyzeBtn = document.getElementById("analyzeBtn");
  const analyzeStatusEl = document.getElementById("analyzeStatus");
  const assignmentSummaryEl = document.getElementById("assignmentSummary");
  const taskListEl = document.getElementById("taskList");
  const workloadBarsEl = document.getElementById("workloadBars");
  const workloadMsgEl = document.getElementById("workloadMsg");
  const riskListEl = document.getElementById("riskList");

  // ---- state -------------------------------------------------------
  let team = TEAM.map((m, i) => ({ ...m, skills: "", availability: "" }));
  let tasks = INITIAL_TASKS.map((t) => ({ ...t }));
  let assignmentInfo = null; // { deadline, deliverables, gradingCriteria } once AI has run

  const statusOrder = ["todo", "progress", "done"];
  const statusLabel = { todo: "To do", progress: "In progress", done: "Done" };

  // ---- persistence ---------------------------------------------------
  function saveState() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          assignmentText: assignmentTextEl.value,
          team,
          tasks,
          assignmentInfo,
        })
      );
    } catch (e) {
      // localStorage may be unavailable (private browsing, quota) — fail silently.
    }
  }

  function loadState() {
    let saved;
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    } catch (e) {
      saved = null;
    }
    if (!saved) return false;
    if (saved.team && saved.team.length) team = saved.team;
    if (saved.tasks && saved.tasks.length) tasks = saved.tasks;
    if (saved.assignmentText) assignmentTextEl.value = saved.assignmentText;
    if (saved.assignmentInfo) assignmentInfo = saved.assignmentInfo;
    return true;
  }

  // ---- team form -------------------------------------------------------
  function renderTeamForm() {
    teamFormEl.innerHTML = team
      .map(
        (m, i) => `
        <div class="team-row" data-index="${i}">
          <input type="text" class="team-input team-name" value="${escapeAttr(m.name)}" aria-label="Team member name" placeholder="Name">
          <input type="text" class="team-input" value="${escapeAttr(m.skills)}" aria-label="Skills" placeholder="Skills (e.g. writing, design)" data-field="skills">
          <input type="text" class="team-input" value="${escapeAttr(m.availability)}" aria-label="Availability" placeholder="Availability (e.g. evenings)" data-field="availability">
          <button type="button" class="team-remove-btn" data-index="${i}" aria-label="Remove ${escapeAttr(m.name) || "this member"}" ${team.length <= 1 ? "disabled" : ""}>&times;</button>
        </div>`
      )
      .join("");

    teamFormEl.querySelectorAll(".team-row").forEach((row) => {
      const i = Number(row.dataset.index);
      row.querySelector(".team-name").addEventListener("input", (e) => {
        team[i].name = e.target.value;
        renderTasks();
        renderWorkload();
        renderRiskPanel();
        saveState();
      });
      row.querySelectorAll("[data-field]").forEach((input) => {
        input.addEventListener("input", (e) => {
          team[i][e.target.dataset.field] = e.target.value;
          saveState();
        });
      });
    });

    teamFormEl.querySelectorAll(".team-remove-btn").forEach((btn) => {
      btn.addEventListener("click", () => removeMember(Number(btn.dataset.index)));
    });
  }

  function addMember() {
    const usedColors = team.map((m) => m.color);
    const nextColor = COLOR_PALETTE.find((c) => !usedColors.includes(c)) || COLOR_PALETTE[team.length % COLOR_PALETTE.length];
    team.push({ id: "member-" + Date.now().toString(36), name: "", skills: "", availability: "", color: nextColor });
    renderTeamForm();
    renderWorkload();
    saveState();
  }

  function removeMember(index) {
    if (team.length <= 1) return;
    const removed = team[index];
    team.splice(index, 1);
    // Reassign any tasks the removed member owned so nothing is left orphaned.
    tasks.forEach((t) => {
      if (t.owner === removed.id) t.owner = leastLoadedMemberId(removed.id);
    });
    renderTeamForm();
    renderTasks();
    renderWorkload();
    renderRiskPanel();
    saveState();
  }

  const addMemberBtn = document.getElementById("addMemberBtn");
  if (addMemberBtn) addMemberBtn.addEventListener("click", addMember);

  function escapeAttr(str) {
    return String(str || "").replace(/"/g, "&quot;");
  }

  function teamMember(id) {
    return team.find((m) => m.id === id) || team[0];
  }

  function teamMemberByName(name) {
    const match = team.find((m) => m.name.toLowerCase() === String(name || "").toLowerCase());
    return match || team[0];
  }

  // ---- task list -------------------------------------------------------
  function nextStatus(current) {
    const i = statusOrder.indexOf(current);
    return statusOrder[(i + 1) % statusOrder.length];
  }

  function renderTasks() {
    taskListEl.innerHTML = "";
    tasks.forEach((task) => {
      const owner = teamMember(task.owner);
      const row = document.createElement("div");
      row.className = "task-row";
      row.setAttribute("role", "listitem");

      const blocker = task.blockedBy && tasks.find((t) => t.id === task.blockedBy);
      const blocked = blocker && blocker.status !== "done" && task.status !== "done";

      row.innerHTML = `
        <div class="task-main">
          <p class="task-name">${task.name}${blocked ? '<span class="task-flag">may be delayed</span>' : ""}</p>
          <p class="task-meta"><span class="task-due">${task.due}</span> · <span class="task-hours">${task.hours}h</span></p>
        </div>
        <button type="button" class="owner-pill" style="--av:${owner.color}" data-task="${task.id}" aria-label="Task owner: ${owner.name}. Click to reassign.">
          <span class="avatar avatar-sm">${(owner.name[0] || "?").toUpperCase()}</span>${owner.name}
        </button>
        <button type="button" class="status-pill status-${task.status}" data-task="${task.id}" aria-label="Status: ${statusLabel[task.status]}. Click to change.">
          ${statusLabel[task.status]}
        </button>
      `;
      taskListEl.appendChild(row);
    });

    taskListEl.querySelectorAll(".owner-pill").forEach((btn) => {
      btn.addEventListener("click", () => cycleOwner(btn.dataset.task));
    });
    taskListEl.querySelectorAll(".status-pill").forEach((btn) => {
      btn.addEventListener("click", () => cycleStatus(btn.dataset.task));
    });
  }

  function cycleOwner(taskId) {
    const task = tasks.find((t) => t.id === taskId);
    const i = team.findIndex((m) => m.id === task.owner);
    task.owner = team[(i + 1) % team.length].id;
    renderTasks();
    renderWorkload();
    renderRiskPanel();
    saveState();
  }

  function cycleStatus(taskId) {
    const task = tasks.find((t) => t.id === taskId);
    task.status = nextStatus(task.status);
    renderTasks();
    renderRiskPanel();
    saveState();
  }

  function renderWorkload() {
    const totals = team.map((m) => ({
      ...m,
      hours: tasks.filter((t) => t.owner === m.id).reduce((sum, t) => sum + t.hours, 0),
    }));
    const max = Math.max(...totals.map((t) => t.hours), 1);
    const avg = totals.reduce((sum, t) => sum + t.hours, 0) / totals.length;
    const spread = Math.max(...totals.map((t) => t.hours)) - Math.min(...totals.map((t) => t.hours));

    workloadBarsEl.innerHTML = totals
      .map((m) => {
        const heavy = m.hours > 0 && m.hours - avg > 1.5 && m.hours > avg * 1.35;
        return `
        <div class="workload-row">
          <span class="workload-name">${m.name}${heavy ? '<span class="workload-flag">heavy load</span>' : ""}</span>
          <div class="workload-track"><div class="workload-fill${heavy ? " workload-fill-warn" : ""}" style="--fill:${(m.hours / max) * 100}%; --av:${m.color}"></div></div>
          <span class="workload-hours">${m.hours}h</span>
        </div>`;
      })
      .join("");

    workloadMsgEl.textContent =
      spread <= 1.5 ? "Workload looks balanced." : "Workload is uneven — consider moving a task.";
    workloadMsgEl.classList.toggle("workload-msg-warn", spread > 1.5);
  }

  // ---- risk detection (dynamic, based on real task dependencies) -------------------------------------------------------
  function computeRisks() {
    return tasks
      .filter((t) => t.status !== "done" && t.blockedBy)
      .map((t) => ({ task: t, blocker: tasks.find((b) => b.id === t.blockedBy) }))
      .filter((r) => r.blocker && r.blocker.status !== "done");
  }

  function leastLoadedMemberId(excludeId) {
    const totals = team.map((m) => ({
      id: m.id,
      hours: tasks.filter((t) => t.owner === m.id).reduce((sum, t) => sum + t.hours, 0),
    }));
    const candidates = totals.filter((t) => t.id !== excludeId);
    const pool = candidates.length ? candidates : totals;
    return pool.reduce((min, t) => (t.hours < min.hours ? t : min), pool[0]).id;
  }

  function renderRiskPanel() {
    const risks = computeRisks();

    if (risks.length === 0) {
      riskListEl.innerHTML = `<p class="risk-empty">No risks right now — every dependency is on track.</p>`;
      return;
    }

    riskListEl.innerHTML = risks
      .map(
        ({ task, blocker }, i) => `
        <div class="risk-item">
          <p class="risk-text">"${blocker.name}" isn't done yet, which may delay "${task.name}".</p>
          <button type="button" class="btn btn-small btn-ghost risk-reassign" data-task="${task.id}">
            Move to ${teamMember(leastLoadedMemberId(task.owner)).name}
          </button>
        </div>`
      )
      .join("");

    riskListEl.querySelectorAll(".risk-reassign").forEach((btn) => {
      btn.addEventListener("click", () => {
        const task = tasks.find((t) => t.id === btn.dataset.task);
        task.owner = leastLoadedMemberId(task.owner);
        renderTasks();
        renderWorkload();
        renderRiskPanel();
        saveState();
      });
    });
  }

  // ---- export as CSV -------------------------------------------------------
  function csvEscape(value) {
    const str = String(value ?? "");
    if (/[",\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  function exportTasksAsCsv() {
    const orderedHeader = ["Task", "Owner", "Hours", "Due", "Status"];
    const orderedRows = tasks.map((t) => [t.name, teamMember(t.owner).name, t.hours, t.due, statusLabel[t.status]]);

    const lines = [orderedHeader, ...orderedRows].map((row) => row.map(csvEscape).join(","));

    if (assignmentInfo && assignmentInfo.deadline) {
      lines.unshift(""); // blank line before the table
      lines.unshift(`Deadline,${csvEscape(assignmentInfo.deadline)}`);
    }

    const csvContent = lines.join("\r\n");
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "teamflow-plan.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const exportCsvBtn = document.getElementById("exportCsvBtn");
  if (exportCsvBtn) exportCsvBtn.addEventListener("click", exportTasksAsCsv);

  // ---- assignment summary -------------------------------------------------------
  function renderAssignmentSummary() {
    if (!assignmentInfo) {
      assignmentSummaryEl.hidden = true;
      return;
    }
    assignmentSummaryEl.hidden = false;
    assignmentSummaryEl.innerHTML = `
      <div class="card">
        <h3>What TeamFlow found</h3>
        <p class="summary-line"><strong>Deadline:</strong> ${assignmentInfo.deadline || "Not specified"}</p>
        ${
          assignmentInfo.deliverables && assignmentInfo.deliverables.length
            ? `<p class="summary-label">Deliverables</p><ul class="summary-list">${assignmentInfo.deliverables
                .map((d) => `<li>${d}</li>`)
                .join("")}</ul>`
            : ""
        }
        ${
          assignmentInfo.gradingCriteria && assignmentInfo.gradingCriteria.length
            ? `<p class="summary-label">Grading criteria</p><ul class="summary-list">${assignmentInfo.gradingCriteria
                .map((c) => `<li>${c}</li>`)
                .join("")}</ul>`
            : ""
        }
      </div>`;
  }

  // ---- free local fallback planner (no API key needed) -------------------------------------------------------
  // Used automatically whenever the AI function isn't available yet (no
  // ANTHROPIC_API_KEY configured, or the function hasn't been deployed).
  // Once a key is added, the real AI call above takes over with no code
  // changes needed.
  function detectAssignmentType(text) {
    const t = text.toLowerCase();
    if (t.includes("presentation") || t.includes("slides")) return "presentation";
    if (t.includes("case study")) return "case_study";
    if (t.includes("report") || t.includes("paper") || t.includes("essay")) return "report";
    return "generic";
  }

  function extractDeadlineLocally(text) {
    const week = text.match(/(\d+)\s*week/i);
    if (week) return `${week[1]} week(s) from today`;
    const day = text.match(/(\d+)\s*day/i);
    if (day) return `${day[1]} day(s) from today`;
    const dated = text.match(/due\s*(on|by)?\s*([A-Za-z]+\s+\d{1,2}(,?\s*\d{4})?)/i);
    if (dated) return dated[2];
    return "Not specified — check the assignment brief";
  }

  function extractGradingCriteriaLocally(text) {
    const matches = text.match(/[A-Za-z][A-Za-z\s/]{2,30}\(\s*\d{1,3}\s*%\s*\)/g);
    return matches ? matches.map((s) => s.trim()) : [];
  }

  function deliverablesForType(type) {
    switch (type) {
      case "presentation":
        return ["Slide deck", "Live presentation"];
      case "case_study":
        return ["Case study write-up", "Presentation of findings"];
      case "report":
        return ["Written report"];
      default:
        return ["Final submission"];
    }
  }

  function taskTemplateForType(type) {
    switch (type) {
      case "presentation":
        return [
          { name: "Background research", hours: 1.5 },
          { name: "Topic analysis", hours: 2 },
          { name: "Slide design", hours: 2 },
          { name: "Script writing", hours: 1.5 },
          { name: "Rehearsal", hours: 1 },
          { name: "Final review", hours: 1 },
        ];
      case "case_study":
        return [
          { name: "Background research", hours: 1.5 },
          { name: "Case analysis", hours: 2 },
          { name: "Findings write-up", hours: 2 },
          { name: "Summary design", hours: 1.5 },
          { name: "Final review", hours: 1 },
        ];
      case "report":
        return [
          { name: "Background research", hours: 2 },
          { name: "Source/data analysis", hours: 2 },
          { name: "Draft writing", hours: 2.5 },
          { name: "Editing & formatting", hours: 1.5 },
          { name: "Final proofread", hours: 1 },
        ];
      default:
        return [
          { name: "Research", hours: 1.5 },
          { name: "Planning", hours: 1 },
          { name: "Drafting", hours: 2 },
          { name: "Review", hours: 1 },
          { name: "Finalize", hours: 1 },
        ];
    }
  }

  // Balances load across the team, giving a small boost to whoever listed a
  // matching skill keyword — a simple stand-in for real AI matching.
  function assignOwnersBalanced(taskList, members) {
    const totals = members.map(() => 0);
    return taskList.map((t, idx) => {
      let bestIdx = 0;
      let bestScore = -Infinity;
      members.forEach((m, i) => {
        const skillMatch =
          m.skills && t.name.toLowerCase().split(" ").some((w) => w.length > 3 && m.skills.toLowerCase().includes(w));
        const score = (skillMatch ? 2 : 0) - totals[i];
        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      });
      totals[bestIdx] += t.hours;
      return { name: t.name, hours: t.hours, owner: members[bestIdx].name, due: `Day ${Math.min(13, 2 + idx * 2)}` };
    });
  }

  function generatePlanLocally(assignmentText, members) {
    const type = detectAssignmentType(assignmentText);
    return {
      deadline: extractDeadlineLocally(assignmentText),
      deliverables: deliverablesForType(type),
      gradingCriteria: extractGradingCriteriaLocally(assignmentText),
      tasks: assignOwnersBalanced(taskTemplateForType(type), members),
    };
  }

  // Infers simple "depends on" links between generated tasks, purely from
  // keywords in the task names — e.g. design/writing tasks depend on the
  // research/analysis task, and review/rehearsal tasks depend on whichever
  // comes later. This is what powers the dynamic risk detection above.
  function deriveDependencies(taskList) {
    const EARLY = ["research", "analysis", "background", "collection", "data"];
    const LATE = ["design", "writ", "draft", "script", "slide", "summary"];
    const FINAL = ["review", "rehearsal", "proofread", "final"];
    const matchIdx = (keywords) => taskList.findIndex((t) => keywords.some((k) => t.name.toLowerCase().includes(k)));
    const earlyIdx = matchIdx(EARLY);
    const lateIdx = matchIdx(LATE);

    return taskList.map((t, i) => {
      const lower = t.name.toLowerCase();
      let blockedBy = null;
      if (LATE.some((k) => lower.includes(k)) && earlyIdx !== -1 && earlyIdx !== i) {
        blockedBy = taskList[earlyIdx].id;
      } else if (FINAL.some((k) => lower.includes(k))) {
        if (lateIdx !== -1 && lateIdx !== i) blockedBy = taskList[lateIdx].id;
        else if (earlyIdx !== -1 && earlyIdx !== i) blockedBy = taskList[earlyIdx].id;
      }
      return { ...t, blockedBy };
    });
  }

  // ---- build the plan: try the real AI function, fall back to the local planner -------------------------------------------------------
  async function buildTeamPlan() {
    const assignmentText = assignmentTextEl.value.trim();
    if (assignmentText.length < 15) {
      analyzeStatusEl.textContent = "请多写一点作业说明,方便生成更准确的计划。";
      analyzeStatusEl.classList.add("analyze-status-error");
      return;
    }
    const activeMembers = team.filter((m) => m.name.trim());
    if (activeMembers.length === 0) {
      analyzeStatusEl.textContent = "请至少填写一位团队成员的名字。";
      analyzeStatusEl.classList.add("analyze-status-error");
      return;
    }

    analyzeBtn.disabled = true;
    analyzeBtn.textContent = "Building plan…";
    analyzeStatusEl.classList.remove("analyze-status-error");
    analyzeStatusEl.textContent = "TeamFlow is reading the assignment and drafting a plan…";

    let result = null;

    const requestBody = JSON.stringify({
      assignmentText,
      teamMembers: activeMembers.map((m) => ({ name: m.name, skills: m.skills, availability: m.availability })),
    });

    // Try the Vercel-style endpoint first, then the Netlify one. Whichever
    // platform this is deployed on, the other one will just 404 and get
    // skipped — no configuration needed on the frontend side.
    for (const endpoint of ["/api/analyze-assignment", "/.netlify/functions/analyze-assignment"]) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: requestBody,
        });
        if (response.status === 404) continue; // this platform doesn't have this endpoint, try the next one
        const data = await response.json();
        if (response.ok) {
          result = { deadline: data.deadline, deliverables: data.deliverables || [], gradingCriteria: data.gradingCriteria || [], tasks: data.tasks || [] };
        }
        // Any other non-OK response (e.g. no API key configured yet) falls through to the local planner below.
        break;
      } catch (err) {
        // Network error on this endpoint — try the next one.
      }
    }

    const usedFallback = !result;
    if (!result) {
      result = generatePlanLocally(assignmentText, activeMembers);
    }

    assignmentInfo = {
      deadline: result.deadline,
      deliverables: result.deliverables,
      gradingCriteria: result.gradingCriteria,
    };

    tasks = deriveDependencies(
      result.tasks.map((t, i) => ({
        id: (usedFallback ? "local-" : "ai-") + i,
        name: t.name,
        owner: teamMemberByName(t.owner).id,
        hours: Number(t.hours) || 1,
        due: t.due || "TBD",
        status: "todo",
      }))
    );

    renderAssignmentSummary();
    renderTasks();
    renderWorkload();
    renderRiskPanel();
    saveState();
    analyzeStatusEl.textContent = usedFallback
      ? "Plan ready — using the built-in quick planner. Add an API key later for smarter, fully AI-generated plans."
      : "Plan ready — review it below, then adjust owners or status as needed.";
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = "Build a Team Plan";
  }

  if (analyzeBtn) analyzeBtn.addEventListener("click", buildTeamPlan);
  if (assignmentTextEl) assignmentTextEl.addEventListener("input", saveState);

  // Smooth in-page scrolling, respecting reduced-motion preference.
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener("click", (e) => {
      const target = document.querySelector(link.getAttribute("href"));
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
    });
  });

  // -----------------------------------------------------------------------
  // INTEGRATION STUBS — where real Google Sheets / Google Calendar
  // integration would be added once a confirmed plan exists.
  // -----------------------------------------------------------------------
  // async function saveToGoogleSheets(confirmedPlan) {
  //   // Would call the Google Sheets API with the user's OAuth token
  //   // to append one row per task (owner, hours, due date, status).
  // }
  //
  // async function createCalendarEvents(confirmedPlan) {
  //   // Would call the Google Calendar API with the user's OAuth token
  //   // to create events for internal deadlines and team meetings.
  // }

  // ---- init -------------------------------------------------------
  loadState();
  renderTeamForm();
  renderAssignmentSummary();
  renderTasks();
  renderWorkload();
  renderRiskPanel();
})();
