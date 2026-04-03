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
}

export interface DeltaData {
  projects: any[];
  applications: any[];
  sessions: any[];
  manual_sessions: any[];
  tombstones: {
    table_name: string;
    record_id: number | string | null;
    record_uuid: string | null;
    deleted_at: string;
    sync_key: string;
  }[];
}
