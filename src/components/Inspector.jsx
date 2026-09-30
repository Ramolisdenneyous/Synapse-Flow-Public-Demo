import { useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  Code2,
  LoaderCircle,
  Play,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';

function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function formatOutput(value) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatOutputTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
}

function parseSearchOutput(value) {
  if (!value) return null;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export default function Inspector({
  node,
  nodes,
  edges,
  selectedEdgeId,
  running,
  routerJob,
  onChange,
  onDelete,
  onSelectConnection,
  onDeleteConnection,
  onFireTrigger,
  onGenerateRouter,
  onSubmitUserInput,
}) {
  const [showRouterCode, setShowRouterCode] = useState(false);
  const [manualResponse, setManualResponse] = useState('');
  const [manualError, setManualError] = useState('');

  useEffect(() => {
    setShowRouterCode(false);
    setManualResponse('');
    setManualError('');
  }, [node?.id]);

  if (!node) {
    return (
      <aside className="inspector empty-inspector">
        <div className="panel-heading">
          <span>Inspector</span>
        </div>
        <div className="empty-state">
          <div className="selection-glyph" aria-hidden="true" />
          <strong>No node selected</strong>
          <span>Select a node to edit its contract.</span>
        </div>
      </aside>
    );
  }

  const updateData = (key, value) => onChange({ ...node.data, [key]: value });
  const updateConfig = (key, value) =>
    onChange({ ...node.data, config: { ...node.data.config, [key]: value } });
  const config = node.data.config || {};
  const searchOutput = node.data.kind === 'search'
    ? parseSearchOutput(node.data.lastOutput)
    : null;
  const searchSources = searchOutput
    ? [...(searchOutput.sources || []), ...(searchOutput.results || [])]
    : [];
  const nodeById = new Map(nodes.map((candidate) => [candidate.id, candidate]));
  const connections = edges
    .filter((edge) => edge.source === node.id || edge.target === node.id)
    .map((edge) => {
      const incoming = edge.target === node.id;
      const otherId = incoming ? edge.source : edge.target;
      return {
        edge,
        direction: incoming ? 'In' : 'Out',
        otherLabel: nodeById.get(otherId)?.data.label || otherId,
        channel: edge.data?.channel || 'data',
      };
    });
  const connectedSearchNodes = node.data.kind === 'agent'
    ? edges
        .filter((edge) => edge.source === node.id && edge.data?.channel === 'tool')
        .map((edge) => nodeById.get(edge.target))
        .filter((candidate) => candidate?.data.kind === 'search')
    : [];
  const randomRouterNeedsRegeneration =
    node.data.kind === 'logic' &&
    Boolean(config.generatedCode) &&
    /\b(?:random|randomly|dice|die|roll|chance|shuffle|sample|lottery)\b/i.test(
      config.routerPrompt || '',
    ) &&
    !/\bcontext\s*\.\s*runtime\s*\.\s*randomValue\b/.test(config.generatedCode);

  return (
    <aside className="inspector">
      <div className="panel-heading">
        <span>Inspector</span>
        <button
          className="icon-button danger"
          onClick={onDelete}
          disabled={running}
          title={running ? 'Stop the run before deleting this node.' : 'Delete node'}
          type="button"
        >
          <Trash2 size={16} />
        </button>
      </div>
      <div className="inspector-scroll">
        <div className="contract-strip">
          <span>{node.data.inputType}</span>
          <span>→</span>
          <span>{node.data.outputType}</span>
        </div>
        <Field label="Name">
          <input value={node.data.label} onChange={(event) => updateData('label', event.target.value)} />
        </Field>
        <section className="connection-manager" aria-label="Node connections">
          <div className="connection-manager-heading">
            <span>Connections</span>
            <strong>{connections.length}</strong>
          </div>
          {connections.length ? (
            <div className="connection-list">
              {connections.map(({ edge, direction, otherLabel, channel }) => (
                <div
                  className={`connection-row ${selectedEdgeId === edge.id ? 'is-selected' : ''}`}
                  key={edge.id}
                >
                  <button
                    className="connection-select"
                    onClick={() => onSelectConnection(edge.id)}
                    aria-pressed={selectedEdgeId === edge.id}
                    title={`Select ${direction.toLowerCase()}going connection with ${otherLabel}`}
                    type="button"
                  >
                    <span className={`connection-direction direction-${direction.toLowerCase()}`}>
                      {direction}
                    </span>
                    <span className="connection-copy">
                      <strong>{otherLabel}</strong>
                      <small>{channel}</small>
                    </span>
                  </button>
                  <button
                    className="connection-delete"
                    onClick={() => onDeleteConnection(edge.id)}
                    title={`Delete connection with ${otherLabel}`}
                    type="button"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="connection-empty">No connections.</div>
          )}
        </section>
        <Field label="Purpose">
          <textarea
            rows="3"
            value={node.data.description}
            onChange={(event) => updateData('description', event.target.value)}
          />
        </Field>
        <div className="field-grid">
          <Field label="Input type">
            <input
              value={node.data.inputType}
              onChange={(event) => updateData('inputType', event.target.value)}
            />
          </Field>
          <Field label="Output type">
            <input
              value={node.data.outputType}
              onChange={(event) => updateData('outputType', event.target.value)}
            />
          </Field>
        </div>

        {node.data.kind === 'trigger' && (
          <>
            <button
              className="fire-trigger-button"
              onClick={onFireTrigger}
              disabled={running}
              title={running ? 'Stop the active run before firing another trigger.' : 'Fire this trigger'}
              type="button"
            >
              <Play size={17} fill="currentColor" />
              {running ? 'Run in progress' : 'Fire Trigger'}
            </button>
            <Field label="Start payload">
              <textarea
                rows="7"
                value={config.payload}
                onChange={(event) => updateConfig('payload', event.target.value)}
              />
            </Field>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={Boolean(config.continueState)}
                onChange={(event) => updateConfig('continueState', event.target.checked)}
              />
              <span>
                <strong>Continue prior run state</strong>
                <small>Manual fires retain Router and Memory state for this unchanged graph.</small>
              </span>
            </label>
          </>
        )}

        {node.data.kind === 'agent' && (
          <>
            <Field label="System prompt">
              <textarea
                rows="9"
                value={config.systemPrompt}
                onChange={(event) => updateConfig('systemPrompt', event.target.value)}
              />
            </Field>
            {connectedSearchNodes.length > 0 && (
              <div className="runtime-search-notice">
                <span>Runtime search instructions</span>
                <p>
                  Synapse Flow appends capability and untrusted-content safety instructions for:
                </p>
                {connectedSearchNodes.map((searchNode) => (
                  <strong key={searchNode.id}>
                    {searchNode.data.config?.functionName || searchNode.data.label}
                    {' - '}
                    {searchNode.data.config?.provider || 'web'}
                  </strong>
                ))}
              </div>
            )}
            <div className="field-grid">
              <Field label="Reasoning">
                <select
                  value={config.reasoningEffort}
                  onChange={(event) => updateConfig('reasoningEffort', event.target.value)}
                >
                  {['none', 'low', 'medium', 'high', 'xhigh', 'max'].map((effort) => (
                    <option key={effort}>{effort}</option>
                  ))}
                </select>
              </Field>
              <Field label="Max output">
                <input
                  type="number"
                  min="100"
                  max="4000"
                  step="100"
                  value={config.maxOutputTokens}
                  onChange={(event) => updateConfig('maxOutputTokens', Number(event.target.value))}
                />
              </Field>
            </div>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={Boolean(config.requireToolCall)}
                onChange={(event) => updateConfig('requireToolCall', event.target.checked)}
              />
              <span>
                <strong>Require a Tool call</strong>
                <small>The Agent must call a connected Tool before completing.</small>
              </span>
            </label>
            <Field label="Node output">
              <select
                value={config.outputMode || 'text'}
                onChange={(event) => updateConfig('outputMode', event.target.value)}
              >
                <option value="text">Final agent text</option>
                <option value="tool_call">Tool call envelope</option>
              </select>
            </Field>
            <div className="agent-output-viewer">
              <div className="agent-output-heading">
                <span>Agent outputs</span>
                <strong>{node.data.outputHistory?.length || 0}</strong>
              </div>
              {node.data.outputHistory?.length ? (
                <div className="agent-output-list">
                  {[...node.data.outputHistory].reverse().map((entry) => (
                    <div className="agent-output-entry" key={entry.id}>
                      <div className="agent-output-meta">
                        <strong>Output {entry.sequence}</strong>
                        <span>
                          {[formatOutputTime(entry.recordedAt), entry.model]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                        {entry.totalTokens !== null && entry.totalTokens !== undefined && (
                          <span>{entry.totalTokens} tokens</span>
                        )}
                      </div>
                      <pre>{formatOutput(entry.output)}</pre>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="agent-output-empty">No outputs in this run.</div>
              )}
            </div>
          </>
        )}

        {node.data.kind === 'user' && (
          <>
            <div className="user-mode-control" aria-label="User Input mode">
              <button
                className={config.mode !== 'auto' ? 'is-active' : ''}
                onClick={() => updateConfig('mode', 'manual')}
                disabled={running}
                type="button"
              >
                Manual
              </button>
              <button
                className={config.mode === 'auto' ? 'is-active' : ''}
                onClick={() => updateConfig('mode', 'auto')}
                disabled={running}
                type="button"
              >
                Auto
              </button>
            </div>

            {config.mode === 'auto' ? (
              <>
                <Field label="Simulated user system prompt">
                  <textarea
                    rows="9"
                    value={config.systemPrompt || ''}
                    onChange={(event) => updateConfig('systemPrompt', event.target.value)}
                  />
                </Field>
                <div className="field-grid">
                  <Field label="Reasoning">
                    <select
                      value={config.reasoningEffort || 'low'}
                      onChange={(event) => updateConfig('reasoningEffort', event.target.value)}
                    >
                      {['none', 'low', 'medium', 'high', 'xhigh', 'max'].map((effort) => (
                        <option key={effort}>{effort}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Max output">
                    <input
                      type="number"
                      min="100"
                      max="4000"
                      step="100"
                      value={config.maxOutputTokens || 700}
                      onChange={(event) =>
                        updateConfig('maxOutputTokens', Number(event.target.value))
                      }
                    />
                  </Field>
                </div>
                <div className="prose-contract">
                  Auto responses are restricted to natural-language prose. Structured data and code are rejected.
                </div>
              </>
            ) : node.data.pendingUserInput ? (
              <section className="manual-user-panel" aria-label="Manual user response">
                <div className="manual-user-status">
                  <span>Waiting for your response</span>
                  <strong>Session active</strong>
                </div>
                <div className="manual-user-context">
                  <span>Incoming event</span>
                  <pre>{formatOutput(node.data.pendingUserInput.incoming)}</pre>
                </div>
                {Object.keys(node.data.pendingUserInput.observedContext || {}).length > 0 && (
                  <div className="manual-user-context">
                    <span>Observed outputs</span>
                    {Object.entries(node.data.pendingUserInput.observedContext).map(
                      ([label, value]) => (
                        <div className="observed-output" key={label}>
                          <strong>{label}</strong>
                          <pre>{formatOutput(value)}</pre>
                        </div>
                      ),
                    )}
                  </div>
                )}
                <Field label="Your response">
                  <textarea
                    rows="7"
                    value={manualResponse}
                    onChange={(event) => {
                      setManualResponse(event.target.value);
                      setManualError('');
                    }}
                    placeholder="Respond naturally in prose..."
                  />
                </Field>
                {manualError && <div className="manual-user-error">{manualError}</div>}
                <button
                  className="submit-user-response"
                  onClick={() => {
                    const result = onSubmitUserInput(node.id, manualResponse);
                    if (!result.ok) {
                      setManualError(result.error);
                      return;
                    }
                    setManualResponse('');
                    setManualError('');
                  }}
                  type="button"
                >
                  <Send size={16} />
                  Submit response
                </button>
              </section>
            ) : (
              <div className="manual-user-idle">
                This node will hold its active event here until you submit prose.
              </div>
            )}

            <div className="agent-output-viewer user-output-viewer">
              <div className="agent-output-heading">
                <span>User responses</span>
                <strong>{node.data.outputHistory?.length || 0}</strong>
              </div>
              {node.data.outputHistory?.length ? (
                <div className="agent-output-list">
                  {[...node.data.outputHistory].reverse().map((entry) => (
                    <div className="agent-output-entry" key={entry.id}>
                      <div className="agent-output-meta">
                        <strong>Response {entry.sequence}</strong>
                        <span>
                          {[formatOutputTime(entry.recordedAt), entry.mode || entry.model]
                            .filter(Boolean)
                            .join(' Â· ')}
                        </span>
                        {entry.totalTokens !== null && entry.totalTokens !== undefined && (
                          <span>{entry.totalTokens} tokens</span>
                        )}
                      </div>
                      <pre>{formatOutput(entry.output)}</pre>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="agent-output-empty">No responses in this run.</div>
              )}
            </div>
          </>
        )}

        {node.data.kind === 'governor' && (
          <>
            <Field label="Stop on activation">
              <input
                type="number"
                min="1"
                max="10000"
                step="1"
                value={config.maxActivations}
                onChange={(event) =>
                  updateConfig(
                    'maxActivations',
                    Math.max(1, Math.min(10000, Number(event.target.value) || 1)),
                  )
                }
              />
            </Field>
            <Field label="Optional stop phrase">
              <input
                value={config.stopPhrase || ''}
                onChange={(event) => updateConfig('stopPhrase', event.target.value)}
                placeholder="Example: task complete"
              />
            </Field>
          </>
        )}

        {node.data.kind === 'logic' && (
          <>
            <Field label="Routing intent">
              <textarea
                rows="8"
                value={config.routerPrompt || ''}
                onChange={(event) => updateConfig('routerPrompt', event.target.value)}
                placeholder="Describe how this router should make decisions, transform data, and use its private state."
              />
            </Field>
            <button
              className="generate-router-button"
              onClick={onGenerateRouter}
              disabled={
                running ||
                !config.routerPrompt?.trim() ||
                ['queued', 'generating', 'validating'].includes(routerJob?.status)
              }
              type="button"
            >
              {['queued', 'generating', 'validating'].includes(routerJob?.status) ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Sparkles size={16} />
              )}
              {routerJob?.status === 'validating'
                ? 'Validating code'
                : ['queued', 'generating'].includes(routerJob?.status)
                  ? 'Codex is building'
                  : config.generatedCode
                    ? 'Regenerate with Codex'
                    : 'Build with Codex'}
            </button>
            {routerJob && (
              <div className={`router-job-status status-${routerJob.status}`}>
                {routerJob.status === 'completed' ? (
                  <Check size={14} />
                ) : routerJob.status === 'failed' ? (
                  <AlertCircle size={14} />
                ) : (
                  <LoaderCircle className="spin" size={14} />
                )}
                <span>{routerJob.error || routerJob.message}</span>
              </div>
            )}
            {config.generatedCode && (
              <>
                {randomRouterNeedsRegeneration && (
                  <div className="router-regeneration-warning">
                    <AlertCircle size={14} />
                    <span>
                      This code predates runtime randomness. Regenerate it before the next run.
                    </span>
                  </div>
                )}
                <div className="generated-router-summary">
                  <Check size={14} />
                  <span>{config.generatedSummary || 'Generated router is ready.'}</span>
                </div>
                <button
                  className="view-code-button"
                  onClick={() => setShowRouterCode((visible) => !visible)}
                  type="button"
                >
                  {showRouterCode ? <X size={15} /> : <Code2 size={15} />}
                  {showRouterCode ? 'Close code' : 'View current code'}
                </button>
                {showRouterCode && (
                  <pre className="router-code-viewer">{config.generatedCode}</pre>
                )}
              </>
            )}
            <Field label="Operation">
              <select
                value={config.operation}
                onChange={(event) => updateConfig('operation', event.target.value)}
              >
                {config.generatedCode && (
                  <option value="generated">Generated code</option>
                )}
                <option value="passthrough">Pass through</option>
                <option value="route">Route by keyword</option>
                <option value="filter">Filter</option>
                <option value="template">Template</option>
              </select>
            </Field>
            {(config.operation === 'route' || config.operation === 'filter') && (
              <Field label="Rules">
                <textarea
                  rows="7"
                  value={config.rules}
                  onChange={(event) => updateConfig('rules', event.target.value)}
                  placeholder={'urgent => Review\n* => Archive'}
                />
              </Field>
            )}
            {config.operation === 'template' && (
              <Field label="Template">
                <textarea
                  rows="6"
                  value={config.template}
                  onChange={(event) => updateConfig('template', event.target.value)}
                />
              </Field>
            )}
          </>
        )}

        {node.data.kind === 'tool' && (
          <>
            <Field label="Function name">
              <input
                value={config.functionName || ''}
                onChange={(event) => updateConfig('functionName', event.target.value)}
              />
            </Field>
            <Field label="Function description">
              <textarea
                rows="4"
                value={config.functionDescription || ''}
                onChange={(event) => updateConfig('functionDescription', event.target.value)}
              />
            </Field>
            <Field label="Argument schema">
              <textarea
                rows="9"
                value={config.parametersSchema || ''}
                onChange={(event) => updateConfig('parametersSchema', event.target.value)}
              />
            </Field>
            <Field label="Mode">
              <select value={config.mode} onChange={(event) => updateConfig('mode', event.target.value)}>
                <option value="mock">Fixed mock</option>
                <option value="llm">Luna simulation</option>
              </select>
            </Field>
            {config.mode === 'mock' ? (
              <Field label="Mock response">
                <textarea
                  rows="7"
                  value={config.mockResponse}
                  onChange={(event) => updateConfig('mockResponse', event.target.value)}
                />
              </Field>
            ) : (
              <Field label="Capability description">
                <textarea
                  rows="7"
                  value={config.behaviorPrompt}
                  onChange={(event) => updateConfig('behaviorPrompt', event.target.value)}
                />
              </Field>
            )}
          </>
        )}

        {node.data.kind === 'search' && (
          <>
            <Field label="Search provider">
              <select
                value={config.provider || 'web'}
                onChange={(event) => updateConfig('provider', event.target.value)}
              >
                <option value="web">General web search</option>
                <option value="wikipedia">Wikipedia</option>
                <option value="openlibrary">Open Library</option>
                <option value="localrag" disabled>Local RAG index — disabled in Public Demo</option>
                <option value="custom">Custom JSON API — disabled in Public Demo</option>
              </select>
            </Field>
            <Field label="Function name">
              <input
                value={config.functionName || ''}
                onChange={(event) => updateConfig('functionName', event.target.value)}
              />
            </Field>
            <Field label="Function description">
              <textarea
                rows="4"
                value={config.functionDescription || ''}
                onChange={(event) => updateConfig('functionDescription', event.target.value)}
              />
            </Field>
            <Field label="Agent usage instructions">
              <textarea
                rows="5"
                value={config.usageInstructions || ''}
                onChange={(event) => updateConfig('usageInstructions', event.target.value)}
              />
            </Field>
            <Field label="Maximum results">
              <input
                type="number"
                min="1"
                max="10"
                value={config.maxResults || 5}
                onChange={(event) => updateConfig('maxResults', Number(event.target.value))}
              />
            </Field>
            {config.provider === 'web' && (
              <>
                <div className="user-mode-control search-mode-control" aria-label="Web search mode">
                  <button
                    className={config.searchMode === 'raw' ? 'is-active' : ''}
                    onClick={() => updateConfig('searchMode', 'raw')}
                    disabled={running}
                    type="button"
                  >
                    Raw Search
                  </button>
                  <button
                    className={config.searchMode !== 'raw' ? 'is-active' : ''}
                    onClick={() => updateConfig('searchMode', 'assisted')}
                    disabled={running}
                    type="button"
                  >
                    Assisted Search
                  </button>
                </div>
                <Field label="Search context">
                  <select
                    value={config.searchContextSize || 'low'}
                    onChange={(event) => updateConfig('searchContextSize', event.target.value)}
                  >
                    <option value="low">Low - quick lookup</option>
                    <option value="medium">Medium - balanced</option>
                    <option value="high">High - detailed</option>
                  </select>
                </Field>
                <Field label="Allowed domains">
                  <textarea
                    rows="3"
                    value={config.allowedDomains || ''}
                    onChange={(event) => updateConfig('allowedDomains', event.target.value)}
                    placeholder="example.com, docs.example.org"
                  />
                </Field>
                <Field label="Blocked domains">
                  <textarea
                    rows="3"
                    value={config.blockedDomains || ''}
                    onChange={(event) => updateConfig('blockedDomains', event.target.value)}
                    placeholder="example.net"
                  />
                </Field>
              </>
            )}
            {config.provider === 'localrag' && (
              <div className="public-demo-notice">RAG is disabled in the Public Demo. The original feature used a local server file path and will return here only with secure uploaded libraries.</div>
            )}
            {config.provider === 'custom' && (
              <div className="public-demo-notice">Custom endpoints are disabled in the Public Demo to protect the hosted service.</div>
            )}
          </>
        )}

        {node.data.kind === 'memory' && (
          <>
            <Field label="Write behavior">
              <select
                value={config.operation}
                onChange={(event) => updateConfig('operation', event.target.value)}
              >
                <option value="append">Append entries</option>
                <option value="replace">Replace value</option>
              </select>
            </Field>
            <Field label="Initial value">
              <textarea
                rows="6"
                value={config.initialValue}
                onChange={(event) => updateConfig('initialValue', event.target.value)}
              />
            </Field>
            <div className="memory-viewer">
              <div className="memory-viewer-heading">
                <span>Stored entries</span>
                <strong>{node.data.memoryEntries?.length || 0}</strong>
              </div>
              {node.data.memoryEntries?.length ? (
                <div className="memory-entry-list">
                  {node.data.memoryEntries.map((entry, index) => (
                    <div className="memory-entry" key={`${index}-${String(entry).length}`}>
                      <span>Entry {index + 1}</span>
                      <pre>
                        {typeof entry === 'string'
                          ? entry
                          : JSON.stringify(entry, null, 2)}
                      </pre>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="memory-empty">No entries stored in this run.</div>
              )}
            </div>
          </>
        )}

        {node.data.kind === 'search' && (
          <div className="search-output-viewer">
            <span>Last search result</span>
            {searchOutput ? (
              <>
                <pre>{searchOutput.answer || JSON.stringify(searchOutput.data || searchOutput, null, 2)}</pre>
                {searchSources.length > 0 && (
                  <div className="search-source-list">
                    {searchSources.map((source, index) => {
                      const content = (
                        <>
                          <strong>{source.title || source.document || source.url}</strong>
                          <span>{source.snippet || source.url || `Relevance ${source.score ?? 'n/a'}`}</span>
                        </>
                      );
                      return source.url ? (
                        <a
                          href={source.url}
                          key={`${source.url}-${index}`}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {content}
                        </a>
                      ) : (
                        <div className="search-source-record" key={`${source.document || source.title}-${source.page}-${index}`}>
                          {content}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              <pre>{node.data.lastOutput || 'No search completed yet.'}</pre>
            )}
          </div>
        )}

        {!['memory', 'agent', 'user', 'search'].includes(node.data.kind) && (
          <div className="last-output">
            <span>Last output</span>
            <pre>{node.data.lastOutput || 'No output yet.'}</pre>
          </div>
        )}
      </div>
    </aside>
  );
}
