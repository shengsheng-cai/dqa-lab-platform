export default function TabBadge({ count, bg, color = "#0d1117" }) {
  if (!count) return null;
  return (
    <span style={{
      marginLeft: 5, background: bg, color,
      fontSize: 10, fontWeight: 700, borderRadius: 8,
      padding: "1px 5px", lineHeight: "14px", verticalAlign: "middle",
    }}>
      {count}
    </span>
  );
}
