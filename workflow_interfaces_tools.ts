// workflow_interfaces_tools.ts
// Workflow interface tools — forced output format definitions for inter-agent communication.

import { Type } from 'typebox';
import type { ToolInput } from './pi-agent.js';

/**
 * Briefing tool definition.
 * Forces the agent to dump a structured briefing about what it has done so far.
 */
export const briefingTool: ToolInput = {
  name: 'submit_briefing',
  label: 'Submit Briefing',
  description:
    'REQUIRED: You must call this tool to submit a structured briefing about what you have accomplished so far. ' +
    'Include a summary of completed work, current status, key findings, and suggested next steps.',
  parameters: Type.Object({
    title: Type.String({ description: 'Short title for this briefing' }),
    summary: Type.String({ description: 'Brief overview of what was accomplished' }),
    completedSteps: Type.Array(Type.String(), { description: 'List of steps/tasks completed' }),
    currentStatus: Type.String({ description: 'Current state of the work (e.g. "in progress", "blocked", "complete")' }),
    keyFindings: Type.Array(Type.String(), { description: 'Important findings or observations' }),
    nextSteps: Type.Array(Type.String(), { description: 'Recommended next actions' }),
  }),
};

/**
 * Report tool definition.
 * Forces the agent to produce a detailed article-style report covering the original query,
 * the reasoning process, each step taken, and the conclusions reached.
 */
export const reportTool: ToolInput = {
  name: 'submit_report',
  label: 'Submit Report',
  description:
    'REQUIRED: You must call this tool to submit a detailed report. ' +
    'Write it like an article: start with the original query/problem, explain your reasoning process, ' +
    'detail each step you took and why, describe what you found at each stage, and conclude with the final outcome.',
  parameters: Type.Object({
    title: Type.String({ description: 'Report title' }),
    originalQuery: Type.String({ description: 'The original question or task that was given' }),
    reasoning: Type.String({ description: 'Detailed explanation of your thought process and approach' }),
    steps: Type.Array(
      Type.Object({
        step: Type.String({ description: 'What was done in this step' }),
        rationale: Type.String({ description: 'Why this step was taken' }),
        outcome: Type.String({ description: 'What resulted from this step' }),
      }),
      { description: 'Ordered list of steps taken with rationale and outcome for each' }
    ),
    conclusion: Type.String({ description: 'Final outcome, answer, or deliverable' }),
    openQuestions: Type.Array(Type.String(), { description: 'Unresolved questions or areas needing further investigation' }),
  }),
};

/**
 * Plan tool definition.
 * Forces the agent to produce a structured action plan with ordered steps,
 * dependencies, and success criteria.
 */
export const planTool: ToolInput = {
  name: 'submit_plan',
  label: 'Submit Plan',
  description:
    'REQUIRED: You must call this tool to submit a structured action plan. ' +
    'Break down the work into clear ordered steps with dependencies and success criteria.',
  parameters: Type.Object({
    title: Type.String({ description: 'Plan title' }),
    objective: Type.String({ description: 'The overall objective this plan aims to achieve' }),
    steps: Type.Array(
      Type.Object({
        order: Type.Number({ description: 'Step number (execution order)' }),
        action: Type.String({ description: 'What needs to be done in this step' }),
        details: Type.String({ description: 'Detailed description of how to execute this step' }),
        dependsOn: Type.Array(Type.Number(), { description: 'Step numbers that must complete before this one' }),
        successCriteria: Type.String({ description: 'How to know this step is done correctly' }),
      }),
      { description: 'Ordered list of steps to execute' }
    ),
    risks: Type.Array(Type.String(), { description: 'Potential risks or blockers' }),
    estimatedComplexity: Type.String({ description: 'Overall complexity: "low", "medium", or "high"' }),
  }),
};

/**
 * Delegate tool factory.
 * Forces the agent to produce a detailed task delegation breakdown per sub-agent.
 * Must be called with the dict of available sub-agents (name → description).
 */
/** All interface tool names — single source of truth for hook matching. */
export const INTERFACE_TOOL_NAMES = [
  'submit_briefing',
  'submit_plan',
  'submit_report',
  'submit_delegation',
] as const;

export type InterfaceToolName = (typeof INTERFACE_TOOL_NAMES)[number];

export function createDelegateTool(subAgents: Record<string, string>): ToolInput {
  const agentNames = Object.keys(subAgents);
  const agentList = agentNames.map((name) => `- ${name}: ${subAgents[name]}`).join('\n');

  return {
    name: 'submit_delegation',
    label: 'Submit Delegation',
    description:
      'REQUIRED: You must call this tool to delegate tasks to sub-agents. ' +
      'For each sub-agent, provide a detailed task description, context they need, and expected deliverable.\n\n' +
      `Available sub-agents:\n${agentList}`,
    parameters: Type.Object({
      goal: Type.String({ description: 'The overall goal this delegation aims to achieve' }),
      delegations: Type.Array(
        Type.Object({
          agentName: Type.String({ description: `Name of the sub-agent (one of: ${agentNames.join(', ')})` }),
          task: Type.String({ description: 'Detailed description of the task to perform' }),
          context: Type.String({ description: 'Background context the agent needs to complete the task' }),
          expectedOutput: Type.String({ description: 'What the agent should deliver when done' }),
          priority: Type.String({ description: 'Priority level: "high", "medium", or "low"' }),
        }),
        { description: 'List of task delegations, one per sub-agent' }
      ),
    }),
  };
}
