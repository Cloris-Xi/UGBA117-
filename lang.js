// -----------------------------------------------------------------------
// Bilingual (English / 中文) support for static page text.
//
// English is the source of truth, written directly in the HTML. This
// file only supplies Chinese replacements, looked up by the element's
// data-i18n (text content) or data-i18n-placeholder (input placeholder)
// key. Switching back to English just restores the original text that
// was cached the first time this ran.
//
// NOTE: this covers static page copy only — headings, labels, buttons,
// nav, footer, placeholders. Text generated at runtime by script.js
// (status messages, AI-generated task names, error messages) is not
// covered here; that would need a larger follow-up pass through the
// app logic itself.
// -----------------------------------------------------------------------

const ZH_STRINGS = {
  // ---- shared header/footer ----
  "nav.overview": "首页",
  "nav.workflow": "工作原理",
  "nav.features": "功能",
  "nav.compare": "对比",
  "nav.mvp": "已完成功能",
  "nav.backToOverview": "← 返回首页",
  "footer.tagline": "TeamFlow\n面向学生小组作业的 AI 协调工具",
  "footer.product": "产品",
  "footer.workflow": "工作原理",
  "footer.mvp": "已完成功能",
  "footer.contact": "联系我们",
  "footer.privacy": "隐私与数据说明",

  // ---- index.html: hero ----
  "hero.eyebrow": "面向学生小组作业",
  "hero.title": "把小组作业变成清晰的团队计划。",
  "hero.sub": "上传你的作业,TeamFlow 会拆解成任务、建议公平的分工,并帮团队保持进度同步。",
  "hero.ctaPrimary": "开始生成团队计划",
  "hero.ctaSecondary": "看看它是怎么运作的",

  // ---- problem section ----
  "problem.title": "小组作业不该这么难。",
  "problem.tag1": "分工不清",
  "problem.text1": "“大家都以为是别人在做最后的幻灯片。”",
  "problem.tag2": "工作量不均",
  "problem.text2": "“两个人做了全部的调研、分析和幻灯片——其他人只是来展示的。”",
  "problem.tag3": "时间对不上",
  "problem.text3": "“我们光是在群里约时间就花了三次讨论。”",
  "problem.tag4": "截止日期漏掉、文件散落各处",
  "problem.text4": "“最终版本散落在四个聊天群和几封邮件草稿里。”",

  // ---- how it works ----
  "how.eyebrow": "TeamFlow 是怎么运作的",
  "how.title": "一份作业,四个步骤,一份团队共享的计划。",
  "how.step1.title": "上传作业",
  "how.step1.text": "TeamFlow 读取 PDF、截图、邮件或纯文字,自动识别截止日期、交付物和评分标准。",
  "how.step2.title": "添加团队成员",
  "how.step2.text": "每位成员填写自己的技能、兴趣和空闲时间。",
  "how.step3.title": "查看 AI 生成的计划",
  "how.step3.text": "TeamFlow 会拆解任务、建议负责人、估算工作量,并推荐内部截止日期和会议时间。计划确认前,团队随时可以调整或互换任务。",
  "how.step4.title": "开始协作",
  "how.step4.text": "确认后的计划会保存到共享的任务表,重要日期也会同步进 Google 日历。",

  // ---- demo/features intro on landing page ----
  "features.eyebrow": "核心功能",
  "features.title": "MVP 究竟能做什么。",
  "features.f1.title": "理解作业内容",
  "features.f1.text": "读取上传的作业说明,提取截止日期、必须交付的内容和评分标准。",
  "features.f2.title": "自动拆解任务",
  "features.f2.text": "把整个作业拆成具体、可分配的任务,而不是一份长长的待办清单。",
  "features.f3.title": "公平的工作量建议",
  "features.f3.text": "根据每位成员的技能、兴趣和可用时间建议负责人——每个名字旁边都能看到工时。",
  "features.f4.title": "团队排期",
  "features.f4.text": "根据大家填写的空闲时间,推荐合适的会议时间。",
  "features.f5.title": "进度与风险追踪",
  "features.f5.text": "标出进度落后的任务,并提示这会影响到哪些后续工作。",
  "features.f6.title": "最终提交清单",
  "features.f6.text": "在提交前,把所有交付物重新汇总成一份清单。",

  // ---- compare table ----
  "compare.eyebrow": "为什么不直接用 ChatGPT 或普通任务管理工具?",
  "compare.title": "一个真正贯通的团队作业工作流,而不只是一个工具。",
  "compare.col.capability": "能力",
  "compare.col.teamflow": "TeamFlow",
  "compare.col.chatbot": "通用 AI 聊天工具",
  "compare.col.taskmanager": "普通任务管理工具",
  "compare.row1": "理解作业说明",
  "compare.row2": "生成完整的任务结构",
  "compare.row3": "结合团队技能与时间",
  "compare.row4": "检查工作量是否均衡",
  "compare.row5": "推荐会议时间",
  "compare.row6": "追踪项目风险",
  "compare.row7": "生成最终提交清单",
  "compare.note": "通用聊天工具和普通任务管理工具本身都很有用——但 TeamFlow 把\"理解作业、公平分工、日程安排\"整合成了一套专门为小组作业设计的工作流。",

  // ---- MVP / what's included ----
  "mvp.eyebrow": "现有功能",
  "mvp.title": "TeamFlow 目前已经做到的一切",
  "mvp.item1": "作业上传与 AI 理解",
  "mvp.item2": "自动任务拆解",
  "mvp.item3": "公平、按工作量平衡的任务分配",
  "mvp.item4": "团队管理(增加、删除、编辑成员)",
  "mvp.item5": "风险检测与延误提醒",
  "mvp.item6": "导出为 CSV",
  "mvp.item7": "同步到 Google 表格",
  "mvp.item8": "Google 日历与队友邀请",

  // ---- final CTA ----
  "finalcta.title": "让下一次小组作业更容易管理。",
  "finalcta.sub": "从一份作业开始,把它变成一份公平、可编辑、可追踪的团队计划。",
  "finalcta.primary": "创建团队计划",
  "finalcta.secondary": "查看已完成功能",

  // ---- app.html ----
  "app.eyebrow": "生成团队计划",
  "app.title": "粘贴作业内容,添加你的团队。",
  "app.sub": "TeamFlow 会读取作业内容,为团队生成一份任务计划。确认之前,一切都可以调整。",
  "app.step1.title": "第一步 — 你的作业",
  "app.step1.label": "粘贴作业说明",
  "app.dropzone.title": "把文件拖到这里,或点击选择文件,也可以直接粘贴(Ctrl+V)",
  "app.dropzone.hint": "支持图片、PDF、DOCX、TXT — 最多 4 个文件,每个不超过 3MB",
  "app.requirements.label": "老师的具体要求 / 评分标准(选填)",
  "app.step2.title": "第二步 — 你的团队",
  "app.step2.hint": "技能和空闲时间能帮 TeamFlow 建议更公平的分工",
  "app.teamDropzone.title": "把排班表/名单文件拖到这里,或点击选择,也可以直接粘贴",
  "app.fillFromUpload": "从上传内容识别团队",
  "app.addMember": "+ 添加成员",
  "app.buildPlan": "生成团队计划",
  "app.taskPlan.title": "任务计划",
  "app.taskPlan.hint": "点名字可以改负责人 · 点状态可以更新",
  "app.exportCsv": "导出为 CSV",
  "app.workload.title": "工作量平衡",
  "app.risk.title": "风险提醒",
  "app.step3.title": "第三步 — 保存与分享",
  "app.step3.hint": "连接 Google 账号,把计划保存到表格,并把截止日期加入日历。",
  "app.connectGoogle": "连接 Google",
  "app.saveSheets": "保存到 Google 表格",
  "app.addCalendar": "加入 Google 日历",
  "app.sendReminder": "发送提醒邮件",
  "app.step4.title": "第四步 — 自动邮件提醒",
  "app.step4.hint": "确认真实的截止日期,TeamFlow 会在临近时自动给团队发邮件提醒——不用你再点任何按钮。这个功能独立于 Google,靠的是第二步里填写的邮箱。",
  "app.deadlineDate.label": "确认真实的截止日期",
  "app.enableReminders": "开启自动提醒",
  "app.disableReminders": "关闭提醒",
  "app.step5.title": "第五步 — 跨设备同步",
  "app.step5.hint": "先连接上方的 Google 账号,保存计划到你的账号,换一台设备用同一个 Google 账号登录就能取回。",
  "app.saveAccount": "保存到我的账号",
  "app.loadAccount": "从我的账号加载",
  "app.demoNote": "作业内容、团队信息和任务计划会保存在这个浏览器里,下次打开还在。",
  "app.teamPlan.title": "和团队一起用?",
  "app.teamPlan.hint": "跟整个团队共享同一份计划——有链接的人都能查看和更新,不需要登录。",
  "app.teamPlan.create": "为团队创建共享计划",
  "app.teamPlan.joinPlaceholder": "输入分享码",
  "app.teamPlan.join": "加入",
  "app.teamPlan.copyLink": "复制分享链接",
  "app.teamPlan.refresh": "刷新团队进度",
  "app.teamPlan.leave": "退出共享计划",

  // ---- privacy modal ----
  "privacy.title": "隐私与数据说明",
  "privacy.intro": "这是一个课程项目原型。以下是你的数据具体会怎么被处理——没有账号系统,也没有隐藏的追踪。",
  "privacy.h1": "作业文字与团队信息",
  "privacy.h2": "只保存在本地,仅限这台设备",
  "privacy.h3": "Google 表格、日历与 Gmail",
  "privacy.h4": "CSV 导出",
  "privacy.h5": "自动邮件提醒(第四步)",
  "privacy.h6": "账号同步(第五步)",
  "privacy.h7": "团队共享计划(“和团队一起用?”)",
  "privacy.h8": "我们不会做的事",
  "privacy.notdo": "没有广告,没有第三方追踪,不会出售数据,不需要账号或密码。",
};

