import React, { useState, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, CartesianGrid, Tooltip } from "recharts";

const Dashboard = () => {
  const [data, setData] = useState({
    temperature: 0,
    humidity: 0,
    status: "OFFLINE",
    timestamp: "--:--:--",
    running_sop_name: "None" // 新增：承接後端的 SOP 名稱
  });
  const [history, setHistory] = useState([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch("http://localhost:8000/api/latest");
        const json = await response.json();
        
        if (json.temperature !== undefined) {
          setData(json);
          // 保留最近 30 筆數據畫圖，x 軸顯示時間戳
          setHistory(prev => [...prev.slice(-29), { ...json, time: json.timestamp }]);
        }
      } catch (err) {
        console.error("Fetch Error:", err);
      }
    };

    const interval = setInterval(fetchData, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ 
      backgroundColor: "#050505", 
      color: "#e0e0e0", 
      minHeight: "100vh", 
      padding: "20px", 
      fontFamily: "monospace",
      boxSizing: "border-box", 
      width: "100%"
    }}>
      {/* 1. 標題欄 */}
      <div style={{ 
        display: "flex", 
        justifyContent: "space-between", 
        alignItems: "center",
        flexWrap: "wrap", 
        borderBottom: "2px solid #222", 
        paddingBottom: "10px",
        gap: "10px"
      }}>
        <h1 style={{ color: "#00d4ff", margin: 0, fontSize: "clamp(1.2rem, 5vw, 2rem)" }}>
          KSON AICM | Digital Twin
        </h1>
        <div style={{ textAlign: "right" }}>
          <span style={{ color: data.status === "RUNNING" ? "#00ff00" : "#ffaa00", fontWeight: "bold" }}>
            ● {data.status}
          </span>
          <div style={{ fontSize: "12px", color: "#666" }}>Updated: {data.timestamp}</div>
        </div>
      </div>

      {/* 2. 當前任務顯示區 (新增) */}
      <div style={{ 
        marginTop: "20px", 
        padding: "15px 20px", 
        background: "linear-gradient(90deg, #111 0%, #080808 100%)", 
        borderRadius: "8px", 
        borderLeft: `4px solid ${data.status === "RUNNING" ? "#00ff00" : "#333"}`,
        boxShadow: "0 4px 15px rgba(0,0,0,0.5)"
      }}>
        <div style={{ color: "#666", fontSize: "12px", letterSpacing: "1px" }}>CURRENT MISSION</div>
        <h2 style={{ 
          color: data.status === "RUNNING" ? "#e0e0e0" : "#444", 
          margin: "5px 0 0 0",
          fontSize: "1.5rem"
        }}>
          {data.status === "RUNNING" ? data.running_sop_name : "STANDBY (IDLE)"}
        </h2>
      </div>

      {/* 3. PV 顯示區 */}
      <div style={{ 
        display: "grid", 
        gridTemplateColumns: "repeat(auto-fit, minmax(350px, 1fr))", 
        gap: "25px", 
        marginTop: "25px" 
      }}>
        {/* 溫度卡片 */}
        <div style={{ 
          background: "#111", padding: "25px", borderRadius: "12px", border: "1px solid #333",
          display: "flex", flexDirection: "column", alignItems: "center"
        }}>
          <div style={{ color: "#ff5500", fontSize: "1.1rem", width: "100%", marginBottom: "10px" }}>TEMP PV</div>
          <div style={{ 
            fontSize: "clamp(3.5rem, 12vw, 6rem)", fontWeight: "bold", color: "#ff5500", 
            textShadow: "0 0 20px rgba(255,85,0,0.2)", lineHeight: 1
          }}>
            {data.temperature.toFixed(2)}<span style={{ fontSize: "0.4em" }}>°C</span>
          </div>
        </div>

        {/* 濕度卡片 */}
        <div style={{ 
          background: "#111", padding: "25px", borderRadius: "12px", border: "1px solid #333",
          display: "flex", flexDirection: "column", alignItems: "center"
        }}>
          <div style={{ color: "#00d4ff", fontSize: "1.1rem", width: "100%", marginBottom: "10px" }}>HUMI PV</div>
          <div style={{ 
            fontSize: "clamp(3.5rem, 12vw, 6rem)", fontWeight: "bold", color: "#00d4ff", 
            textShadow: "0 0 20px rgba(0,212,255,0.2)", lineHeight: 1
          }}>
            {data.humidity.toFixed(1)}<span style={{ fontSize: "0.4em" }}>%</span>
          </div>
        </div>
      </div>

      {/* 4. 趨勢圖表 */}
      <div style={{ 
        marginTop: "30px", background: "#111", padding: "20px", borderRadius: "12px", 
        height: "350px", border: "1px solid #222", width: "100%", boxSizing: "border-box"
      }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={history} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#222" vertical={false} />
            <XAxis dataKey="timestamp" stroke="#444" tick={{fontSize: 10}} hide={history.length < 2} />
            <YAxis stroke="#444" domain={['auto', 'auto']} tick={{fontSize: 10}} />
            <Tooltip 
              contentStyle={{ backgroundColor: "#000", border: "1px solid #333", color: "#fff" }}
              itemStyle={{ fontSize: "12px" }}
            />
            <Line type="monotone" dataKey="temperature" stroke="#ff5500" strokeWidth={3} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="humidity" stroke="#00d4ff" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default Dashboard;