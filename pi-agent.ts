// pi-agent.ts
// Clean class-based wrapper for Pi coding agent SDK

import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
  AgentSession,
  AgentEvent,
} from "@mariozechner/pi-coding-agent";
import { getModel, Model } from "@mariozechner/pi-ai";

export interface PiAgentConfig {
  /** Model provider and name, e.g., "anthropic/claude-sonnet-4-5" */
  model: string;

  /** Additional system prompt appended to Pi's default */
  systemPromptSuffix?: string;

  /** Thinking level: "off" | "low" | "medium" | "high" | "xhigh" */
  thinkingLevel?: "off" | "low" | "medium" | "high" | "xhigh";

  /** Optional: override API key at runtime */
  apiKey?: string;

  /** Session persistence: "memory" | "disk" | "continue" */
  sessionMode?: "memory" | "disk" | "continue";

  /** Working directory for disk-based sessions */
  workingDir?: string;
}

export type EventCallback = (event: AgentEvent) => void;

export class PiAgent {
  private authStorage: AuthStorage;
  private modelRegistry: ModelRegistry;
  private model: Model;
  private config: Required<
    Omit<PiAgentConfig, "apiKey" | "workingDir" | "model">
  > & { workingDir: string };
  private currentSession: AgentSession | null = null;

  constructor(config: PiAgentConfig) {
    // Parse model string (format: "provider/model-name")
    const [provider, modelName] = config.model.split("/");
    if (!provider || !modelName) {
      throw new Error(
        `Invalid model format. Expected "provider/model-name", got: ${config.model}`
      );
    }

    // Initialize auth and model registry
    this.authStorage = AuthStorage.create();
    if (config.apiKey) {
      this.authStorage.setRuntimeApiKey(provider, config.apiKey);
    }
    this.modelRegistry = ModelRegistry.create(this.authStorage);

    // Get the model instance
    const model = getModel(provider, modelName);
    if (!model) {
      throw new Error(
        `Model not found: ${config.model}. Check provider and model name.`
      );
    }
    this.model = model;

    // Store config with defaults
    this.config = {
      systemPromptSuffix: config.systemPromptSuffix || "",
      thinkingLevel: config.thinkingLevel || "medium",
      sessionMode: config.sessionMode || "memory",
      workingDir: config.workingDir || process.cwd(),
    };
  }

  /**
   * Create a session (without sending a prompt yet)
   * @returns AgentSession that you can use to send prompts
   */
  private async createSession(): Promise<AgentSession> {
    // Create session manager based on config
    let sessionManager: SessionManager;
    switch (this.config.sessionMode) {
      case "memory":
        sessionManager = SessionManager.inMemory();
        break;
      case "disk":
        sessionManager = SessionManager.create(this.config.workingDir);
        break;
      case "continue":
        sessionManager = SessionManager.continueRecent(this.config.workingDir);
        break;
    }

    // Create new session
    const { session } = await createAgentSession({
      model: this.model,
      sessionManager,
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
      systemPromptSuffix: this.config.systemPromptSuffix,
      thinkingLevel: this.config.thinkingLevel,
    });

    this.currentSession = session;
    return session;
  }

  /**
   * Execute a query and get back a session you can subscribe to
   * @param query The prompt to send to the agent
   * @param onEvent Optional callback for streaming events
   * @returns AgentSession that you can subscribe to or await
   */
  async query(
    query: string,
    onEvent?: EventCallback
  ): Promise<AgentSession> {
    const session = await this.createSession();

    // Attach event callback if provided
    if (onEvent) {
      session.subscribe(onEvent);
    }

    // Start the prompt (non-blocking, streams via subscription)
    session.prompt(query);

    return session;
  }

  /**
   * Shorthand: execute query and wait for completion
   * @param query The prompt to send
   * @param onEvent Optional callback for streaming events
   */
  async execute(query: string, onEvent?: EventCallback): Promise<void> {
    const session = await this.createSession();

    // Attach event callback if provided
    if (onEvent) {
      session.subscribe(onEvent);
    }

    // Send prompt and wait for completion
    await session.prompt(query);
  }

  /**
   * Get the currently active session (if any)
   */
  getCurrentSession(): AgentSession | null {
    return this.currentSession;
  }
}
