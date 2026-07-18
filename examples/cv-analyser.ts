import "dotenv/config";
import fs from "fs";
import path from "path";
import { createInterface } from "readline";
import { RawPiAgent } from "../agents/raw-pi-agent.js";
import type { ImageContent } from "@mariozechner/pi-ai";
import { handleEvent } from "../agents/pi-agent-utils";

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

const agent = new RawPiAgent({
  name: "cv-analyser",
  model: "anthropic/claude-sonnet-4-5",
  systemPrompt,
  builtInTools: ["read", "write", "edit"],
  playground: process.cwd(),
  sessionMode: "memory",
});

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
