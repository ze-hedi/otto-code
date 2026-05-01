// router.ts
// Routes incoming queries to specialized agents.
// Starts with a raw PiAgent — no tools, no default system prompt.

import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
  type AgentSession,
} from "@mariozechner/pi-coding-agent";

import { PiAgent, type EventCallback, type PiAgentConfig } from "./pi-agent";

// ── Raw agent factory ──────────────────────────────────────────────────────────
//
// Creates a PiAgent stripped of:
//   - All tools (noTools: "all" suppresses builtin bash/read/edit/write)
//   - Default Pi system prompt (systemPromptOverride returns undefined)
//
// Achieved by patching _createSession after construction so pi-agent.ts stays
// untouched. The patch replicates the session-manager switch from the original
// and delegates auth, model, and registry to PiAgent's already-initialised
// private fields.

function createRawAgent(
  config: Omit<PiAgentConfig, "tools" | "skills" | "systemPromptSuffix">
): PiAgent {
  const agent = new PiAgent({ ...config, tools: [], skills: [] });

  (agent as any)._createSession = async function (): Promise<AgentSession> {
    let sessionManager: SessionManager;
    switch (this.config.sessionMode) {
      case "disk":
        sessionManager = SessionManager.create(this.config.workingDir);
        break;
      case "continue":
        sessionManager = SessionManager.continueRecent(this.config.workingDir);
        break;
      default:
        sessionManager = SessionManager.inMemory();
    }

    const resourceLoader = new DefaultResourceLoader({
      cwd: this.config.workingDir,
      agentDir: getAgentDir(),
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPromptOverride: () => undefined,
      appendSystemPromptOverride: () => [],
    });
    await resourceLoader.reload();

    const { session } = await createAgentSession({
      model: this.model,
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
      thinkingLevel: this.config.thinkingLevel,
      sessionManager,
      noTools: "all",
      resourceLoader,
    });

    this.currentSession = session;
    return session;
  };

  return agent;
}

// ── Router ─────────────────────────────────────────────────────────────────────

const MODEL = "anthropic/claude-sonnet-4-5";

export async function route(
  query: string,
  onEvent?: EventCallback
): Promise<void> {
  const agent = createRawAgent({
    model: MODEL,
    sessionMode: "memory",
    thinkingLevel: "off",
  });

  await agent.execute(query, onEvent);
}
