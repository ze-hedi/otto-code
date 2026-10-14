// file-lock.ts
// Shared by all agents of a workflow so two agents never edit the same file at once.

export class FileLockRegistry {
  /** absolute file path → id of the tool call currently editing it */
  private _locks: Map<string, string> = new Map();

  /** Lock `filePath` for `callId`. Returns false if another call holds it. */
  tryAcquire(filePath: string, callId: string): boolean {
    if (this._locks.has(filePath)) return false;
    this._locks.set(filePath, callId);
    return true;
  }

  /** Release whatever file `callId` holds (no-op if none). */
  release(callId: string): void {
    for (const [filePath, owner] of this._locks) {
      if (owner === callId) this._locks.delete(filePath);
    }
  }
}
