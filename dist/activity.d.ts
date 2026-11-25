export type WriteStatus = "queued" | "running" | "done" | "failed" | "sent, not confirmed" | "cancelled, not sent" | "partly sent, some not confirmed" | "approval sent, action not sent" | "preview only, not sent" | "unfinished";
export interface WriteRecord {
    tool: string;
    inputs?: Record<string, unknown>;
    started: string;
    status: WriteStatus;
    hash?: string;
    hashes?: string[];
    finished?: string;
}
export declare function writeQueued(tool: string, args: unknown): WriteRecord;
export declare function writeRunning(r: WriteRecord): void;
export declare function writeDone(r: WriteRecord, result: unknown): void;
export declare function writeFailed(r: WriteRecord, e: unknown, cancelled?: boolean): void;
export declare function recentWrites(): WriteRecord[];
export declare const RECENT_WRITES_NOTE: string;
