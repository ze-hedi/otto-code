import "dotenv/config";
import fs from "fs";
import path from "path";
import {Type} from "typebox" ;
import { createInterface } from "readline";
import { RawPiAgent } from "../agents/raw-pi-agent.js";
import type { ImageContent } from "@mariozechner/pi-ai";
import { handleEvent } from "../agents/pi-agent-utils";
import {createSubAgentTool} from "../agents/sub-agent-pattern"


const systemPrompt = `You are a CV/resume analysis agent. Your job is to analyze a candidate's CV provided as an image and produce a structured summary.

## if the user request is about doing a full analysis of cv then your output format should be as follows : 

Produce the following sections:

### Identity
- Full name
- Contact info (email, phone, location, LinkedIn — whatever is visible)

### Professional Summary
A 2-3 sentence summary of who this candidate is professionally.

### Experience
For each position (most recent first):
- Company, title, dates
- Key responsibilities and achievements (bullet points)

### Education
- Degree, institution, dates

### Skills
- Technical skills
- Languages
- Certifications

### Assessment
A brief (3-5 sentence) assessment of the candidate's profile: strengths, gaps, seniority level, and what roles they'd be a good fit for.

If the user is asking for a specific details about the candidate experience or any other info in the cv you need to act like an assistant and give a well scoped reponse

## Rules
- Extract only what is explicitly visible in the CV. Never invent or assume information.
- If a section is missing from the CV, say "Not provided".
- Use the file tools (read, write, edit) if you need to save the analysis to a file.
`;

// ── Sub-agent: interview preparer ───────────────────────────────────────────

const sub_agent_systemPrompt = `
  You are an expert recruiter in the tech. you work in an HR team.
  Other team members will analyze the cv deeply and provide with a detailed description of the profile.
  Your mission will be establishing a clear roadmap of question that will help the interviewer conduct the interview with the candidate,
  You need to think deep about the profile, identifying key points on which we can focus and then writing a full report that the interviewer will use to direct the interview.
  These questions can go from the background of the candidate, prior experiences and about technical skills.
  the interview won't be a fully technical interview but more of preselection first interview that is supposed to help the recruiter.
  So you need to keep in mind that the recruiter is not a technical expert but familiar enough with technical concepts to be able to ask technical question and understand concepts on a high level

  After thinking, doing the necessary intermidiate steps to build yourself enough context, your final response should in the following format :

  ##Overview
    An overview about the profile
  ## Points to focus on
    a quick guide to the points to focus on during interview in bullet points
  ## questions :
    Intrest questions that the interviewer can ask the candidate.
    This section can be divided into multiple subsections
`;

const interviwer_pi_agent = new RawPiAgent({
  name: "interview_questions_preparation",
  model: "deepseek/deepseek-v4-pro",
  systemPrompt: sub_agent_systemPrompt,
  builtInTools: ["read", "write", "edit"],
  playground: process.cwd(),
  sessionMode: "memory",
});

const interviewTool = createSubAgentTool({
  agent: interviwer_pi_agent,
  name: "interview_preparator",
  description: "a sub agent dedicated to prepare a report that will help tech recruiter conduct an interview",
  parameters: Type.Object({
    context: Type.String({ description: "A detailed description of the candidate profile including experience, degrees, and skills" }),
    keypoints: Type.Optional(Type.Array(Type.String(), { description: "Specific key points to focus on during the interview" })),
  }),
  promptSnippet: "delegates to a recruiter sub-agent that builds an interview roadmap from a candidate profile",
  promptGuidelines: [
    "Call this tool after you have completed the CV analysis and have a full picture of the candidate",
    "Pass a thorough context covering experience, degrees, skills, and any notable gaps or strengths you identified",
    "Use keypoints to steer the sub-agent toward areas that deserve deeper questioning (e.g. a career gap, a tech stack mismatch, a claim that needs probing)",
    "Do not pass raw CV text — summarize and structure the profile yourself before delegating",
    "Present the sub-agent's report to the user as-is; do not rewrite or summarize it",
  ],
});

// ── Main agent ──────────────────────────────────────────────────────────────

const agent = new RawPiAgent({
  name: "cv-analyser",
  model: "anthropic/claude-sonnet-4-5",
  systemPrompt,
  builtInTools: ["read", "write", "edit"],
  playground: process.cwd(),
  sessionMode: "memory",
  tools: [interviewTool],
});

const sys_prompt = await agent.getSystemPrompt() ;
console.log(sys_prompt);

const session = await agent.getSession();
console.log("\n--- Tool Schemas ---\n");
for (const tool of session.getAllTools()) {
  console.log(`${tool.name}:`);
  console.log(JSON.stringify(tool.parameters, null, 2));
  console.log();
}

// ── CLI entry point ──────────────────────────────────────────────────────────

const pngPath = process.argv[2];
if (!pngPath) {
  console.error("Usage: npx tsx examples/cv-analyser.ts <path-to-cv.png>");
  process.exit(1);
}

const resolved = path.resolve(pngPath);
if (!fs.existsSync(resolved)) {
  console.error(`File not found: ${resolved}`);
  process.exit(1);
}

const ext = path.extname(resolved).toLowerCase();
const mimeTypes: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};
const mimeType = mimeTypes[ext];
if (!mimeType) {
  console.error(`Unsupported image format: ${ext}. Use png, jpg, gif, or webp.`);
  process.exit(1);
}

 
const data = fs.readFileSync(resolved).toString("base64");
const image: ImageContent = { type: "image", data, mimeType };

await agent.execute("Analyze this CV and produce a structured summary.",
  [image],
  handleEvent,
  );

console.log("\n");

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (prompt: string) => new Promise<string>((resolve) => rl.question(prompt, resolve));

while (true) {
  const input = await ask("\nYou: ");
  if (!input || input.toLowerCase() === "exit") break;
  await agent.chat(input, handleEvent);
}

rl.close();
process.exit(0);
