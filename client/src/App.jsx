import {
  BrowserRouter,
  Routes,
  Route,
  Link,
  useLocation,
} from "react-router-dom";
import Dashboard from "./Dashboard";
import SOPPage from "./SOPPage";
import ErrorLog from "./ErrorLog";

const NavBar = () => {
  const location = useLocation();
  const linkStyle = (path) => ({
    color: location.pathname === path ? "#cdd9e5" : "#8b949e",
    textDecoration: "none",
    fontWeight: 600,
    fontSize: 14,
    padding: "4px 12px",
    borderRadius: 6,
    background: location.pathname === path ? "#21262d" : "transparent",
    border: `1px solid ${location.pathname === path ? "#30363d" : "transparent"}`,
    transition: "all .15s",
  });

  return (
    <nav
      style={{
        padding: "10px 24px",
        backgroundColor: "#161b22",
        display: "flex",
        alignItems: "center",
        gap: "8px",
        borderBottom: "1px solid #30363d",
        zIndex: 1000,
      }}
    >
      <span
        style={{
          color: "#58a6ff",
          fontWeight: 700,
          fontSize: 14,
          marginRight: 16,
        }}
      >
        DQA Lab
      </span>
      <Link to="/" style={linkStyle("/")}>
        儀表板
      </Link>
      <Link to="/sop" style={linkStyle("/sop")}>
        SOP 執行
      </Link>
      <Link to="/errors" style={linkStyle("/errors")}>
        異常看板
      </Link>
    </nav>
  );
};

function App() {
  return (
    <BrowserRouter>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100vh",
          backgroundColor: "#0d1117",
        }}
      >
        <NavBar />
        <main style={{ width: "100%", flex: 1, overflow: "hidden" }}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/sop" element={<SOPPage />} />
            <Route path="/errors" element={<ErrorLog />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
