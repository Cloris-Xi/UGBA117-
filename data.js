// -----------------------------------------------------------------------
// LOCAL MOCK DATA — for visual prototype only.
//
// In the real product, this data would come from:
//  - The assignment-understanding AI step (deadline, deliverables, criteria)
//  - The team-input form (skills, interests, availability)
//  - The task-allocation AI logic (owner suggestions + workload estimates)
//
// Real AI integration would be added here, e.g. a call to an assignment-
// parsing endpoint and a task-matching model. No API keys or backend
// calls are made in this prototype — everything below is static sample data.
// -----------------------------------------------------------------------

const TEAM = [
  { id: "alex", name: "Alex", color: "#E7B94A" },
  { id: "maya", name: "Maya", color: "#5F7A5E" },
  { id: "leo",  name: "Leo",  color: "#B3514A" },
  { id: "nina", name: "Nina", color: "#7C8FA6" },
];

// status: "todo" | "progress" | "done"
const INITIAL_TASKS = [
  { id: "t1", name: "Background research",  owner: "alex", hours: 1.5, due: "Day 3",  status: "done" },
  { id: "t2", name: "Case analysis",         owner: "leo",  hours: 2,   due: "Day 5",  status: "progress", delayed: true },
  { id: "t3", name: "Data analysis",         owner: "nina", hours: 1.5, due: "Day 6",  status: "progress" },
  { id: "t4", name: "Slide design",          owner: "maya", hours: 2,   due: "Day 8",  status: "todo", blockedBy: "t2" },
  { id: "t5", name: "Script writing",        owner: "leo",  hours: 1.5, due: "Day 8",  status: "todo" },
  { id: "t6", name: "Reference formatting",  owner: "alex", hours: 0.5, due: "Day 9",  status: "todo" },
  { id: "t7", name: "Rehearsal",             owner: "maya", hours: 1,   due: "Day 12", status: "todo" },
  { id: "t8", name: "Final review",          owner: "nina", hours: 1,   due: "Day 13", status: "todo" },
];
