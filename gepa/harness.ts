// gepa/harness.ts
// On-disk representation of an agent harness (the GEPA "candidate").
// Only the text parts live here: system prompt, tool schema text, skills.
// Tool execute functions and parameter *structure* stay in code and are never mutated.
//
// Layout of a candidate directory:
//   <dir>/system_prompt.md
//   <dir>/tools.json              { [toolName]: ToolSchemaText }
//   <dir>/skills/<name>/SKILL.md  (plus any scripts/references the skill ships)

import fs from "fs";
import path from "path";
import type { ToolInput } from "../agents/pi-agent-types.js";

export interface ToolSchemaText {
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  /** JSON schema of the parameters. Only `description` fields may be edited. */
  parameters?: any;
}

export interface Skill {
  name: string;
  description: string;
  body: string;
  /** Other files shipped with the skill (relative paths), read-only for the reflector */
  extraFiles: string[];
}

export interface Harness {
  systemPrompt: string;
  tools: Record<string, ToolSchemaText>;
  skills: Record<string, Skill>;
}

const SKILL_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// ── Paths ──────────────────────────────────────────────────────────────────────

const systemPromptPath = (dir: string) => path.join(dir, "system_prompt.md");
const toolsPath = (dir: string) => path.join(dir, "tools.json");
const skillsDir = (dir: string) => path.join(dir, "skills");

export function skillDir(dir: string, name: string): string {
  if (!SKILL_NAME_RE.test(name)) {
    throw new Error(`Invalid skill name "${name}": use lowercase kebab-case (e.g. "cite-articles")`);
  }
  return path.join(skillsDir(dir), name);
}

// ── Load / save ────────────────────────────────────────────────────────────────

export function loadSystemPrompt(dir: string): string {
  const p = systemPromptPath(dir);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

export function saveSystemPrompt(dir: string, content: string): void {
  fs.writeFileSync(systemPromptPath(dir), content);
}

export function loadTools(dir: string): Record<string, ToolSchemaText> {
  const p = toolsPath(dir);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : {};
}

export function saveTools(dir: string, tools: Record<string, ToolSchemaText>): void {
  fs.writeFileSync(toolsPath(dir), JSON.stringify(tools, null, 2) + "\n");
}

export function parseSkillFile(text: string): { name?: string; description: string; body: string } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { description: "", body: text };
  const field = (key: string) => {
    const raw = m[1].match(new RegExp(`^${key}:[ \\t]*(.*)$`, "m"))?.[1].trim();
    if (raw === undefined) return undefined;
    return raw.startsWith('"') ? JSON.parse(raw) : raw;
  };
  return { name: field("name"), description: field("description") ?? "", body: m[2] };
}

export function renderSkillFile(name: string, description: string, body: string): string {
  // JSON string = valid YAML double-quoted scalar, so colons/quotes in the description are safe
  const desc = JSON.stringify(description.replace(/\s*\n\s*/g, " ").trim());
  return `---\nname: ${name}\ndescription: ${desc}\n---\n\n${body.trim()}\n`;
}

function listFiles(root: string, rel = ""): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const p = path.join(rel, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(root, p));
    else out.push(p);
  }
  return out;
}

export function loadSkills(dir: string): Record<string, Skill> {
  const root = skillsDir(dir);
  const skills: Record<string, Skill> = {};
  if (!fs.existsSync(root)) return skills;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name, "SKILL.md");
    if (!entry.isDirectory() || !fs.existsSync(file)) continue;
    const { description, body } = parseSkillFile(fs.readFileSync(file, "utf8"));
    const extraFiles = listFiles(path.join(root, entry.name)).filter((f) => f !== "SKILL.md");
    skills[entry.name] = { name: entry.name, description, body, extraFiles };
  }
  return skills;
}

export function writeSkill(dir: string, name: string, description: string, body: string): void {
  const d = skillDir(dir, name);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "SKILL.md"), renderSkillFile(name, description, body));
}

export function loadHarness(dir: string): Harness {
  return { systemPrompt: loadSystemPrompt(dir), tools: loadTools(dir), skills: loadSkills(dir) };
}

// ── Seed / apply ───────────────────────────────────────────────────────────────

/** Create the initial candidate (GEPA seed) from an existing agent's harness. */
export function seedHarness(
  dir: string,
  seed: { systemPrompt: string; tools?: ToolInput[]; skills?: string[] },
): void {
  fs.mkdirSync(skillsDir(dir), { recursive: true });
  saveSystemPrompt(dir, seed.systemPrompt);

  const tools: Record<string, ToolSchemaText> = {};
  for (const t of seed.tools ?? []) {
    tools[t.name] = {
      description: t.description,
      promptSnippet: t.promptSnippet,
      promptGuidelines: t.promptGuidelines,
      // JSON round-trip drops TypeBox's symbol keys — fine, structure comes from code at apply time
      parameters: t.parameters ? JSON.parse(JSON.stringify(t.parameters)) : undefined,
    };
  }
  saveTools(dir, tools);

  for (const src of seed.skills ?? []) {
    fs.cpSync(src, path.join(skillsDir(dir), path.basename(src)), { recursive: true });
  }
}

/** Copy only `description` strings from the edited schema onto the original (keeps TypeBox symbols). */
function withDescriptions(orig: any, edited: any): any {
  if (!orig || typeof orig !== "object" || !edited || typeof edited !== "object") return orig;
  if (Array.isArray(orig)) return orig.map((v, i) => withDescriptions(v, edited[i]));
  const out: any = { ...orig };
  if (typeof edited.description === "string" && typeof orig.description !== "object") {
    out.description = edited.description;
  }
  for (const k of Object.keys(orig)) {
    if (orig[k] && typeof orig[k] === "object") out[k] = withDescriptions(orig[k], edited[k]);
  }
  return out;
}

/**
 * Apply a candidate to a target agent's tools. Returns the pieces to spread into a
 * RawPiAgentConfig: `{ systemPrompt, tools, skills }`.
 */
export function applyHarness(
  dir: string,
  tools: ToolInput[],
): { systemPrompt: string; tools: ToolInput[]; skills: string[] } {
  const texts = loadTools(dir);
  const patched = tools.map((t) => {
    const text = texts[t.name];
    if (!text) return t;
    return {
      ...t,
      description: text.description,
      promptSnippet: text.promptSnippet,
      promptGuidelines: text.promptGuidelines,
      parameters: t.parameters ? withDescriptions(t.parameters, text.parameters) : t.parameters,
    };
  });
  const skills = Object.keys(loadSkills(dir)).map((name) => skillDir(dir, name));
  return { systemPrompt: loadSystemPrompt(dir), tools: patched, skills };
}

/** Copy a candidate directory (parent → child before a mutation). */
export function copyHarness(from: string, to: string): void {
  fs.cpSync(from, to, { recursive: true });
}
