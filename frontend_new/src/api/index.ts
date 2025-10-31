import type { DocsListItem, RagStatus, RagDocItem, FileItem, UploadResponse, KnowledgeBase } from "./types";
import { DEPARTMENTS } from '../constants';
import { API } from '../config';

const API_BASE = API.base;
const RAGFLOW_BASE = API.ragflow;

export const fetchKnowledgeBases = async (): Promise<KnowledgeBase[]> => {
  const response = await fetch(`${API_BASE}/knowledge-bases`);
  return handleResponse<KnowledgeBase[]>(response);
};

const handleResponse = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const errorText = await response.text();
    console.error(`API Error Response:`, {
      status: response.status,
      statusText: response.statusText,
      body: errorText
    });
    try {
      const errorJson = JSON.parse(errorText);
      if (errorJson.error_message || errorJson.message) {
        throw new Error(errorJson.error_message || errorJson.message);
      }
    } catch (e) {
      if (e instanceof Error) throw e;
    }
    throw new Error(`API Error: ${response.status} ${response.statusText}\n${errorText}`);
  }
  const data = await response.json();
  console.log(`API Response for ${response.url}:`, data);
  return data;
};

export const fetchDocs = async (opts?: { kb?: string }): Promise<DocsListItem[]> => {
  // [修改] 移除了 /api
  const url = new URL(`${API_BASE}/docs`);
  if (opts?.kb) url.searchParams.set('kb', opts.kb);
  const response = await fetch(url.toString());
  return handleResponse<DocsListItem[]>(response);
};

export const uploadDoc = async (formData: FormData, opts?: { kb?: string }): Promise<UploadResponse> => {
  // [修改] 移除了 /api
  const url = new URL(`${API_BASE}/docs`);
  if (opts?.kb && !formData.has('kb')) formData.append('kb', opts.kb);
  const response = await fetch(url.toString(), {
    method: 'POST',
    body: formData
  });
  return handleResponse<UploadResponse>(response);
};

export const fetchFiles = async (): Promise<FileItem[]> => {
  // [修改] 移除了 /api
  const response = await fetch(`${API_BASE}/files`);
  const data = await handleResponse<any[]>(response);
  // Add type checking and conversion
  return data.map(item => ({
    name: item.name || '',
    rel_path: item.rel_path || '',
    size: Number(item.size) || 0,
    mtime: item.mtime || new Date().toISOString(),
    url: item.url || '',
    department: item.department || DEPARTMENTS[0]
  }));
};

export const toggleVersion = async (versionId: number): Promise<void> => {
  // [修改] 移除了 /api
  const response = await fetch(`${API_BASE}/versions/${versionId}/toggle`, {
    method: 'POST'
  });
  return handleResponse<void>(response);
};

export const deleteDoc = async (docId: number | string, opts?: { kb?: string }): Promise<void> => {
  // [修改] 移除了 /api
  const url = new URL(`${API_BASE}/docs/${docId}`);
  if (opts?.kb) url.searchParams.set('kb', opts.kb);
  const response = await fetch(url.toString(), { method: 'DELETE' });
  return handleResponse<void>(response);
};

export const getRagStatus = async (docId: number, opts?: { kb?: string }): Promise<RagStatus> => {
  // [修改] 移除了 /api
  const url = new URL(`${API_BASE}/docs/${docId}/ragflow`);
  if (opts?.kb) url.searchParams.set('kb', opts.kb);
  const response = await fetch(url.toString());
  return handleResponse<RagStatus>(response);
};

export const fetchRagDocs = async (q?: string, opts?: { kb?: string; limit?: number }): Promise<RagDocItem[]> => {
  const url = new URL(`${RAGFLOW_BASE}/docs`);
  if (opts?.kb) url.searchParams.set('kb', opts.kb);
  if (opts?.limit) url.searchParams.set('limit', String(opts.limit));
  if (q) url.searchParams.set('q', q);
  const response = await fetch(url.toString());
  return handleResponse<RagDocItem[]>(response);
};

export const deleteRagDocByDisplayName = async (name: string, opts?: { kb?: string }): Promise<void> => {
  const url = new URL(`${RAGFLOW_BASE}/docs/${encodeURIComponent(name)}`);
  if (opts?.kb) url.searchParams.set('kb', opts.kb);
  const response = await fetch(url.toString(), { method: 'DELETE' });
  return handleResponse<void>(response);
};

export const updateRagChunking = async (
  docId: number,
  options: { method?: string; size?: number; overlap?: number; parser_config?: Record<string, any>; reparse?: boolean },
  opts?: { kb?: string }
): Promise<void> => {
  // [修改] 移除了 /api
  const url = new URL(`${API_BASE}/docs/${docId}/ragflow/chunking`);
  if (opts?.kb) url.searchParams.set('kb', opts.kb);
  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options)
  });
  return handleResponse<void>(response);
};