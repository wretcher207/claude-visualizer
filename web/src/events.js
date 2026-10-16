// What kind of work a tool call is. Scenes and sounds react to the kind,
// not the exact tool, so new tools still land somewhere sensible.

const CATEGORY = {
  Read: 'explore',
  Grep: 'explore',
  Glob: 'explore',
  LS: 'explore',
  WebFetch: 'explore',
  WebSearch: 'explore',
  ToolSearch: 'explore',
  NotebookRead: 'explore',

  Edit: 'change',
  Write: 'change',
  MultiEdit: 'change',
  NotebookEdit: 'change',

  Bash: 'run',
  PowerShell: 'run',
  Monitor: 'run',
  BashOutput: 'run',
  KillShell: 'run',

  Agent: 'delegate',
  Task: 'delegate',
  Workflow: 'delegate',

  TodoWrite: 'plan',
  TaskCreate: 'plan',
  TaskUpdate: 'plan',
  EnterPlanMode: 'plan',
  Skill: 'plan',

  AskUserQuestion: 'ask',
  ExitPlanMode: 'ask',
};

export function toolCategory(toolName) {
  if (!toolName) return 'other';
  if (CATEGORY[toolName]) return CATEGORY[toolName];
  if (toolName.startsWith('mcp__')) return 'external';
  return 'other';
}

// Tools where Claude stops and waits for the person to answer.
export function isAskTool(toolName) {
  return toolCategory(toolName) === 'ask';
}

// How much a tool call moves the journey along.
export const WORK_WEIGHT = {
  explore: 1,
  change: 1.2,
  run: 1.2,
  delegate: 2,
  plan: 0.5,
  ask: 0.5,
  external: 1,
  other: 0.8,
};

// How much a tool call stirs the water.
export const ENERGY_IMPULSE = {
  explore: 0.06,
  change: 0.1,
  run: 0.1,
  delegate: 0.16,
  plan: 0.04,
  ask: 0.03,
  external: 0.07,
  other: 0.05,
};
