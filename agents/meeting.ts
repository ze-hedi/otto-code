import { Type } from "typebox";
import { RawPiAgent } from "./raw-pi-agent.js";
import type { EventCallback, ToolInput } from "./pi-agent-types.js";
import { JevAgent, type JevDecision, type JevDecisionInput } from "./jev-agent.js";
import type { JevConfig } from "./jev-agent-configs.js";

export type MeetingRouter = "round-robin" | "jev";

export interface MeetingOptions {
  /** How the next speaker is chosen. Defaults to "round-robin". */
  router?: MeetingRouter;
  /** Config of the Jev used when router is "jev" (apiKey, instructions) */
  jev?: JevConfig;
  /** Replaces the Jev client, for tests */
  jevDecide?: (input: JevDecisionInput) => Promise<JevDecision>;
  /** How many past turns are sent to Jev as context. Defaults to 12. */
  contextTurns?: number;
}

const JEV_ROUTER_INSTRUCTIONS =
  "Given the meeting so far, which participant should speak next? Prefer whoever was addressed in the last message or whose expertise it needs.";

export interface MeetingTurn {
  round: number;
  agentName: string;
  message: string;
  routedBy?: MeetingRouter;
  /** Jev's confidence in this speaker, when routedBy is "jev" */
  confidence?: number;
}

export interface MeetingTranscript {
  goal: string;
  rounds: number;
  turns: MeetingTurn[];
  reachedConsensus: boolean;
}

export class Meeting {
  private agents: { name: string; description: string; agent: RawPiAgent; originalPrompt: string; votedConsensus: boolean; lastConsensusMessage: string }[];
  private goal: string;
  private sessionKey = "meeting";
  private transcript: MeetingTurn[] = [];
  private router: MeetingRouter;
  private contextTurns: number;
  private jevDecide?: (input: JevDecisionInput) => Promise<JevDecision>;

  constructor(
    agents: { agent: RawPiAgent; name: string; description: string }[],
    goal: string,
    options: MeetingOptions = {},
  ) {
    this.goal = goal;
    this.router = options.router ?? "round-robin";
    this.contextTurns = options.contextTurns ?? 12;
    if (this.router === "jev") {
      this.jevDecide =
        options.jevDecide ??
        ((input) =>
          new JevAgent({ ...options.jev, type: "choice", instructions: options.jev?.instructions ?? JEV_ROUTER_INSTRUCTIONS }).decide(input));
    }
    this.agents = agents.map((a) => ({
      ...a,
      originalPrompt: a.agent._baseSystemPrompt ?? "",
      votedConsensus: false,
      lastConsensusMessage: "",
    }));
  }

  private async _setup(): Promise<void> {
    const participantLines = this.agents.map(
      (a) => `- **${a.name}**: ${a.description}`
    );
    const meetingBlock = `\n\n# Meeting\n\n## Goal\n${this.goal}\n\n## Participants\n${participantLines.join("\n")}\n\nYou are participating in a ${this.router === "jev" ? "moderated" : "round-robin"} discussion. Each message you receive tagged with [Name] is from that participant. Respond thoughtfully and build on what others say.`;

    for (const a of this.agents) {
      // Set augmented system prompt, create meeting session, then restore
      a.agent._baseSystemPrompt = a.originalPrompt + meetingBlock;

      // Register consensus tool
      const self = a;
      a.agent.registerTool({
        name: "declare_consensus",
        label: "Declare Consensus",
        description: "Call this when you believe the meeting has reached consensus. Provide a brief closing message summarizing your agreement and readiness to move forward. The meeting ends when ALL participants have declared consensus.",
        parameters: Type.Object({
          message: Type.String({ description: "Your closing message: confirm you agree, briefly summarize what was decided, and state you're ready to move forward." }),
        }),
        terminate: true,
        execute: async (_toolCallId, params) => {
          self.votedConsensus = true;
          self.lastConsensusMessage = params.message;
          return { content: [{ type: "text", text: "Consensus declared." }] };
        },
      });

      await a.agent.createNewSession(this.sessionKey);

      // Restore original prompt so other sessions aren't affected
      a.agent._baseSystemPrompt = a.originalPrompt;
    }
  }

