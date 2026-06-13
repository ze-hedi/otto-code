import "dotenv/config";
import fs from "fs";
import path from "path";
import { Type } from "typebox";
import { PiAgent, ToolInput } from "../pi-agent.js";
import { activeAgents, sessionAgentMap, workflowEvents } from "../runtime/state.js";

export const subAgentPrompt = fs.readFileSync(
  path.join(import.meta.dirname, "explorer_system_prompt.md"),
  "utf-8"
);

export const orchestratorPrompt = fs.readFileSync(
  path.join(import.meta.dirname, "explorer_orchestrator_prompt.md"),
  "utf-8"
);

export const PLAYGROUND = path.join(process.env.HOME!, "code/otto_code");
export const EXPLORER_MODEL = "deepseek/deepseek-v4-pro";
export const EXPLORER_THINKING: "high" = "high";

// ── explore_repos tool ──────────────────────────────────────────────────────────

export const exploreReposTool: ToolInput = {
  name: "explore_repos",
  label: "Explore Repos",
  description:
    "Fan out exploration to multiple sub-repos in parallel. " +
    "Spawns a stateless explorer agent per repo, each scoped to that repo's directory. " +
    "Returns all exploration reports combined. Use this when the task spans multiple repositories.",
  promptSnippet: "explore_repos: Fan out exploration to multiple sub-repos in parallel",
  promptGuidelines: [
    "When you discover that the playground contains multiple sub-repositories (e.g. separate project directories, monorepo packages, or nested repos), use explore_repos to fan out exploration in parallel rather than exploring each one sequentially yourself.",
    "Typical signal: a top-level directory listing reveals several independent project folders (each with their own package.json, pyproject.toml, go.mod, etc.).",
    "You can also use it when the user explicitly names multiple repos to explore.",
    "Pass the same task to all sub-agents — they each produce a full structured exploration report scoped to their repo.",
  ],
  parameters: Type.Object({
    task: Type.String({ description: "The exploration task/question to investigate in each repo" }),
    repos: Type.Array(Type.String(), {
      description: "List of sub-repo directory paths (relative to playground, or absolute)",
    }),
    directives: Type.Optional(
      Type.String({ description: "Optional scope hints or entry points passed to each sub-agent" })
    ),
  }),
  execute: async (toolCallId, params) => {
    const { task, repos, directives } = params as {
      task: string;
      repos: string[];
      directives?: string;
    };

    // Resolve and validate repo paths
    const resolved = repos.map((r) => (path.isAbsolute(r) ? r : path.join(PLAYGROUND, r)));
    for (const dir of resolved) {
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
        return {
          content: [{ type: "text", text: `Error: "${dir}" is not a valid directory.` }],
        };
      }
    }

    // Create sub-agents and register them in the runtime so the TUI can observe
    const subAgentIds: string[] = [];
    const subAgents: { id: string; agent: PiAgent; repoPath: string; repoName: string; focusPrompt: string }[] = [];

    for (const repoPath of resolved) {
      const repoName = path.basename(repoPath);
      const subId = `explorer-sub-${repoName}`;

      const focusPrompt = [
        `Task: ${task}`,
        `Focus directory: ${repoPath}`,
        `Concentrate your exploration on the directory above, but you have access to the entire playground (${PLAYGROUND}) for cross-referencing dependencies, shared configs, or sibling repos when needed.`,
        ...(directives ? [`Directives: ${directives}`] : []),
      ].join("\n");

      const subAgent = new PiAgent({
        name: `explorer-${repoName}`,
        model: EXPLORER_MODEL,
        systemPromptSuffix: subAgentPrompt,
        builtInTools: ["read", "bash"],
        playground: PLAYGROUND,
        sessionMode: "memory",
        thinkingLevel: EXPLORER_THINKING,
      });

      // Register in runtime so /runtime/agents/:id/observe can tap in
      activeAgents.set(subId, subAgent);
      sessionAgentMap.set(subId, subId);
      subAgentIds.push(subId);
      subAgents.push({ id: subId, agent: subAgent, repoPath, repoName, focusPrompt });

      console.log(`[explore_repos] registered sub-agent "${subId}"`);
    }

    // Create sessions before notifying TUI (so observe endpoint finds them)
    for (const { agent: subAgent } of subAgents) {
      await subAgent.getSession();
    }

    // Notify TUI about the sub-agents before starting execution
    workflowEvents.emit('sub_agents_spawned', { subAgents: subAgentIds });

    // Spawn sub-agents in parallel
    const results = await Promise.all(
      subAgents.map(async ({ id: subId, agent: subAgent, repoPath, repoName, focusPrompt }) => {
        try {
          const start = performance.now();
          console.log(`[explore_repos] starting ${subId}`);
          await subAgent.chat(focusPrompt);
          const elapsed = performance.now() - start;
          console.log(`[explore_repos] ${subId} took ${elapsed.toFixed(0)} ms`);

          // Extract text from the last assistant message
          const messages = await subAgent.getMessages();
          const lastAssistant = messages.filter((m) => m.role === "assistant").at(-1);

          let output = "";
          if (lastAssistant) {
            if (typeof lastAssistant.content === "string") {
              output = lastAssistant.content;
            } else if (Array.isArray(lastAssistant.content)) {
              output = lastAssistant.content
                .filter((b: any) => b.type === "text")
                .map((b: any) => b.text)
                .join("\n");
            }
          }

          return { repoPath, repoName, output, error: null };
        } catch (err) {
          return {
            repoPath,
            repoName,
            output: "",
            error: err instanceof Error ? err.message : String(err),
          };
        }
      })
    );

    // Clean up sub-agents from runtime
    for (const subId of subAgentIds) {
      activeAgents.delete(subId);
      sessionAgentMap.delete(subId);
      console.log(`[explore_repos] cleaned up sub-agent "${subId}"`);
    }

    // Combine reports
    const combined = results
      .map((r) => {
        const header = `## Repo: ${r.repoName} (${r.repoPath})`;
        if (r.error) return `${header}\n\n**Error:** ${r.error}`;
        return `${header}\n\n${r.output}`;
      })
      .join("\n\n---\n\n");

    return { content: [{ type: "text", text: combined }] };
  },
};

