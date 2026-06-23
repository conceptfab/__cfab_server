export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface TableHashes {
  projects: string;
  applications: string;
  sessions: string;
  manual_sessions: string;
  assignment_feedback?: string;
  assignment_auto_runs?: string;
}

export interface DeltaData {
  projects: Record<string, JsonValue>[];
  applications: Record<string, JsonValue>[];
  sessions: Record<string, JsonValue>[];
  manual_sessions: Record<string, JsonValue>[];
  tombstones: {
    table_name: string;
    record_id: number | string | null;
    record_uuid: string | null;
    deleted_at: string;
    sync_key: string;
  }[];
  assignment_feedback?: Record<string, JsonValue>[];
  assignment_auto_runs?: Record<string, JsonValue>[];
}
