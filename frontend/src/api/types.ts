import { Department } from '../constants';

export interface BaseDTO {
  id: number;
  date_issued: string | null;
}

export interface DocumentDTO extends BaseDTO {
  title: string;
  department: Department;
  doc_no: string | null;
  review_meeting: string | null;
}

export interface DocumentVersionDTO extends BaseDTO {
  doc_id: number;
  version_code: string;
  is_active: boolean;
  file_path: string | null;
  filename?: string | null;
}

export interface DocsListItem {
  doc: DocumentDTO;
  latest: DocumentVersionDTO | null;
}

export interface RagStatus {
  found: boolean;
  status: string;      // PENDING/SUCCESS/ERROR/NOT_FOUND...
  chunks?: number;
  enabled?: boolean;
  doc_id?: string;
  url?: string | null;
}

export interface RagDocItem {
  id?: string;
  display_name?: string;
  status?: string;
  Chunk_Number?: number | null;
  enabled?: boolean | null;
  updated_at?: string | null;
  url?: string | null;
}

export interface FileItem {
  name: string;
  rel_path: string;
  size: number;
  mtime: string;
  url: string;
  department: Department;
}

export interface UploadResponse {
  success: boolean;
  message?: string;
}