import { Bot, Code2, Send, ShieldCheck } from 'lucide-react';

export default function AssistantPanel({ messages, draft, onDraftChange, onSend, onGenerateRouter, loading, budget, selectedNode }) {
  const remaining = budget?.remainingUsd;
  return (
    <aside className="assistant-panel" aria-label="Coding Agent">
      <div className="panel-heading">
        <span><Bot size={15} /> Coding Agent</span>
        <small>Terra coding assistant</small>
      </div>
      <div className="assistant-budget">
        <ShieldCheck size={14} />
        {budget ? `$${remaining.toFixed(2)} demo AI budget remaining` : 'Checking demo AI budget…'}
      </div>
      <div className="assistant-messages" aria-live="polite">
        {messages.length === 0 && <p>Ask how a harness works, share a run result, or select a Router and ask me to build it.</p>}
        {messages.map((entry, index) => <div className={`assistant-message ${entry.role}`} key={`${entry.role}-${index}`}><strong>{entry.role === 'user' ? 'You' : 'Coding Agent'}</strong><p>{entry.text}</p></div>)}
      </div>
      <div className="assistant-actions">
        <button disabled={loading || selectedNode?.data?.kind !== 'logic'} onClick={onGenerateRouter} type="button"><Code2 size={14} /> Build selected Router</button>
      </div>
      <form className="assistant-compose" onSubmit={(event) => { event.preventDefault(); onSend(); }}>
        <textarea value={draft} onChange={(event) => onDraftChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); onSend(); } }} placeholder="Ask about this graph or its latest test log…" rows="4" disabled={loading} />
        <button disabled={loading || !draft.trim()} type="submit"><Send size={15} /> {loading ? 'Working…' : 'Ask Coding Agent'}</button>
      </form>
    </aside>
  );
}
