import React from "react";
import { Link } from "react-router-dom";


const cards = [
{ name: "Calendar", docs: 1, updated: "10/09/2025 09:10:54" },
{ name: "Regulation", docs: 6, updated: "12/09/2025 16:12:08" },
];


export default function KbMenu() {
return (
<div className="container">
<header className="header">
<div>
<h1 className="h1">Welcome back</h1>
<div className="sub">Which knowledge bases will you use today?</div>
</div>
</header>


<section className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
{cards.map((c) => (
<Link key={c.name} to={`/kb/${encodeURIComponent(c.name)}`} className="card" style={{ textDecoration: "none" }}>
<div className="card-pad">
<div style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>{c.name}</div>
<div className="sub" style={{ display: "flex", gap: 16 }}>
<span>📄 {c.docs} Docs</span>
<span>🕒 {c.updated}</span>
</div>
</div>
</Link>
))}
</section>
</div>
);
}