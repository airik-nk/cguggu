import { useState } from 'react'
import './App.css'
import FilesPanel from './components/FilesPanel'
import RagDocsPanel from './components/RagDocsPanel'
import RecentUploadsPanel from './components/RecentUploadsPanel'
import BulkImportDialog from './components/BulkImportDialog'
import UploadDialog from './components/UploadDialog'
import KnowledgeBaseSelector from './components/KnowledgeBaseSelector'

function App() {
  const [selectedKb, setSelectedKb] = useState<string>('');
  const [refreshKey, setRefreshKey] = useState(0);

  // 用于刷新列表的回调函数
  const handleRefresh = () => {
    setRefreshKey(key => key + 1);
  };

  if (!selectedKb) {
    return <KnowledgeBaseSelector onSelect={setSelectedKb} />;
  }

  return (
    <div className="container">
      <div className="tools">
        <button 
          className="btn" 
          onClick={() => setSelectedKb('')}
          style={{ marginRight: '1rem' }}
        >
          ← 返回選擇知識庫
        </button>
        <UploadDialog kb={selectedKb} onDone={handleRefresh} />
        <BulkImportDialog kb={selectedKb} onDone={handleRefresh} />
      </div>

      <RecentUploadsPanel key={`recent-${refreshKey}`} kb={selectedKb} />
      <RagDocsPanel key={`rag-${refreshKey}`} kb={selectedKb} />
      <FilesPanel key={`files-${refreshKey}`} />
    </div>
  );
}

export default App;