function applyLanguage(lang) {
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (!el.dataset.enOriginal) el.dataset.enOriginal = el.innerHTML;
    if (lang === "zh" && ZH_STRINGS[key]) {
      el.textContent = ZH_STRINGS[key];
    } else {
      el.innerHTML = el.dataset.enOriginal;
    }
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (!el.dataset.enPlaceholder) el.dataset.enPlaceholder = el.placeholder;
    if (lang === "zh" && ZH_STRINGS[key]) {
      el.placeholder = ZH_STRINGS[key];
    } else {
      el.placeholder = el.dataset.enPlaceholder;
    }
  });

  document.querySelectorAll(".lang-toggle-btn").forEach((btn) => {
    btn.textContent = lang === "zh" ? "EN" : "中文";
  });

  try {
    localStorage.setItem("teamflow-lang", lang);
  } catch (e) {
    // ignore — non-critical
  }
}

function toggleLanguage() {
  const current = document.documentElement.lang === "zh-CN" ? "zh" : "en";
  applyLanguage(current === "zh" ? "en" : "zh");
}

document.addEventListener("DOMContentLoaded", () => {
  let saved = "en";
  try {
    saved = localStorage.getItem("teamflow-lang") || "en";
  } catch (e) {
    // ignore
  }
  applyLanguage(saved);
});
