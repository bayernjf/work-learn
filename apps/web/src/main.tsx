import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

function App() {
  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand"><span className="brand-mark">W</span><span>work learn</span></div>
        <span className="status">MVP workspace</span>
      </header>
      <section className="welcome">
        <p className="eyebrow">Your learning layer</p>
        <h1>Learn from the work already happening.</h1>
        <p className="lede">Your saved conversations, useful expressions, and next practice will live here.</p>
        <div className="empty-state">
          <span className="empty-mark">+</span>
          <h2>Your corpus starts with one conversation.</h2>
          <p>Call the Learning Skill from an AI agent, then confirm what is worth keeping.</p>
          <code>“整理刚才这段对话”</code>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
