// -----------------------------------------------------------------------
// TeamFlow app logic — powers app.html only (the landing page at
// index.html uses site.js for its own nav scrolling, and both pages share
// privacy-modal.js).
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
  const requirementsTextEl = document.getElementById("requirementsText");
  const assignmentImageInput = document.getElementById("assignmentImageInput");
  const assignmentFileInput = document.getElementById("assignmentFileInput");
  const assignmentFileStatusEl = document.getElementById("assignmentFileStatus");
  const assignmentImagePreviewEl = document.getElementById("assignmentImagePreview");
  const assignmentImagePreviewImgEl = document.getElementById("assignmentImagePreviewImg");
  const removeImageBtn = document.getElementById("removeImageBtn");
  const teamImageInput = document.getElementById("teamImageInput");
  const teamFileInput = document.getElementById("teamFileInput");
  const teamFileStatusEl = document.getElementById("teamFileStatus");
  const teamImagePreviewEl = document.getElementById("teamImagePreview");
  const teamImagePreviewImgEl = document.getElementById("teamImagePreviewImg");
  const removeTeamImageBtn = document.getElementById("removeTeamImageBtn");
  const extractTeamBtn = document.getElementById("extractTeamBtn");
  const teamFormEl = document.getElementById("teamForm");
  const analyzeBtn = document.getElementById("analyzeBtn");
  const analyzeStatusEl = document.getElementById("analyzeStatus");
  const assignmentSummaryEl = document.getElementById("assignmentSummary");
  const taskListEl = document.getElementById("taskList");
  const workloadBarsEl = document.getElementById("workloadBars");
  const workloadMsgEl = document.getElementById("workloadMsg");
  const riskListEl = document.getElementById("riskList");

  const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // 3MB raw — keeps the base64-encoded request comfortably under platform body-size limits

  // ---- state -------------------------------------------------------
  let team = TEAM.map((m, i) => ({ ...m, skills: "", availability: "", email: "" }));
  let tasks = INITIAL_TASKS.map((t) => ({ ...t }));
  let assignmentInfo = null; // { deadline, deliverables, gradingCriteria } once AI has run
  let assignmentImage = null; // { mediaType, data (base64), fileName } — session only, never persisted
  let teamImage = null; // same shape, for the team-roster upload
  let teamUploadText = ""; // text pulled from an uploaded team file — session only

  const statusOrder = ["todo", "progress", "done"];
  const statusLabel = { todo: "To do", progress: "In progress", done: "Done" };

  // ---- persistence ---------------------------------------------------
  function saveState() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          assignmentText: assignmentTextEl.value,
          requirementsText: requirementsTextEl ? requirementsTextEl.value : "",
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
    if (saved.requirementsText && requirementsTextEl) requirementsTextEl.value = saved.requirementsText;
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
          <input type="email" class="team-input" value="${escapeAttr(m.email)}" aria-label="Email" placeholder="Email (for calendar invites)" data-field="email">
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
    team.push({ id: "member-" + Date.now().toString(36), name: "", skills: "", availability: "", email: "", color: nextColor });
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
      spread <= 2.5 ? "Workload looks balanced." : "Workload is uneven — consider moving a task.";
    workloadMsgEl.classList.toggle("workload-msg-warn", spread > 2.5);
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
    const orderedHeader = ["Task", "Owner", "Owner Email", "Hours", "Due", "Status"];
    const orderedRows = tasks.map((t) => {
      const owner = teamMember(t.owner);
      return [t.name, owner.name, owner.email || "", t.hours, t.due, statusLabel[t.status]];
    });

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
        ${
          assignmentInfo.suggestedMeeting && assignmentInfo.suggestedMeeting.time
            ? `<p class="summary-label">Suggested meeting time</p><p class="summary-line">${assignmentInfo.suggestedMeeting.time}${
                assignmentInfo.suggestedMeeting.reason ? ` — ${assignmentInfo.suggestedMeeting.reason}` : ""
              }</p>`
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

  // Free-tier equivalent of the AI's meeting suggestion: looks for a
  // time-of-day/week keyword that shows up in at least half the team's
  // stated availability, in English or Chinese. No real understanding of
  // schedules — just keyword overlap.
  function suggestMeetingLocally(members) {
    const keywords = [
      "evening", "morning", "afternoon", "weekend", "weekday", "night",
      "晚上", "下午", "早上", "上午", "周末", "周中", "晚间",
    ];
    const counts = {};
    members.forEach((m) => {
      const av = (m.availability || "").toLowerCase();
      keywords.forEach((k) => {
        if (av.includes(k.toLowerCase())) counts[k] = (counts[k] || 0) + 1;
      });
    });
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    const threshold = Math.ceil(members.length / 2);
    if (best && best[1] >= threshold) {
      return { time: best[0], reason: `${best[1]} of ${members.length} team members mentioned this` };
    }
    return { time: "TBD", reason: "Not enough overlapping availability info — confirm a time with your team directly." };
  }

  function generatePlanLocally(assignmentText, members) {
    const type = detectAssignmentType(assignmentText);
    return {
      deadline: extractDeadlineLocally(assignmentText),
      deliverables: deliverablesForType(type),
      gradingCriteria: extractGradingCriteriaLocally(assignmentText),
      tasks: assignOwnersBalanced(taskTemplateForType(type), members),
      suggestedMeeting: suggestMeetingLocally(members),
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

  // Always decides who gets which task ourselves, ignoring whatever owner
  // the AI (or local planner) suggested. The AI is only trusted for task
  // breakdown and hour estimates — actual assignment is a plain greedy
  // "give it to whoever currently has the least hours" algorithm, with a
  // small bonus if a member's stated skills match the task name. This
  // guarantees a consistently balanced result regardless of how good or
  // uneven the AI's own suggestion was.
  function assignFairOwners(taskList, members) {
    const totals = members.map(() => 0);
    return taskList.map((t) => {
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
      return members[bestIdx].id;
    });
  }

  // ---- build the plan: try the real AI function, fall back to the local planner -------------------------------------------------------
  // ---- assignment file/image upload -------------------------------------------------------
  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("读取文件失败"));
      reader.readAsDataURL(file);
    });
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("读取文件失败"));
      reader.readAsText(file);
    });
  }

  if (assignmentImageInput) {
    assignmentImageInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        assignmentFileStatusEl.textContent = "请上传图片文件(jpg / png 等)。";
        assignmentFileStatusEl.classList.add("analyze-status-error");
        return;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        assignmentFileStatusEl.textContent = "图片太大了,请上传 3MB 以内的图片(可以截图压缩一下)。";
        assignmentFileStatusEl.classList.add("analyze-status-error");
        return;
      }
      try {
        const dataUrl = await readFileAsDataURL(file);
        const match = dataUrl.match(/^data:(.*);base64,(.*)$/);
        if (!match) throw new Error("图片格式无法识别");
        assignmentImage = { mediaType: match[1], data: match[2], fileName: file.name };
        assignmentImagePreviewImgEl.src = dataUrl;
        assignmentImagePreviewEl.hidden = false;
        assignmentFileStatusEl.classList.remove("analyze-status-error");
        assignmentFileStatusEl.textContent = `已添加图片:${file.name}`;
      } catch (err) {
        assignmentFileStatusEl.textContent = "图片读取失败,请重试。";
        assignmentFileStatusEl.classList.add("analyze-status-error");
      }
    });
  }

  if (removeImageBtn) {
    removeImageBtn.addEventListener("click", () => {
      assignmentImage = null;
      assignmentImagePreviewEl.hidden = true;
      assignmentImageInput.value = "";
      assignmentFileStatusEl.textContent = "";
    });
  }

  if (assignmentFileInput) {
    assignmentFileInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await readFileAsText(file);
        assignmentTextEl.value = assignmentTextEl.value.trim() ? assignmentTextEl.value + "\n\n" + text : text;
        saveState();
        assignmentFileStatusEl.classList.remove("analyze-status-error");
        assignmentFileStatusEl.textContent = `已导入文件内容:${file.name}`;
      } catch (err) {
        assignmentFileStatusEl.textContent = "文件读取失败,请重试。";
        assignmentFileStatusEl.classList.add("analyze-status-error");
      } finally {
        assignmentFileInput.value = "";
      }
    });
  }

  // ---- team-roster upload (fills the whole team from an image/file) -------------------------------------------------------
  function updateExtractTeamBtnState() {
    if (extractTeamBtn) extractTeamBtn.disabled = !teamImage && !teamUploadText;
  }

  if (teamImageInput) {
    teamImageInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        teamFileStatusEl.textContent = "请上传图片文件(jpg / png 等)。";
        teamFileStatusEl.classList.add("analyze-status-error");
        return;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        teamFileStatusEl.textContent = "图片太大了,请上传 3MB 以内的图片。";
        teamFileStatusEl.classList.add("analyze-status-error");
        return;
      }
      try {
        const dataUrl = await readFileAsDataURL(file);
        const match = dataUrl.match(/^data:(.*);base64,(.*)$/);
        if (!match) throw new Error("图片格式无法识别");
        teamImage = { mediaType: match[1], data: match[2], fileName: file.name };
        teamImagePreviewImgEl.src = dataUrl;
        teamImagePreviewEl.hidden = false;
        teamFileStatusEl.classList.remove("analyze-status-error");
        teamFileStatusEl.textContent = `已添加图片:${file.name} — 点"Fill team from upload"识别`;
        updateExtractTeamBtnState();
      } catch (err) {
        teamFileStatusEl.textContent = "图片读取失败,请重试。";
        teamFileStatusEl.classList.add("analyze-status-error");
      }
    });
  }

  if (removeTeamImageBtn) {
    removeTeamImageBtn.addEventListener("click", () => {
      teamImage = null;
      teamImagePreviewEl.hidden = true;
      teamImageInput.value = "";
      teamFileStatusEl.textContent = "";
      updateExtractTeamBtnState();
    });
  }

  if (teamFileInput) {
    teamFileInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        teamUploadText = await readFileAsText(file);
        teamFileStatusEl.classList.remove("analyze-status-error");
        teamFileStatusEl.textContent = `已添加文件:${file.name} — 点"Fill team from upload"识别`;
        updateExtractTeamBtnState();
      } catch (err) {
        teamFileStatusEl.textContent = "文件读取失败,请重试。";
        teamFileStatusEl.classList.add("analyze-status-error");
      } finally {
        teamFileInput.value = "";
      }
    });
  }

  function applyExtractedTeam(members) {
    team = members.map((m, i) => ({
      id: "member-" + Date.now().toString(36) + "-" + i,
      name: m.name || "",
      skills: m.skills || "",
      availability: m.availability || "",
      email: m.email || "",
      color: COLOR_PALETTE[i % COLOR_PALETTE.length],
    }));
    renderTeamForm();
    renderWorkload();
    renderTasks();
    renderRiskPanel();
    saveState();
  }

  async function extractTeamFromUpload() {
    if (!teamImage && !teamUploadText) return;

    extractTeamBtn.disabled = true;
    extractTeamBtn.textContent = "Reading…";
    teamFileStatusEl.classList.remove("analyze-status-error");
    teamFileStatusEl.textContent = "TeamFlow is reading the upload…";

    const requestBody = JSON.stringify({ teamText: teamUploadText, teamImage });
    let handled = false;

    for (const endpoint of ["/api/extract-team", "/.netlify/functions/extract-team"]) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: requestBody,
        });
        if (response.status === 404) continue;
        handled = true;
        const data = await response.json();
        if (response.ok && Array.isArray(data.members) && data.members.length) {
          applyExtractedTeam(data.members);
          teamFileStatusEl.classList.remove("analyze-status-error");
          teamFileStatusEl.textContent = `识别出 ${data.members.length} 位成员,已替换原来的团队列表。`;
        } else {
          teamFileStatusEl.textContent = data.error || "没能从上传内容里识别出团队成员,换一张更清晰的图片试试。";
          teamFileStatusEl.classList.add("analyze-status-error");
        }
        break;
      } catch (err) {
        // Network error on this endpoint — try the next one.
      }
    }

    if (!handled) {
      teamFileStatusEl.textContent = "这个功能需要先配置好 AI 服务(免费本地版无法读取图片/文件内容识别团队成员)。";
      teamFileStatusEl.classList.add("analyze-status-error");
    }

    extractTeamBtn.disabled = false;
    extractTeamBtn.textContent = "Fill team from upload";
  }

  if (extractTeamBtn) extractTeamBtn.addEventListener("click", extractTeamFromUpload);

  async function buildTeamPlan() {
    const rawAssignmentText = assignmentTextEl.value.trim();
    const requirementsText = requirementsTextEl ? requirementsTextEl.value.trim() : "";
    const combinedText = [
      rawAssignmentText,
      requirementsText ? "Teacher's requirements / grading criteria:\n" + requirementsText : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    if (combinedText.length < 15 && !assignmentImage) {
      analyzeStatusEl.textContent = "请多写一点作业说明,或者上传一张图片/文件。";
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
      assignmentText: combinedText,
      assignmentImage,
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
          result = {
            deadline: data.deadline,
            deliverables: data.deliverables || [],
            gradingCriteria: data.gradingCriteria || [],
            tasks: data.tasks || [],
            suggestedMeeting: data.suggestedMeeting || null,
          };
        }
        // Any other non-OK response (e.g. no API key configured yet) falls through to the local planner below.
        break;
      } catch (err) {
        // Network error on this endpoint — try the next one.
      }
    }

    const usedFallback = !result;
    if (!result) {
      result = generatePlanLocally(combinedText, activeMembers);
    }

    assignmentInfo = {
      deadline: result.deadline,
      deliverables: result.deliverables,
      gradingCriteria: result.gradingCriteria,
      suggestedMeeting: result.suggestedMeeting || null,
    };

    const rawTasks = result.tasks.map((t, i) => ({
      id: (usedFallback ? "local-" : "ai-") + i,
      name: t.name,
      hours: Number(t.hours) || 1,
      due: t.due || "TBD",
      status: "todo",
    }));
    const fairOwners = assignFairOwners(rawTasks, activeMembers);
    rawTasks.forEach((t, i) => {
      t.owner = fairOwners[i];
    });
    tasks = deriveDependencies(rawTasks);

    renderAssignmentSummary();
    renderTasks();
    renderWorkload();
    renderRiskPanel();
    saveState();
    if (usedFallback && assignmentImage && combinedText.trim().length < 15) {
      analyzeStatusEl.textContent = "免费本地版无法识别图片内容,先生成了一个通用模板 — 配置 API key 后可以真正读图分析。";
      analyzeStatusEl.classList.add("analyze-status-error");
    } else {
      analyzeStatusEl.classList.remove("analyze-status-error");
      analyzeStatusEl.textContent = usedFallback
        ? "Plan ready — using the built-in quick planner. Add an API key later for smarter, fully AI-generated plans."
        : "Plan ready — review it below, then adjust owners or status as needed.";
    }
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = "Build a Team Plan";
  }

  if (analyzeBtn) analyzeBtn.addEventListener("click", buildTeamPlan);
  if (assignmentTextEl) assignmentTextEl.addEventListener("input", saveState);
  if (requirementsTextEl) requirementsTextEl.addEventListener("input", saveState);

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

  // ---- Google Sheets / Calendar integration -------------------------------------------------------
  // Runs entirely in the browser using Google Identity Services — no
  // backend needed for this part. The user grants access once per
  // session; the access token is kept in memory only (never saved to
  // localStorage), so they'll need to reconnect on a fresh visit.
  let googleAccessToken = null;
  let googleTokenClient = null;

  const googleConnectBtn = document.getElementById("googleConnectBtn");
  const saveSheetsBtn = document.getElementById("saveSheetsBtn");
  const addCalendarBtn = document.getElementById("addCalendarBtn");
  const sendReminderBtn = document.getElementById("sendReminderBtn");
  const googleStatusEl = document.getElementById("googleStatus");

  function googleConfigured() {
    return typeof GOOGLE_CLIENT_ID !== "undefined" && GOOGLE_CLIENT_ID && !GOOGLE_CLIENT_ID.includes("YOUR_CLIENT_ID");
  }

  function initGoogleClient() {
    if (!googleConfigured() || typeof google === "undefined" || !google.accounts) return;
    googleTokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/gmail.send",
      callback: (response) => {
        if (response.error) {
          googleStatusEl.textContent = "Google 授权失败,请重试。";
          googleStatusEl.classList.add("analyze-status-error");
          return;
        }
        googleAccessToken = response.access_token;
        googleConnectBtn.textContent = "Connected ✓";
        googleConnectBtn.disabled = true;
        saveSheetsBtn.disabled = false;
        addCalendarBtn.disabled = false;
        sendReminderBtn.disabled = false;
        googleStatusEl.classList.remove("analyze-status-error");
        googleStatusEl.textContent = "Google connected — you can now save to Sheets, add to Calendar, or send a reminder email.";
      },
    });
  }

  if (googleConnectBtn) {
    googleConnectBtn.addEventListener("click", () => {
      if (!googleConfigured()) {
        googleStatusEl.textContent = "还没配置 Google Client ID —— 先完成 Google Cloud 设置,把 ID 填进 google-config.js。";
        googleStatusEl.classList.add("analyze-status-error");
        return;
      }
      if (!googleTokenClient) initGoogleClient();
      if (googleTokenClient) googleTokenClient.requestAccessToken();
    });
  }

  async function saveToGoogleSheets() {
    if (!googleAccessToken) return;
    saveSheetsBtn.disabled = true;
    saveSheetsBtn.textContent = "Saving…";
    googleStatusEl.classList.remove("analyze-status-error");

    try {
      const createRes = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
        method: "POST",
        headers: { Authorization: `Bearer ${googleAccessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ properties: { title: `TeamFlow Plan — ${new Date().toLocaleDateString()}` } }),
      });
      const sheet = await createRes.json();
      if (!createRes.ok) throw new Error((sheet.error && sheet.error.message) || "创建表格失败");

      const rows = [
        ["Task", "Owner", "Owner Email", "Hours", "Due", "Status"],
        ...tasks.map((t) => {
          const owner = teamMember(t.owner);
          return [t.name, owner.name, owner.email || "", t.hours, t.due, statusLabel[t.status]];
        }),
      ];
      const updateRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheet.spreadsheetId}/values/A1:append?valueInputOption=RAW`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${googleAccessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ values: rows }),
        }
      );
      if (!updateRes.ok) {
        const err = await updateRes.json();
        throw new Error((err.error && err.error.message) || "写入数据失败");
      }

      googleStatusEl.innerHTML = `Saved — <a href="${sheet.spreadsheetUrl}" target="_blank" rel="noopener">open the sheet</a>`;
    } catch (err) {
      googleStatusEl.textContent = "保存到 Sheets 失败: " + err.message;
      googleStatusEl.classList.add("analyze-status-error");
    } finally {
      saveSheetsBtn.disabled = false;
      saveSheetsBtn.textContent = "Save to Google Sheets";
    }
  }

  async function addToGoogleCalendar() {
    if (!googleAccessToken) return;
    addCalendarBtn.disabled = true;
    addCalendarBtn.textContent = "Adding…";
    googleStatusEl.classList.remove("analyze-status-error");

    try {
      // Anyone who filled in a valid-looking email gets invited to these
      // events — Google will email them and add it to their own calendar
      // once they accept. Members without an email just won't get one.
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const attendees = team.filter((m) => m.email && emailPattern.test(m.email.trim())).map((m) => ({ email: m.email.trim() }));

      // NOTE: both dates below are best-effort placeholders — the AI gives
      // free-text descriptions (e.g. "2 weeks from today", "weekday
      // evenings"), not reliable calendar dates. Real date/time parsing
      // would be a good next upgrade; for now the actual wording is put in
      // the event title/description so nothing is lost, and the placeholder
      // date just gives you something to drag to the right spot.
      const events = [];

      const deadlineDate = new Date();
      deadlineDate.setDate(deadlineDate.getDate() + 14);
      events.push({
        summary: "Assignment deadline — " + (assignmentInfo && assignmentInfo.deadline ? assignmentInfo.deadline : "TeamFlow plan"),
        description: "Added by TeamFlow. Double-check this date against the real assignment deadline.",
        start: { date: deadlineDate.toISOString().slice(0, 10) },
        end: { date: deadlineDate.toISOString().slice(0, 10) },
        attendees,
      });

      const meeting = assignmentInfo && assignmentInfo.suggestedMeeting;
      if (meeting && meeting.time && meeting.time !== "TBD") {
        const meetingDate = new Date();
        meetingDate.setDate(meetingDate.getDate() + 3);
        events.push({
          summary: "Suggested team meeting — " + meeting.time,
          description:
            "Added by TeamFlow. This is a placeholder date — confirm an actual date/time with your team." +
            (meeting.reason ? `\n\nWhy this time: ${meeting.reason}` : ""),
          start: { date: meetingDate.toISOString().slice(0, 10) },
          end: { date: meetingDate.toISOString().slice(0, 10) },
          attendees,
        });
      }

      for (const event of events) {
        const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all", {
          method: "POST",
          headers: { Authorization: `Bearer ${googleAccessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify(event),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error((err.error && err.error.message) || "创建日程失败");
        }
      }

      const eventWord = events.length > 1 ? `${events.length} events (deadline + suggested meeting)` : "the deadline";
      googleStatusEl.textContent = attendees.length
        ? `Added ${eventWord} to Google Calendar and invited ${attendees.length} team member(s) — double-check the dates.`
        : `Added ${eventWord} to Google Calendar — double-check the dates. (No team emails were filled in, so no one else was invited.)`;
    } catch (err) {
      googleStatusEl.textContent = "添加到 Calendar 失败: " + err.message;
      googleStatusEl.classList.add("analyze-status-error");
    } finally {
      addCalendarBtn.disabled = false;
      addCalendarBtn.textContent = "Add to Google Calendar";
    }
  }

  // ---- reminder email (manual send, not scheduled) -------------------------------------------------------
  // This sends immediately when clicked, through the connected Gmail
  // account. There is no automatic/scheduled version of this — that would
  // need a database to store plans server-side and a cron job, which is a
  // much bigger project than what's built here.
  function base64UrlEncode(str) {
    return btoa(unescape(encodeURIComponent(str)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }

  function encodeMimeHeader(str) {
    return `=?UTF-8?B?${btoa(unescape(encodeURIComponent(str)))}?=`;
  }

  function buildReminderEmailBody() {
    const lines = ["This is a reminder from TeamFlow about your group's task plan.", ""];
    if (assignmentInfo && assignmentInfo.deadline) lines.push(`Deadline: ${assignmentInfo.deadline}`);
    if (assignmentInfo && assignmentInfo.suggestedMeeting && assignmentInfo.suggestedMeeting.time) {
      const m = assignmentInfo.suggestedMeeting;
      lines.push(`Suggested meeting time: ${m.time}${m.reason ? " — " + m.reason : ""}`);
    }
    lines.push("", "Tasks:");
    tasks.forEach((t) => {
      lines.push(`- ${t.name} — ${teamMember(t.owner).name}, ${t.hours}h, due ${t.due} (${statusLabel[t.status]})`);
    });
    lines.push("", "— Sent via TeamFlow");
    return lines.join("\r\n");
  }

  async function sendReminderEmail() {
    if (!googleAccessToken) return;

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const recipients = team.filter((m) => m.email && emailPattern.test(m.email.trim())).map((m) => m.email.trim());
    if (recipients.length === 0) {
      googleStatusEl.textContent = "队友邮箱都没填,没法发提醒邮件——先在 Step 2 里补上邮箱。";
      googleStatusEl.classList.add("analyze-status-error");
      return;
    }

    sendReminderBtn.disabled = true;
    sendReminderBtn.textContent = "Sending…";
    googleStatusEl.classList.remove("analyze-status-error");

    try {
      const subject = "TeamFlow reminder" + (assignmentInfo && assignmentInfo.deadline ? " — due " + assignmentInfo.deadline : "");
      const rawMessage =
        `To: ${recipients.join(", ")}\r\n` +
        `Subject: ${encodeMimeHeader(subject)}\r\n` +
        `Content-Type: text/plain; charset=UTF-8\r\n\r\n` +
        buildReminderEmailBody();

      const res = await fetch("https://www.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: { Authorization: `Bearer ${googleAccessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ raw: base64UrlEncode(rawMessage) }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error((err.error && err.error.message) || "发送失败");
      }

      googleStatusEl.textContent = `Reminder email sent to ${recipients.length} team member(s).`;
    } catch (err) {
      googleStatusEl.textContent = "发送提醒邮件失败: " + err.message;
      googleStatusEl.classList.add("analyze-status-error");
    } finally {
      sendReminderBtn.disabled = false;
      sendReminderBtn.textContent = "Send reminder email";
    }
  }

  if (saveSheetsBtn) saveSheetsBtn.addEventListener("click", saveToGoogleSheets);
  if (addCalendarBtn) addCalendarBtn.addEventListener("click", addToGoogleCalendar);
  if (sendReminderBtn) sendReminderBtn.addEventListener("click", sendReminderEmail);

  // The Google script loads async, so try initializing once the page has
  // fully loaded rather than assuming it's ready immediately.
  window.addEventListener("load", initGoogleClient);

  // ---- init -------------------------------------------------------
  loadState();
  renderTeamForm();
  renderAssignmentSummary();
  renderTasks();
  renderWorkload();
  renderRiskPanel();
})();
