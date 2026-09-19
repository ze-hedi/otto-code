import { Type } from "typebox";
import { RawPiAgent } from "./raw-pi-agent.js";
import type { EventCallback, ToolInput } from "./pi-agent-types.js";

export interface MeetingTurn {
  round: number;
  agentName: string;
  message: string;
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

  constructor(
    agents: { agent: RawPiAgent; name: string; description: string }[],
    goal: string,
  ) {
    this.goal = goal;
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
    const meetingBlock = `\n\n# Meeting\n\n## Goal\n${this.goal}\n\n## Participants\n${participantLines.join("\n")}\n\nYou are participating in a round-robin discussion. Each message you receive tagged with [Name] is from that participant. Respond thoughtfully and build on what others say.`;

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

  async run(maxRounds: number = 10, onEvent?: EventCallback): Promise<MeetingTranscript> {
    await this._setup();
    this.transcript = [];

    for (let round = 1; round <= maxRounds; round++) {
      for (const speaker of this.agents) {
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

        this.transcript.push({ round, agentName: speaker.name, message: text });

        if (this.agents.every((a) => a.votedConsensus)) {
          return { goal: this.goal, rounds: round, turns: this.transcript, reachedConsensus: true };
        }
      }
    }

    return { goal: this.goal, rounds: maxRounds, turns: this.transcript, reachedConsensus: false };
  }
}
