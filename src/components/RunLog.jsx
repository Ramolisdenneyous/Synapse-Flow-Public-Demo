import { AlertTriangle, Check, CircleDot, Pause, Play, Route } from 'lucide-react';

const icons = {
  error: AlertTriangle,
  warning: AlertTriangle,
  complete: Check,
  route: Route,
  start: CircleDot,
  info: CircleDot,
  pause: Pause,
  resume: Play,
};

export default function RunLog({ logs, sessionId, onClear }) {
  return (
    <section className="run-log" aria-label="Simulation log">
      <div className="log-heading">
        <span>Run trace</span>
        {sessionId && (
          <span className="session-id" title={sessionId}>
            Session {sessionId.slice(0, 8)}
          </span>
        )}
        <span className="log-count">{logs.length} events</span>
        <button onClick={onClear} type="button">
          Clear
        </button>
      </div>
      <div className="log-items">
        {logs.length === 0 ? (
          <div className="log-empty">Run the harness to inspect each event.</div>
        ) : (
          logs.map((entry) => {
            const Icon = icons[entry.type] || CircleDot;
            return (
              <div className={`log-entry log-${entry.type}`} key={entry.id}>
                <Icon size={14} />
                <time>{entry.time}</time>
                <strong>{entry.nodeLabel || 'Runtime'}</strong>
                <span>{entry.message}</span>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