  private _extractLastAssistantText(messages: any[]): string {
    const last = messages.filter((m: any) => m.role === "assistant").at(-1);
    if (!last) return "";
    if (typeof last.content === "string") return last.content;
    if (Array.isArray(last.content)) {
      return last.content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("\n");
    }
    return "";
  }

  /** Builds the context Jev routes on: goal, who is left, who spoke last and the recent transcript. */
  private _jevContext(eligible: Meeting["agents"]): string {
    const recent = this.transcript.slice(-this.contextTurns);
    const lines = recent.map((t) => `[${t.agentName}]: ${t.message}`);
    const omitted = this.transcript.length - recent.length;
    const last = this.transcript.at(-1);
    return [
      `Meeting goal: ${this.goal}`,
      `Participants still discussing: ${eligible.map((a) => a.name).join(", ")}`,
      `Last speaker: ${last?.agentName ?? "none"}`,
      `Transcript${omitted > 0 ? ` (last ${recent.length} of ${this.transcript.length} turns)` : ""}:`,
      ...lines,
    ].join("\n");
  }

  private async _pickNextSpeaker(turn: number): Promise<{ speaker: Meeting["agents"][number]; routedBy: MeetingRouter; confidence?: number }> {
    const roundRobin = () => ({ speaker: this.agents[turn % this.agents.length], routedBy: "round-robin" as const });
    if (this.router === "round-robin" || this.transcript.length === 0) return roundRobin();

    // Agents that declared consensus are no longer choices.
    let eligible = this.agents.filter((a) => !a.votedConsensus);
    const lastName = this.transcript.at(-1)?.agentName;
    if (eligible.length > 1) eligible = eligible.filter((a) => a.name !== lastName);
    if (eligible.length === 1) return { speaker: eligible[0], routedBy: "jev" };

    try {
      const decision = await this.jevDecide!({
        context: this._jevContext(eligible),
        options: eligible.map((a) => ({ id: a.name, description: a.description })),
      });
      const speaker = eligible.find((a) => a.name === decision.choice);
      if (!speaker) throw new Error(`Jev picked unknown participant "${decision.choice}"`);
      return { speaker, routedBy: "jev", confidence: decision.confidence };
    } catch (err) {
      console.warn(`[meeting] Jev routing failed, falling back to round-robin: ${(err as Error).message}`);
      // Next agent in order that has not voted
      for (let i = 0; i < this.agents.length; i++) {
        const candidate = this.agents[(turn + i) % this.agents.length];
        if (!candidate.votedConsensus) return { speaker: candidate, routedBy: "round-robin" };
      }
      return roundRobin();
    }
  }

  async run(maxRounds: number = 10, onEvent?: EventCallback): Promise<MeetingTranscript> {
    await this._setup();
    this.transcript = [];

    const totalTurns = maxRounds * this.agents.length;
    for (let turn = 0; turn < totalTurns; turn++) {
      const round = Math.floor(turn / this.agents.length) + 1;
      const { speaker, routedBy, confidence } = await this._pickNextSpeaker(turn);

      let prompt: string;
      if (this.transcript.length === 0) {
        prompt = "You are the first to speak. Open the discussion on the meeting goal.";
      } else {
        const lastTurn = this.transcript[this.transcript.length - 1];
        prompt = `[${lastTurn.agentName}]: ${lastTurn.message}`;
      }

      await speaker.agent.chat(prompt, onEvent, this.sessionKey);
      const messages = await speaker.agent.getMessages(this.sessionKey);
      const text = this._extractLastAssistantText(messages) || speaker.lastConsensusMessage;

      this.transcript.push({ round, agentName: speaker.name, message: text, routedBy, ...(confidence !== undefined && { confidence }) });

      if (this.agents.every((a) => a.votedConsensus)) {
        return { goal: this.goal, rounds: round, turns: this.transcript, reachedConsensus: true };
      }
    }

    return { goal: this.goal, rounds: maxRounds, turns: this.transcript, reachedConsensus: false };
  }
}
