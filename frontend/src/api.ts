// src/api.ts
const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");

import type {
  DocsListItem,
  RagStatus,
  RagDocItem,
  FileItem,
  UploadResponse,
} from "./api/types";
import { DEPARTMENTS } from './constants';

interface KbOpts {
  kb?: string;
  limit?: number;
}

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

// API 實現
export const fetchDocs = async (opts?: KbOpts): Promise<DocsListItem[]> => {
  const url = new URL(`${API_BASE}/api/docs`);
  if (opts?.kb) url.searchParams.set('kb', opts.kb);
  const response = await fetch(url.toString());
  return handleResponse<DocsListItem[]>(response);
};

export const uploadDoc = async (formData: FormData, opts?: KbOpts): Promise<UploadResponse> => {
  const url = new URL(`${API_BASE}/api/docs`);
  if (opts?.kb && !formData.has('kb')) formData.append('kb', opts.kb);
  const response = await fetch(url.toString(), {
    method: 'POST',
    body: formData
  });
  return handleResponse<UploadResponse>(response);
};

export const fetchFiles = async (): Promise<FileItem[]> => {
  const response = await fetch(`${API_BASE}/api/files`);
  const data = await handleResponse<any[]>(response);
  // 添加類型檢查和轉換
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
  const response = await fetch(`${API_BASE}/api/versions/${versionId}/toggle`, {
    method: 'POST'
  });
  return handleResponse<void>(response);
};

export const deleteDoc = async (docId: number | string, opts?: KbOpts): Promise<void> => {
  const url = new URL(`${API_BASE}/api/docs/${docId}`);
  if (opts?.kb) url.searchParams.set('kb', opts.kb);
  const response = await fetch(url.toString(), { method: 'DELETE' });
  return handleResponse<void>(response);
};

export const getRagStatus = async (docId: number, opts?: KbOpts): Promise<RagStatus> => {
  const url = new URL(`${API_BASE}/api/docs/${docId}/ragflow`);
  if (opts?.kb) url.searchParams.set('kb', opts.kb);
  const response = await fetch(url.toString());
  return handleResponse<RagStatus>(response);
};

export const resyncRag = async (
  docId: number,
  opts?: KbOpts
): Promise<{ success: boolean; parsed_ids?: string[]; error?: string }> => {
  const url = new URL(`${API_BASE}/api/docs/${docId}/ragflow/resync`);
  if (opts?.kb) url.searchParams.set('kb', opts.kb);
  const response = await fetch(url.toString(), { method: 'POST' });
  return handleResponse(response);
};

export const fetchRagDocs = async (q?: string, opts?: KbOpts): Promise<RagDocItem[]> => {
  const url = new URL(`${API_BASE}/api/ragflow/docs`);
  if (opts?.kb) url.searchParams.set('kb', opts.kb);
  if (opts?.limit) url.searchParams.set('limit', String(opts.limit));
  if (q) url.searchParams.set('q', q);
  const response = await fetch(url.toString());
  return handleResponse<RagDocItem[]>(response);
};

export const deleteRagDocByDisplayName = async (displayName: string, opts?: KbOpts): Promise<void> => {
  const url = new URL(`${API_BASE}/api/ragflow/docs/${encodeURIComponent(displayName)}`);
  if (opts?.kb) url.searchParams.set('kb', opts.kb);
  const response = await fetch(url.toString(), { method: 'DELETE' });
  return handleResponse<void>(response);
};