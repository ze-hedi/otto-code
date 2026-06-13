import "dotenv/config";
import readline from "readline"
import fs from "fs";
import path from "path";
import { Type } from "typebox";
import { PiAgent, ToolInput } from "../pi-agent.js";

const subAgentPrompt = fs.readFileSync(
  path.join(import.meta.dirname, "explorer_system_prompt.md"),
  "utf-8"
);

const orchestratorPrompt = fs.readFileSync(
  path.join(import.meta.dirname, "explorer_orchestrator_prompt.md"),
  "utf-8"
);

const PLAYGROUND = path.join(process.env.HOME!, "code/otto_code");
const MODEL = "deepseek/deepseek-v4-pro";
const THINKING: "high" = "high";

// ── explore_repos tool ──────────────────────────────────────────────────────────

const exploreReposTool: ToolInput = {
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

    // Spawn sub-agents in parallel — each shares the orchestrator's playground
    // so they retain the bigger picture. The repo focus is in the prompt.
    const results = await Promise.all(
      resolved.map(async (repoPath) => {
        const repoName = path.basename(repoPath);

        const focusPrompt = [
          `Task: ${task}`,
          `Focus directory: ${repoPath}`,
          `Concentrate your exploration on the directory above, but you have access to the entire playground (${PLAYGROUND}) for cross-referencing dependencies, shared configs, or sibling repos when needed.`,
          ...(directives ? [`Directives: ${directives}`] : []),
        ].join("\n");

        try {
          const subAgent = new PiAgent({
            name: `explorer-${repoName}`,
            model: MODEL,
            systemPromptSuffix: subAgentPrompt,
            playground: PLAYGROUND,
            sessionMode: "memory",
            thinkingLevel: THINKING,
            // No tools — sub-agents are leaf explorers, no recursion
          });


          console.log({
            name: `explorer-${repoName}`,
            model: MODEL,
            systemPromptSuffix: subAgentPrompt,
            playground: PLAYGROUND,
            sessionMode: "memory",
            thinkingLevel: THINKING,
            // No tools — sub-agents are leaf explorers, no recursion
          })

          const start = performance.now();
          console.log("sub prompt ", focusPrompt);
          await subAgent.execute(focusPrompt);
          const elapsed = performance.now() - start; // milliseconds (float)
          console.log(`Took ${elapsed.toFixed(3)} ms`);

          // Extract text from the last assistant message only (the final report)
          const messages = await subAgent.getMessages();
          console.log(`[${repoName}] total messages: ${messages.length}`, messages.map(m => ({ role: m.role, contentPreview: typeof m.content === 'string' ? m.content.slice(0, 200) : Array.isArray(m.content) ? m.content.map((b: any) => b.type).join(',') : '???' })));
          const lastAssistant = messages.filter((m) => m.role === "assistant").at(-1);
          console.log(`[${repoName}] lastAssistant:`, JSON.stringify(lastAssistant, null, 2).slice(0, 1000));
          
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

    // Combine reports
    const combined = results
      .map((r) => {
        const header = `## Repo: ${r.repoName} (${r.repoPath})`;
        if (r.error) return `${header}\n\n**Error:** ${r.error}`;
        return `${header}\n\n${r.output}`;
      })
      .join("\n\n---\n\n");


    console.log("sub agents results combined ") ; 
    console.log(combined) ; 
    return { content: [{ type: "text", text: combined }] };
  },
};

// ── Explorer agent ──────────────────────────────────────────────────────────────

export const explorer = new PiAgent({
  name: "explorer",
  model: MODEL,
  systemPromptSuffix: orchestratorPrompt,
  playground: PLAYGROUND,
  sessionMode: "memory",
  thinkingLevel: THINKING,
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


console.log("system prompt ")
const session = await explorer.getSession();
console.log(session.systemPrompt);
// console.log("\n\n=== TOOLS ===\n");
// console.log(JSON.stringify(session.getAllTools(), null, 2));


// console.log("\n\n\n") ;   
// explorer.execute("explore the whole code base. Before delegating to sub agent. you need to do a rapid scan of the whole code base to identify different "+
//   "elevant parts or repos then you can get the explorer sub agents to do check these parts. One your analysis is done i want to generate an artifact called code_overview.md that will be fed to wiki creator agent. "+
//   "The wiki creator agent is an agent that is supposed to create a wiki like repo with multiple md files that keep an overview with details about the code. that will be used by other agent when they start exploring the code instead of doing grep that consumes lots of tokens for nothing ")

while (true)
{

  const rl = readline.createInterface({
    input : process.stdin, 
    output : process.stdout
  }) ; 
  const answer = await new Promise<string>((resolve) => {
    rl.question("enter query " , resolve) ;
  }); 
  
  if (answer == "exit")
  {
    rl.close() ; 
    break ; 

  }
  
  await explorer.chat(
    answer 
    
  );

}

