// ─── ECG Second Opinion — In-Memory Repository ─────────────────────
// SQLite/PostgreSQL seams planned; in-memory for initial baseline.
// D-07: Append-only audit trail for 21 CFR Part 11 compliance.

import type { IEcgCaseRepository } from './case-contracts';
import type { EcgCaseStatus } from './case-contracts';
import { EcgSecondOpinionCase } from './cases';

/** Immutable audit trail entry — append-only, never updated or deleted. */
export interface AuditTrailEntry {
  readonly caseId: string;
  readonly previousStatus: EcgCaseStatus | null;
  readonly newStatus: EcgCaseStatus;
  readonly timestamp: Date;
  readonly operation: string;
  readonly snapshot: ReturnType<EcgSecondOpinionCase['toProps']>;
}

export class InMemoryEcgCaseRepository implements IEcgCaseRepository {
  private readonly store = new Map<string, ReturnType<EcgSecondOpinionCase['toProps']> & { id: string }>();
  private readonly auditLog: AuditTrailEntry[] = [];

  async save(ecgCase: EcgSecondOpinionCase): Promise<void> {
    const existing = this.store.get(ecgCase.id);
    const previousStatus = existing?.status ?? null;
    const props = ecgCase.toProps();

    this.store.set(ecgCase.id, { id: ecgCase.id, ...props });

    // Append-only audit trail: every state change is recorded immutably
    this.auditLog.push({
      caseId: ecgCase.id,
      previousStatus,
      newStatus: props.status,
      timestamp: new Date(),
      operation: previousStatus === null
        ? 'CREATED'
        : `${previousStatus} → ${props.status}`,
      snapshot: props,
    });
  }

  async findById(id: string): Promise<EcgSecondOpinionCase | null> {
    const data = this.store.get(id);
    if (!data) return null;
    return EcgSecondOpinionCase.reconstitute(data.id, data);
  }

  async findByRecordingId(recordingId: string): Promise<EcgSecondOpinionCase[]> {
    const results: EcgSecondOpinionCase[] = [];
    for (const data of this.store.values()) {
      if (data.recording.recordingId === recordingId) {
        results.push(EcgSecondOpinionCase.reconstitute(data.id, data));
      }
    }
    return results;
  }

  async list(): Promise<EcgSecondOpinionCase[]> {
    return Array.from(this.store.values()).map((data) =>
      EcgSecondOpinionCase.reconstitute(data.id, data),
    );
  }

  /** Read-only access to the audit trail (for testing and compliance queries) */
  getAuditTrail(caseId?: string): readonly AuditTrailEntry[] {
    if (caseId) {
      return this.auditLog.filter((e) => e.caseId === caseId);
    }
    return [...this.auditLog];
  }
}
