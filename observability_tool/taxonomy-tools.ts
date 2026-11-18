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

const text = (s: string) => ({ content: [{ type: "text", text: s }] });

export function createTaxonomyTools(taxonomyPath: string, noteIds: Set<string>): ToolInput[] {
  return [
    {
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
    },
    {
      name: "assign_category",
      label: "Assign Category",
      description: "Label one error with a category. Re-assigning replaces the previous label.",
      parameters: Type.Object({
        noteId: Type.String({ description: "The error's id" }),
        categoryId: Type.String({ description: "Id returned by create_category" }),
      }),
      execute: async (_id, { noteId, categoryId }) => {
        const t = loadTaxonomy(taxonomyPath);
        if (!noteIds.has(noteId)) return text(`Error: unknown noteId ${noteId}`);
        if (!t.categories.some((c) => c.id === categoryId)) {
          return text(`Error: unknown categoryId ${categoryId}`);
        }
        t.assignments[noteId] = categoryId;
        saveTaxonomy(taxonomyPath, t);
        return text(`Assigned ${noteId} → ${categoryId}`);
      },
    },
  ];
}
