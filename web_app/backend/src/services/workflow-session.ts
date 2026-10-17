import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import type { WorkflowSchema } from "../../../../agents/workflow-types.js";
import { getWorkflow as getWorkflowDoc, updateWorkflow } from "../db/mongo.js";

/**
 * Extracts the structural fingerprint of a workflow schema for comparison.
 * Only agent IDs and connections matter — positions are ignored.
 */
export function extractStructuralSchema(schema: WorkflowSchema) {
  const agentIds = schema.components
    .filter(c => c.type === "agent")
    .map(c => c.id)
    .sort();
  const connections = schema.connections
    .map(c => ({ from: c.from, to: c.to }))
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  return { agentIds, connections };
}

function structurallyEqual(
  a: { agentIds: string[]; connections: { from: string; to: string }[] },
  b: { agentIds: string[]; connections: { from: string; to: string }[] },
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface SessionRequest {
  workflowId?: string;
  schema: WorkflowSchema;
  /** "new" = create fresh session, "continue" = reuse activeSessionId */
  sessionMode?: "new" | "continue";
  /** Explicit session ID to resume (when user picks from the dropdown) */
  requestedSessionId?: string;
  /** Host-side playground; used to wipe stale sessions when the structure changes. */
  playground?: string;
}

/** Decides which workflow session a compile uses and persists the choice on the workflow document. */
export async function resolveWorkflowSession(req: SessionRequest): Promise<string | undefined> {
  const { workflowId, schema, sessionMode, requestedSessionId, playground } = req;
  if (!workflowId) return undefined;

  const currentStructure = extractStructuralSchema(schema);
  let workflowSessionId: string | undefined;

  const workflowDoc = await getWorkflowDoc(workflowId);
  const previousStructure = workflowDoc?.lastCompiledSchema;

  if (!previousStructure) {
    // First compile ever — create new session
    workflowSessionId = uuidv4();
    console.log("[compile] First compile — new session:", workflowSessionId);
  } else if (!structurallyEqual(previousStructure, currentStructure)) {
    // Structure changed — wipe old sessions, create new session
    if (playground) {
      const workflowDir = path.join(playground, ".otto-sessions", `workflow-${workflowId}`);
      if (fs.existsSync(workflowDir)) {
        fs.rmSync(workflowDir, { recursive: true, force: true });
        console.log(`[compile] Structure changed — wiped sessions: ${workflowDir}`);
      }
    }
    workflowSessionId = uuidv4();
    console.log("[compile] Structure changed — new session:", workflowSessionId);
  } else if (sessionMode === "new") {
    // Same structure, user explicitly wants a new session
    workflowSessionId = uuidv4();
    console.log("[compile] Same structure, user chose new session:", workflowSessionId);
  } else {
    // Same structure, continue existing session (use explicit ID if provided, else active)
    workflowSessionId = requestedSessionId ?? workflowDoc?.activeSessionId;
    console.log("[compile] Same structure, continuing session:", workflowSessionId);
  }

  // Persist the compiled schema and active session
  await updateWorkflow(workflowId, {
    lastCompiledSchema: currentStructure,
    activeSessionId: workflowSessionId,
    compiled: true,
  });

  return workflowSessionId;
}
