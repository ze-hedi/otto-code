import { Type } from "@sinclair/typebox";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import type { ToolInput } from "../agents/pi-agent-types.js";

export interface Category {
  id: string;
  name: string;
  definition: string;
}

export interface Taxonomy {
  categories: Category[];
  /** noteId → categoryId; one label per error. */
  assignments: Record<string, string>;
}

export function loadTaxonomy(path: string): Taxonomy {
  return existsSync(path)
    ? JSON.parse(readFileSync(path, "utf-8"))
    : { categories: [], assignments: {} };
}

function saveTaxonomy(path: string, t: Taxonomy): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(t, null, 2));
}

export function formatCategories(t: Taxonomy): string {
  return t.categories.length
    ? t.categories.map((c) => `- ${c.id} | ${c.name}: ${c.definition}`).join("\n")
    : "(none yet)";
}

const text = (s: string) => ({ content: [{ type: "text", text: s }] });

// Tool bodies are synchronous between load and save, so parallel sub-agents can't interleave writes.

function createCategoryTool(taxonomyPath: string): ToolInput {
  return {
    name: "create_category",
    label: "Create Category",
    description: "Create a failure category in the taxonomy. Returns its id.",
    promptGuidelines: [
      "Check the existing categories first; reuse one instead of creating a near-duplicate.",
      "The definition must let a reader decide, for any error, whether it belongs.",
    ],
    parameters: Type.Object({
      name: Type.String({ description: "Short name, e.g. 'Ignores tool error'" }),
      definition: Type.String({ description: "One or two sentences: what belongs here" }),
    }),
    execute: async (_id, { name, definition }) => {
      const t = loadTaxonomy(taxonomyPath);
      const existing = t.categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
      if (existing) return text(`Category already exists: ${existing.id}`);
      const category = { id: crypto.randomUUID().slice(0, 8), name, definition };
      t.categories.push(category);
      saveTaxonomy(taxonomyPath, t);
      return text(`Created category ${category.id}`);
    },
  };
}

function updateCategoryTool(taxonomyPath: string): ToolInput {
  return {
    name: "update_category",
    label: "Update Category",
    description: "Rename a category or sharpen its definition. Existing assignments are kept.",
    parameters: Type.Object({
      categoryId: Type.String(),
      name: Type.Optional(Type.String()),
      definition: Type.Optional(Type.String()),
    }),
    execute: async (_id, { categoryId, name, definition }) => {
      const t = loadTaxonomy(taxonomyPath);
      const c = t.categories.find((c) => c.id === categoryId);
      if (!c) return text(`Error: unknown categoryId ${categoryId}`);
      if (name) c.name = name;
      if (definition) c.definition = definition;
      saveTaxonomy(taxonomyPath, t);
      return text(`Updated category ${categoryId}`);
    },
  };
}

function assignCategoryTool(taxonomyPath: string, noteIds: Set<string>): ToolInput {
  return {
    name: "assign_category",
    label: "Assign Category",
    description: "Label one error with a category. Re-assigning replaces the previous label.",
    parameters: Type.Object({
      noteId: Type.String({ description: "The error's id" }),
      categoryId: Type.String({ description: "Id of an existing category" }),
    }),
    execute: async (_id, { noteId, categoryId }) => {
      const t = loadTaxonomy(taxonomyPath);
      if (!noteIds.has(noteId)) return text(`Error: noteId ${noteId} is not one of your errors`);
      if (!t.categories.some((c) => c.id === categoryId)) {
        return text(`Error: unknown categoryId ${categoryId}`);
      }
      t.assignments[noteId] = categoryId;
      saveTaxonomy(taxonomyPath, t);
      return text(`Assigned ${noteId} → ${categoryId}`);
    },
  };
}

function getProgressTool(taxonomyPath: string, noteIds: Set<string>): ToolInput {
  return {
    name: "get_progress",
    label: "Get Progress",
    description: "Count of errors per category, and the ids of errors not assigned yet.",
    parameters: Type.Object({}),
    execute: async () => {
      const t = loadTaxonomy(taxonomyPath);
      const counts = t.categories.map(
        (c) => `- ${c.id} | ${c.name}: ${[...noteIds].filter((id) => t.assignments[id] === c.id).length}`
      );
      const unassigned = [...noteIds].filter((id) => !t.assignments[id]);
      return text(
        `${noteIds.size - unassigned.length}/${noteIds.size} assigned\n${counts.join("\n")}\n` +
          `Unassigned: ${unassigned.length ? unassigned.join(", ") : "none"}`
      );
    },
  };
}

/** Orchestrator tools: owns the categories. */
export function createTaxonomyTools(taxonomyPath: string, noteIds: Set<string>): ToolInput[] {
  return [
    createCategoryTool(taxonomyPath),
    updateCategoryTool(taxonomyPath),
    assignCategoryTool(taxonomyPath, noteIds),
    getProgressTool(taxonomyPath, noteIds),
  ];
}

/** Assigner sub-agent tools: may only label the errors of its batch. */
export function createAssignerTools(taxonomyPath: string, batch: Set<string>): ToolInput[] {
  return [assignCategoryTool(taxonomyPath, batch)];
}
