import { Handle, Position } from '@xyflow/react';
import {
  Bot,
  Braces,
  CircleStop,
  Database,
  Flag,
  Play,
  Search,
  ShieldCheck,
  UserRound,
  Wrench,
} from 'lucide-react';
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

function statusLabel(status) {
  if (status === 'idle') return 'Ready';
  if (status === 'complete') return 'Complete';
  if (status === 'waiting') return 'Waiting';
  if (status === 'running') return 'Running';
  if (status === 'queued') return 'Queued';
  return status;
}

export default function SynapseNode({ data, selected }) {
  const Icon = icons[data.kind] || CircleStop;
  const kind = NODE_KINDS[data.kind];
  const hasInput = data.inputType !== 'none';
  const hasOutput = data.outputType !== 'none';
  const stateLabel = statusLabel(data.status);
  const title = [
    data.label,
    `${data.inputType} -> ${data.outputType}`,
    data.activity || stateLabel,
  ].filter(Boolean).join('\n');

  return (
    <div
      className={`synapse-node kind-${data.kind} status-${data.status} ${selected ? 'is-selected' : ''}`}
      style={{ '--node-accent': kind?.color || '#7e8a91' }}
      title={title}
      aria-label={`${data.label}, ${kind?.label || data.kind}, ${stateLabel}`}
    >
      {hasInput && (
        <Handle
          id="input"
          className="node-handle node-handle-input"
          type="target"
          position={Position.Left}
          style={{ top: 47, left: 11 }}
          title="Execution input"
        />
      )}
      {data.kind === 'user' && (
        <Handle
          id="read"
          className="node-handle node-handle-read"
          type="target"
          position={Position.Top}
          title="Observe output without activating this node"
        />
      )}
      <div className="node-orb">
        <span className="node-kind">{kind?.label || data.kind}</span>
        <div className="node-visual" aria-hidden="true">
          <Icon size={26} strokeWidth={1.7} />
        </div>
        <span className={`node-orb-state node-state-${data.status}`}>
          <i />
          {stateLabel}
        </span>
      </div>
      <div className="node-copy">
        <strong>{data.label}</strong>
      </div>
      {hasOutput && (
        <Handle
          className="node-handle node-handle-output"
          type="source"
          position={Position.Right}
          style={{ top: 47, right: 11 }}
          title="Execution or capability output"
        />
      )}
    </div>
  );
}
