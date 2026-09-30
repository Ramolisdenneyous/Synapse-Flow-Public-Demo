import { Bot, Braces, Database, Flag, Play, Search, ShieldCheck, UserRound, Wrench } from 'lucide-react';
import { NODE_KINDS } from '../model/catalog.js';

const icons = {
  trigger: Play,
  agent: Bot,
  user: UserRound,
  logic: Braces,
  governor: ShieldCheck,
  tool: Wrench,
  search: Search,
  memory: Database,
  output: Flag,
};

export default function NodePalette({ onAdd }) {
  return (
    <aside className="palette" aria-label="Node library">
      <div className="panel-heading">
        <span>Node library</span>
        <small>{Object.keys(NODE_KINDS).length} types</small>
      </div>
      <div className="palette-list">
        {Object.entries(NODE_KINDS).map(([kind, item]) => {
          const Icon = icons[kind];
          return (
            <button
              key={kind}
              className="palette-item"
              draggable
              onClick={() => onAdd(kind)}
              onDragStart={(event) => {
                event.dataTransfer.setData('application/synapse-node', kind);
                event.dataTransfer.effectAllowed = 'move';
              }}
              title={`Add ${item.label}`}
              type="button"
            >
              <span className="palette-icon" style={{ '--item-accent': item.color }}>
                <Icon size={17} />
              </span>
              <span>
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
