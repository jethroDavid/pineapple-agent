import type {
  ShortcutWorkflow,
  ShortcutWorkflowState
} from "./shortcut-client-schemas.js";

export function findShortcutWorkflowStateByName(
  workflows: ShortcutWorkflow[],
  workflowStateName: string
): ShortcutWorkflowState | null {
  const normalizedName = workflowStateName.trim().toLowerCase();

  if (normalizedName.length === 0) {
    return null;
  }

  for (const workflow of workflows) {
    const state = workflow.states.find(
      (entry) => entry.name.trim().toLowerCase() === normalizedName
    );

    if (state) {
      return state;
    }
  }

  return null;
}

export function findShortcutWorkflowStateName(
  workflows: ShortcutWorkflow[],
  workflowStateId: string | null
): string | null {
  if (workflowStateId === null) {
    return null;
  }

  for (const workflow of workflows) {
    const state = workflow.states.find((entry) => entry.id === workflowStateId);

    if (state) {
      return state.name;
    }
  }

  return null;
}
