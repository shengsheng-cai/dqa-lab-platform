import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import Dashboard from './Dashboard';
import SOPPage from './SOPPage';

function App() {
  return (
    <BrowserRouter>
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: '#0d1117' }}>
        {/* 全域唯一的導航列 */}
        <nav style={{ 
          padding: '1rem 2rem', 
          backgroundColor: '#161b22', 
          display: 'flex', 
          gap: '2rem',
          borderBottom: '1px solid #30363d',
          zIndex: 1000
        }}>
          <Link to="/" style={{ color: 'white', textDecoration: 'none', fontWeight: 'bold' }}>儀表板</Link>
          <Link to="/sop" style={{ color: 'white', textDecoration: 'none', fontWeight: 'bold' }}>SOP 執行</Link>
        </nav>

        {/* 主要內容區 */}
        <main style={{ width: '100%', flex: 1, overflow: 'hidden' }}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/sop" element={<SOPPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;