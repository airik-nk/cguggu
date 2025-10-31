// 基本设置
export const BASE_URL = 'http://localhost:5000';  // 设置为你的后端服务器地址

// API endpoints
export const API = {
    base: `${BASE_URL}/api`,
    ragflow: `${BASE_URL}/api/ragflow`,
};

// 知识库配置
export const KNOWLEDGE_BASES = [
    { id: 'NTHU', name: '清大', },
    { id: 'NYCU', name: '陽明交大', },
    { id: 'NCU', name: '中央', },
] as const;

export type KnowledgeBaseId = typeof KNOWLEDGE_BASES[number]['id'];