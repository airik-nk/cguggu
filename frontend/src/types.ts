// 合併相似的型別定義
export type BaseDTO = {
  id: number;
  date_issued: string | null;
};

export type DocumentDTO = BaseDTO & {
  title: string;
  department: string;
  doc_no: string | null;
  review_meeting: string | null;
};

export type DocumentVersionDTO = BaseDTO & {
  doc_id: number;
  version_code: string;
  is_active: boolean;
  file_path: string | null;
  filename?: string | null;
};

export type DocsListItem = {
  doc: DocumentDTO;
  latest: DocumentVersionDTO | null;
};

// --- 0909 ---
export type RagStatus = {
  found: boolean;
  status: string;      // PENDING/SUCCESS/ERROR/NOT_FOUND...
  chunks?: number;
  enabled?: boolean;
  doc_id?: string;
  url?: string | null;
};

export type RagDocItem = {
  id?: string;
  display_name?: string;
  status?: string;
  Chunk_Number?: number | null;
  enabled?: boolean | null;
  updated_at?: string | null;
  url?: string | null;
};

export type FileItem = {
  name: string;
  rel_path: string;
  size: number;
  mtime: string; // ISO
  url: string;
};


export type ChunkingOptions = {
  method?: "general" | "fixed" | "by_page" | "regex" | "by_heading";
  size?: number;
  overlap?: number;
  pattern?: string;
  heading_regex?: string;
};


type KbOpts = { kb?: string };