// ── Explorer agent ──────────────────────────────────────────────────────────────

export const explorer = new PiAgent({
  name: "explorer",
  model: EXPLORER_MODEL,
  systemPromptSuffix: orchestratorPrompt,
  builtInTools: ["read", "bash"],
  playground: PLAYGROUND,
  sessionMode: "memory",
  thinkingLevel: EXPLORER_THINKING,
  tools: [exploreReposTool],
  handlers: {
  //   onAgentStart: () => console.log("\n[agent] started"),
  //   onAgentEnd: (messages) => console.log(`\n[agent] ended`, JSON.stringify(messages, null, 2)),
  //   onTurnStart: () => console.log("\n[turn] started"),
  //   onTurnEnd: (msg, toolResults) => console.log(`\n[turn] ended`, JSON.stringify({ message: msg, toolResults }, null, 2)),
  //   onMessageStart: (message) => console.log("\n[message:start]", JSON.stringify(message, null, 2)),
  //   onMessageEnd: (message) => console.log("\n[message:end]", JSON.stringify(message, null, 2)),
    onTextDelta: (delta) => process.stdout.write(delta),
  //   onTextEnd: (content, contentIndex) => console.log(`\n[text:end] index=${contentIndex}`, content),
  //   onThinkingDelta: (delta) => process.stdout.write(`\x1b[2m${delta}\x1b[0m`),
  //   onThinkingEnd: (content, contentIndex) => console.log(`\n[thinking:end] index=${contentIndex}`, content),
  //   onToolCallStreamed: (toolCall, contentIndex) => console.log(`\n[toolcall:streamed] index=${contentIndex}`, JSON.stringify(toolCall, null, 2)),
  //   onStreamDone: (reason, message) => console.log(`\n[stream:done] reason=${reason}`, JSON.stringify(message, null, 2)),
  //   onStreamError: (reason, error) => console.error(`\n[stream:error] reason=${reason}`, JSON.stringify(error, null, 2)),
    onToolStart: (id, name, args) => console.log(`\n[tool:start] id=${id} name=${name}`, JSON.stringify(args, null, 2)),
  //   onToolUpdate: (id, name, args, partialResult) => console.log(`\n[tool:update] id=${id} name=${name}`, JSON.stringify({ args, partialResult }, null, 2)),
  //   onToolEnd: (id, name, result, isError) => console.log(`\n[tool:end] id=${id} name=${name} isError=${isError}`, JSON.stringify(result, null, 2)),
  //   onQueueUpdate: (steering, followUp) => console.log(`\n[queue]`, JSON.stringify({ steering, followUp }, null, 2)),
  //   onCompactionStart: (reason) => console.log(`\n[compaction:start] reason=${reason}`),
  //   onCompactionEnd: (reason, result, aborted, willRetry, errorMessage) => console.log(`\n[compaction:end]`, JSON.stringify({ reason, result, aborted, willRetry, errorMessage }, null, 2)),
  //   onSessionNameChanged: (name) => console.log(`\n[session:name] ${name}`),
  //   onRetryStart: (attempt, max, delayMs, msg) => console.log(`\n[retry:start]`, JSON.stringify({ attempt, max, delayMs, msg }, null, 2)),
  //   onRetryEnd: (success, attempt, finalError) => console.log(`\n[retry:end]`, JSON.stringify({ success, attempt, finalError }, null, 2)),
  //   onEvent: (event) => {
  //     if (!["message_update", "message_start", "message_end", "turn_start", "turn_end", "agent_start", "agent_end", "tool_execution_start", "tool_execution_update", "tool_execution_end", "queue_update", "compaction_start", "compaction_end", "session_info_changed", "auto_retry_start", "auto_retry_end"].includes(event.type)) {
  //       console.log(`\n[event:unhandled] type=${event.type}`, JSON.stringify(event, null, 2));
  //     }
  //   },
  },
});


// CLI entry point — only runs when this file is executed directly
const isDirectRun = process.argv[1]?.includes("explorer");
if (isDirectRun) {
  const readline = await import("readline");

  console.log("system prompt ");
  const session = await explorer.getSession();
  console.log(session.systemPrompt);

  while (true) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const answer = await new Promise<string>((resolve) => {
      rl.question("enter query ", resolve);
    });

    if (answer === "exit") {
      rl.close();
      break;
    }

    await explorer.chat(answer);
  }
}

