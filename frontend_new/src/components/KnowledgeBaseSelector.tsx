import { useState, useEffect } from 'react';
import { fetchKnowledgeBases } from '../api';
import type { KnowledgeBase } from '../api/types';

interface Props {
  onSelect: (kb: string) => void;
}

export default function KnowledgeBaseSelector({ onSelect }: Props) {
  const [selectedKb, setSelectedKb] = useState<string>('');
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchKnowledgeBases()
      .then(setKnowledgeBases)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedKb) {
      onSelect(selectedKb);
    }
  };

  if (error) {
    return (
      <div className="card" style={{ maxWidth: '600px', margin: '40px auto' }}>
        <div className="card-pad">
          <h2 className="section-title" style={{ color: '#dc2626' }}>錯誤</h2>
          <div className="sub">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ maxWidth: '600px', margin: '40px auto' }}>
      <div className="card-pad">
        <h2 className="section-title">選擇知識庫</h2>
        <div className="sub">請選擇要管理的知識庫</div>

        <form onSubmit={handleSubmit} style={{ marginTop: '20px' }}>
          <div className="row" style={{ justifyContent: 'center' }}>
            <select 
              className="input" 
              value={selectedKb}
              onChange={(e) => setSelectedKb(e.target.value)}
              style={{ maxWidth: '300px' }}
              required
              disabled={loading}
            >
              <option value="">{loading ? "載入中..." : "請選擇..."}</option>
              {knowledgeBases.map(kb => (
                <option key={kb.id} value={kb.name}>
                  {kb.name}{kb.description ? ` - ${kb.description}` : ''}
                </option>
              ))}
            </select>
            <button 
              type="submit" 
              className="btn btn-primary"
              disabled={loading || !selectedKb}
            >
              {loading ? "載入中..." : "進入管理"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}