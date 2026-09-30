import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import SynapseNode from './components/SynapseNode.jsx';
import NodePalette from './components/NodePalette.jsx';
import TopBar from './components/TopBar.jsx';
import Inspector from './components/Inspector.jsx';
import RunLog from './components/RunLog.jsx';
import AssistantPanel from './components/AssistantPanel.jsx';
import {
  CHANNEL_COLORS,
  acceptsReadContext,
  createNode,
  inferChannel,
} from './model/catalog.js';
import { createStarterGraph } from './model/defaultGraph.js';
import { DEFAULT_DEMO, DEMOS } from './model/demos.js';
import {
  connectedToolsFor,
  executeNode,
  isProseResponse,
  nextTargets,
  readableContextFor,
  readableMemoryFor,
  routerContextFor,
} from './engine/executor.js';
import { drainParallel, drainSequential } from './engine/scheduler.js';
import { diagnoseGraph } from './engine/graphDiagnostics.js';
import {
  continuationGraphKey,
  initializeRunState,
} from './engine/continuation.js';
import {
  createPortableProject,
  exportGraphMarkdown,
} from './model/exportMarkdown.js';
import { Trash2 } from 'lucide-react';
import { isPosition3d } from './three/graphLayout3d.js';

const STORAGE_KEY = 'synapse-flow:public-demo';
const MAX_EVENTS = 200;
const nodeTypes = { synapseNode: SynapseNode };
const Graph3DCanvas = lazy(() => import('./components/Graph3DCanvas.jsx'));

function downloadText(filename, contents, type) {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function now() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function withoutRuntimeEdgeClasses(value = '') {
  return String(value)
    .split(/\s+/)
    .filter(
      (name) =>
        name &&
        name !== 'edge-pulse' &&
        !name.startsWith('edge-pulse-'),
    )
    .join(' ');
}

async function readApiJson(response, fallbackMessage) {
  const text = await response.text();
  if (!text) {
    throw new Error(
      response.ok
        ? `${fallbackMessage} The server returned an empty response.`
        : `${fallbackMessage} HTTP ${response.status} returned an empty response.`,
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${fallbackMessage} The server returned an invalid response.`);
  }
}

function resetNodeRuntime(node) {
  return {
    ...node,
    data: {
      ...node.data,
      status: 'idle',
      activity: '',
      lastOutput: '',
      ...(['agent', 'user'].includes(node.data.kind) ? { outputHistory: [] } : {}),
      ...(node.data.kind === 'user' ? { pendingUserInput: null } : {}),
      ...(node.data.kind === 'memory' ? { memoryEntries: [] } : {}),
    },
  };
}

function normalizeNodeContracts(node) {
  const normalized = resetNodeRuntime({
    ...node,
    ...(isPosition3d(node.position3d)
      ? { position3d: { ...node.position3d } }
      : { position3d: undefined }),
    type: node.type || 'synapseNode',
    position: node.position || { x: 0, y: 0 },
    data: {
      ...node.data,
      config: node.data?.config || {},
    },
  });
  if (
    normalized.data.kind !== 'trigger' ||
    normalized.data.inputType === 'event'
  ) {
    return normalized;
  }
  return {
    ...normalized,
    data: {
      ...normalized.data,
      inputType: 'event',
    },
  };
}

function clearEdgeRuntime(edge) {
  const channel = edge.data?.channel || edge.channel || 'data';
  return {
    ...edge,
    type: 'default',
    label: channel,
    data: { ...(edge.data || {}), channel },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: CHANNEL_COLORS[channel] || CHANNEL_COLORS.data,
    },
    style: {
      ...(edge.style || {}),
      stroke: CHANNEL_COLORS[channel] || CHANNEL_COLORS.data,
      strokeWidth: 2,
    },
    selected: false,
    animated: false,
    className: withoutRuntimeEdgeClasses(edge.className),
  };
}

export default function App() {
  const starter = useMemo(() => structuredClone(DEFAULT_DEMO || createStarterGraph()), []);
  const [name, setName] = useState(starter.name);
  const [nodes, setNodes, onNodesChange] = useNodesState(starter.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(starter.edges);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
  const [edgeMenu, setEdgeMenu] = useState(null);
  const [executionMode, setExecutionMode] = useState('step');
  const [viewMode, setViewMode] = useState('2d');
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [queueSize, setQueueSize] = useState(0);
  const [logs, setLogs] = useState([]);
  const [sessionId, setSessionId] = useState(null);
  const [serverStatus, setServerStatus] = useState({ configured: false, model: 'checking' });
  const [routerJobs, setRouterJobs] = useState({});
  const [assistantMessages, setAssistantMessages] = useState([]);
  const [assistantDraft, setAssistantDraft] = useState('');
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [demoBudget, setDemoBudget] = useState(null);
  const { screenToFlowPosition, fitView } = useReactFlow();

  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const runGraphRef = useRef({ sessionId: null, nodes: [], edges: [] });
  const continuationGraphKeyRef = useRef(null);
  const queueRef = useRef([]);
  const memoryRef = useRef({});
  const routerStateRef = useRef({});
  const governorStateRef = useRef({});
  const nodeOutputsRef = useRef({});
  const pendingUserInputsRef = useRef(new Map());
  const runningRef = useRef(false);
  const pausedRef = useRef(false);
  const pausedAtRef = useRef(null);
  const resumeWaitersRef = useRef([]);
  const abortRef = useRef(null);
  const eventCountRef = useRef(0);
  const activeSessionRef = useRef(null);
  const logSequenceRef = useRef(0);
  const sessionLogChainsRef = useRef(new Map());
  const routerEventSourcesRef = useRef(new Map());
  const edgeAnimationTokensRef = useRef(new Map());

  const releasePausedLoop = useCallback(() => {
    const waiters = resumeWaitersRef.current.splice(0);
    for (const resolve of waiters) resolve();
  }, []);

  const waitForResume = useCallback(
    () =>
      pausedRef.current
        ? new Promise((resolve) => resumeWaitersRef.current.push(resolve))
        : Promise.resolve(),
    [],
  );

  const selectConnection = useCallback((edgeId, clearNode = false) => {
    setSelectedEdgeId(edgeId);
    setEdgeMenu(null);
    if (clearNode) setSelectedId(null);
    setEdges((current) =>
      current.map((edge) => ({ ...edge, selected: edge.id === edgeId })),
    );
  }, [setEdges]);

  const clearSelection = useCallback(() => {
    setSelectedId(null);
    setSelectedEdgeId(null);
    setEdgeMenu(null);
    setEdges((current) =>
      current.some((edge) => edge.selected)
        ? current.map((edge) => ({ ...edge, selected: false }))
        : current,
    );
  }, [setEdges]);

  const selectNode = useCallback((nodeId) => {
    setSelectedId(nodeId);
    setSelectedEdgeId(null);
    setEdgeMenu(null);
    setEdges((current) =>
      current.some((edge) => edge.selected)
        ? current.map((edge) => ({ ...edge, selected: false }))
        : current,
    );
  }, [setEdges]);

  const moveNode3d = useCallback((nodeId, position3d) => {
    setNodes((current) => current.map((node) =>
      node.id === nodeId ? { ...node, position3d: { ...position3d } } : node,
    ));
  }, [setNodes]);

  const deleteConnection = useCallback((edgeId) => {
    setEdges((current) => current.filter((edge) => edge.id !== edgeId));
    setSelectedEdgeId((current) => (current === edgeId ? null : current));
    setEdgeMenu((current) => (current?.edgeId === edgeId ? null : current));
  }, [setEdges]);

  const deleteNode = useCallback((nodeId) => {
    if (runningRef.current) return;
    setNodes((current) => current.filter((node) => node.id !== nodeId));
    setEdges((current) =>
      current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
    );
    setSelectedId((current) => (current === nodeId ? null : current));
    setSelectedEdgeId(null);
    setEdgeMenu(null);
  }, [setEdges, setNodes]);

  useEffect(() => () => {
    for (const source of routerEventSourcesRef.current.values()) source.close();
    routerEventSourcesRef.current.clear();
  }, []);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    edgesRef.current = edges;
    if (selectedEdgeId && !edges.some((edge) => edge.id === selectedEdgeId)) {
      setSelectedEdgeId(null);
      setEdgeMenu(null);
    }
  }, [edges, selectedEdgeId]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setEdgeMenu(null);
        return;
      }
      if (
        !['Delete', 'Backspace'].includes(event.key) ||
        event.target.closest('input, textarea, select, [contenteditable="true"]')
      ) {
        return;
      }
      if (!selectedEdgeId && !selectedId) return;
      event.preventDefault();
      if (selectedEdgeId) {
        deleteConnection(selectedEdgeId);
      } else {
        deleteNode(selectedId);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleteConnection, deleteNode, selectedEdgeId, selectedId]);

  useEffect(() => {
    setEdges((current) => {
      let changed = false;
      const normalized = current.map((edge) => {
        const source = nodes.find((node) => node.id === edge.source);
        const target = nodes.find((node) => node.id === edge.target);
        if (
          source?.data.kind === 'memory' &&
          !acceptsReadContext(target) &&
          edge.data?.channel === 'read'
        ) {
          changed = true;
          return {
            ...edge,
            label: 'data',
            data: { ...edge.data, channel: 'data' },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: CHANNEL_COLORS.data,
            },
            style: { ...edge.style, stroke: CHANNEL_COLORS.data },
          };
        }
        return edge;
      });
      return changed ? normalized : current;
    });
  }, [nodes, setEdges]);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    try {
      const project = JSON.parse(saved);
      if (!Array.isArray(project.nodes) || !Array.isArray(project.edges)) return;
      setName(project.name || 'Untitled Harness');
      setNodes(project.nodes.map(normalizeNodeContracts));
      setEdges(project.edges.map(clearEdgeRuntime));
      window.setTimeout(() => fitView({ padding: 0.16 }), 50);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [fitView, setEdges, setNodes]);

  useEffect(() => {
    fetch('/api/health')
      .then((response) => response.json())
      .then((status) => {
        setServerStatus(status);
        setDemoBudget(status.budget || null);
      })
      .catch(() => setServerStatus({ configured: false, model: 'offline' }));
  }, []);

  const addLog = useCallback((type, nodeLabel, message, runSessionId = activeSessionRef.current, details = null) => {
    const entry = {
      id: crypto.randomUUID(),
      sequence: ++logSequenceRef.current,
      type,
      nodeLabel,
      message,
      details,
      time: now(),
      timestamp: Date.now(),
    };
    setLogs((current) => [...current, entry].slice(-500));
    if (runSessionId) {
      const previous =
        sessionLogChainsRef.current.get(runSessionId) || Promise.resolve();
      const next = previous
        .then(() =>
          fetch(`/api/sessions/${runSessionId}/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(entry),
          }),
        )
        .catch(() => {});
      sessionLogChainsRef.current.set(runSessionId, next);
    }
  }, []);

  const updateNodeRuntime = useCallback((nodeId, updates) => {
    setNodes((current) =>
      current.map((node) => {
        if (node.id !== nodeId) return node;
        const resolvedUpdates =
          typeof updates === 'function' ? updates(node.data) : updates;
        return { ...node, data: { ...node.data, ...resolvedUpdates } };
      }),
    );
  }, [setNodes]);

  const flashEdge = useCallback((edgeId, phase = 'forward', durationMs = 900) => {
    const token = crypto.randomUUID();
    edgeAnimationTokensRef.current.set(edgeId, token);
    setEdges((current) =>
      current.map((edge) =>
        edge.id === edgeId
          ? {
              ...edge,
              animated: true,
              className: [
                withoutRuntimeEdgeClasses(edge.className),
                'edge-pulse',
                `edge-pulse-${phase}`,
              ].filter(Boolean).join(' '),
            }
          : edge,
      ),
    );
    window.setTimeout(() => {
      if (edgeAnimationTokensRef.current.get(edgeId) !== token) return;
      edgeAnimationTokensRef.current.delete(edgeId);
      setEdges((current) =>
        current.map((edge) =>
          edge.id === edgeId
            ? {
                ...edge,
                animated: false,
                className: withoutRuntimeEdgeClasses(edge.className),
              }
            : edge,
        ),
      );
    }, durationMs);
  }, [setEdges]);

  const callLLM = useCallback(async (payload) => {
    const response = await fetch('/api/llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: abortRef.current?.signal,
    });
    const body = await readApiJson(response, 'Luna request failed.');
    if (body.budget) setDemoBudget(body.budget);
    if (!response.ok) throw new Error(body.error || 'Luna request failed.');
    return body;
  }, []);

  const callSearch = useCallback(async (payload) => {
    const response = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: abortRef.current?.signal,
    });
    const body = await readApiJson(response, 'API Search failed.');
    if (!response.ok) throw new Error(body.error || 'API Search failed.');
    return body;
  }, []);

  const runRouter = useCallback(async (payload) => {
    const response = await fetch('/api/router/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: abortRef.current?.signal,
    });
    const body = await readApiJson(response, 'Generated router failed.');
    if (!response.ok) throw new Error(body.error || 'Generated router failed.');
    return body;
  }, []);

  const requestManualUserInput = useCallback(({
    node,
    input,
    readableContext,
    runSessionId,
  }) => {
    if (pendingUserInputsRef.current.has(node.id)) {
      return Promise.reject(
        new Error('This User Input node is already waiting for a response.'),
      );
    }
    return new Promise((resolve, reject) => {
      pendingUserInputsRef.current.set(node.id, {
        resolve,
        reject,
        runSessionId,
      });
      setSelectedId(node.id);
      setSelectedEdgeId(null);
      setEdgeMenu(null);
      setEdges((current) =>
        current.some((edge) => edge.selected)
          ? current.map((edge) => ({ ...edge, selected: false }))
          : current,
      );
      updateNodeRuntime(node.id, {
        status: 'waiting',
        activity: 'Waiting for user...',
        pendingUserInput: {
          incoming: structuredClone(input),
          observedContext: structuredClone(readableContext),
          sessionId: runSessionId,
        },
      });
      addLog(
        'wait',
        node.data.label,
        'Simulation is waiting for manual prose input.',
        runSessionId,
        { input, observedContext: readableContext },
      );
    });
  }, [addLog, setEdges, updateNodeRuntime]);

  const submitManualUserInput = useCallback((nodeId, response) => {
    const pending = pendingUserInputsRef.current.get(nodeId);
    if (!pending) {
      return { ok: false, error: 'This node is not currently waiting for input.' };
    }
    if (!isProseResponse(response)) {
      return {
        ok: false,
        error: 'Enter natural-language prose. JSON, code, and empty responses are not allowed.',
      };
    }
    if (pending.runSessionId !== activeSessionRef.current) {
      return { ok: false, error: 'That waiting session is no longer active.' };
    }
    pendingUserInputsRef.current.delete(nodeId);
    updateNodeRuntime(nodeId, {
      status: 'running',
      activity: 'Submitting response...',
      pendingUserInput: null,
    });
    addLog(
      'input',
      nodesRef.current.find((node) => node.id === nodeId)?.data.label || 'User Input',
      'Manual prose response submitted.',
      pending.runSessionId,
      { response: String(response).trim() },
    );
    pending.resolve(String(response).trim());
    return { ok: true };
  }, [addLog, updateNodeRuntime]);

  const cancelPendingUserInputs = useCallback(() => {
    for (const [nodeId, pending] of pendingUserInputsRef.current) {
      const error = new Error('Manual user input was cancelled.');
      error.name = 'AbortError';
      pending.reject(error);
      updateNodeRuntime(nodeId, {
        status: 'idle',
        activity: '',
        pendingUserInput: null,
      });
    }
    pendingUserInputsRef.current.clear();
  }, [updateNodeRuntime]);

  const processEvent = useCallback(async (event, runSessionId) => {
    if (
      !runningRef.current ||
      activeSessionRef.current !== runSessionId ||
      eventCountRef.current >= MAX_EVENTS
    ) {
      return [];
    }
    eventCountRef.current += 1;
    const eventNumber = eventCountRef.current;
    const startedAt = Date.now();

    const runGraph = runGraphRef.current;
    if (runGraph.sessionId !== runSessionId) return [];
    const currentNodes = runGraph.nodes;
    const currentEdges = runGraph.edges;
    const node = currentNodes.find((candidate) => candidate.id === event.nodeId);
    if (!node) {
      addLog(
        'error',
        'Runtime',
        `Queued event ${event.id} references missing node ${event.nodeId}.`,
        runSessionId,
        { event, graphNodeIds: currentNodes.map((candidate) => candidate.id) },
      );
      return [];
    }

    updateNodeRuntime(node.id, {
      status: 'running',
      activity:
        node.data.kind === 'agent'
          ? 'Calling Luna...'
          : node.data.kind === 'user' && node.data.config?.mode === 'auto'
            ? 'Simulating user...'
          : node.data.kind === 'memory'
            ? 'Updating memory...'
            : 'Running...',
    });
    addLog(
      'start',
      node.data.label,
      `Received ${event.channel || 'event'} at depth ${event.depth}.`,
      runSessionId,
      {
        event,
        eventNumber,
        queueLengthBeforeExecution: queueRef.current.length,
      },
    );

    try {
      const result = await executeNode(node, event.envelope, {
        callLLM: (payload) =>
          callLLM({
            ...payload,
            sessionId: runSessionId,
            nodeId: node.id,
            nodeLabel: node.data.label,
          }),
        memory: memoryRef.current,
        routerState: routerStateRef.current,
        governorState: governorStateRef.current,
        routerContext: routerContextFor(node, currentNodes, currentEdges),
        runRouter,
        sampleNonce: crypto.randomUUID(),
        readableMemory: readableMemoryFor(
          node,
          currentNodes,
          currentEdges,
          memoryRef.current,
        ),
        readableContext: readableContextFor(
          node,
          currentNodes,
          currentEdges,
          memoryRef.current,
          nodeOutputsRef.current,
        ),
        requestUserInput: ({ input, readableContext }) =>
          requestManualUserInput({
            node,
            input,
            readableContext,
            runSessionId,
          }),
        searchAPI: (payload) => callSearch({
          ...payload,
          sessionId: runSessionId,
          nodeId: node.id,
          nodeLabel: node.data.label,
        }),
        connectedTools: connectedToolsFor(node, currentNodes, currentEdges),
        executeTool: async ({ connectedTool, toolCall, arguments: toolArguments }) => {
          const toolNode = connectedTool.node;
          const capabilityType = toolNode.data.kind === 'search' ? 'API Search' : 'Tool';
          const toolStartedAt = Date.now();
          flashEdge(connectedTool.edgeId, 'tool-call', 1200);
          updateNodeRuntime(toolNode.id, {
            status: 'running',
            activity: `Called by ${node.data.label}...`,
          });
          addLog(
            'tool_call',
            node.data.label,
            `Called ${capabilityType} ${toolNode.data.label}.`,
            runSessionId,
            {
              callId: toolCall.callId,
              functionName: toolCall.name,
              arguments: toolArguments,
              agentNodeId: node.id,
              toolNodeId: toolNode.id,
              edgeId: connectedTool.edgeId,
            },
          );
          const toolResult = await executeNode(
            toolNode,
            { payload: toolArguments },
            {
              callLLM: (payload) =>
                callLLM({
                  ...payload,
                  sessionId: runSessionId,
                  nodeId: toolNode.id,
                  nodeLabel: toolNode.data.label,
                }),
              searchAPI: (payload) => callSearch({
                ...payload,
                sessionId: runSessionId,
                nodeId: toolNode.id,
                nodeLabel: toolNode.data.label,
              }),
              readableMemory: readableMemoryFor(
                toolNode,
                currentNodes,
                currentEdges,
                memoryRef.current,
              ),
            },
          );
          if (
            !runningRef.current ||
            activeSessionRef.current !== runSessionId
          ) {
            const error = new Error('Tool result belongs to a stopped session.');
            error.name = 'AbortError';
            throw error;
          }
          const toolPreview =
            typeof toolResult.payload === 'string'
              ? toolResult.payload
              : JSON.stringify(toolResult.payload, null, 2);
          nodeOutputsRef.current[toolNode.id] = structuredClone(toolResult.payload);
          updateNodeRuntime(toolNode.id, {
            status: 'complete',
            activity: '',
            lastOutput: toolPreview || '(empty)',
          });
          flashEdge(connectedTool.edgeId, 'tool-return', 1500);
          addLog(
            'tool_result',
            toolNode.data.label,
            `Returned ${capabilityType} result to ${node.data.label}.`,
            runSessionId,
            {
              callId: toolCall.callId,
              functionName: toolCall.name,
              output: toolResult.payload,
              durationMs: Date.now() - toolStartedAt,
              agentNodeId: node.id,
              toolNodeId: toolNode.id,
            },
          );
          return toolResult.payload;
        },
      });

      if (
        !runningRef.current ||
        activeSessionRef.current !== runSessionId
      ) {
        return [];
      }

      const preview =
        typeof result.payload === 'string'
          ? result.payload
          : JSON.stringify(result.payload, null, 2);
      nodeOutputsRef.current[node.id] = structuredClone(result.payload);
      updateNodeRuntime(node.id, (currentData) => {
        const outputHistory = currentData.outputHistory || [];
        return {
          status: 'complete',
          activity: '',
          lastOutput: preview || '(empty)',
          ...(['agent', 'user'].includes(node.data.kind)
            ? {
                outputHistory: [
                  ...outputHistory,
                  {
                    id: crypto.randomUUID(),
                    sequence: outputHistory.length + 1,
                    recordedAt: new Date().toISOString(),
                    output: result.payload,
                    model: result.meta?.model || null,
                    totalTokens: result.meta?.usage?.total_tokens ?? null,
                    mode: result.meta?.userMode || null,
                    sessionId: runSessionId,
                  },
                ].slice(-MAX_EVENTS),
              }
            : {}),
          ...(node.data.kind === 'user' ? { pendingUserInput: null } : {}),
          ...(node.data.kind === 'memory'
            ? {
                memoryEntries: Array.isArray(result.payload)
                  ? result.payload
                  : [result.payload],
              }
            : {}),
        };
      });
      addLog(
        result.meta?.governor?.blocked ? 'warning' : 'complete',
        node.data.label,
        result.meta?.governor?.blocked
          ? `Governor stopped the path after ${result.meta.governor.activations} activation${result.meta.governor.activations === 1 ? '' : 's'} (${result.meta.governor.reason.replaceAll('_', ' ')}).`
          : result.blocked
            ? 'Blocked the event.'
            : result.terminal
              ? 'Captured final output.'
              : 'Completed.',
        runSessionId,
        {
          output: result.payload,
          meta: result.meta || null,
          durationMs: Date.now() - startedAt,
          eventNumber,
          stateCheckpoint:
            node.data.kind === 'memory'
              ? {
                  kind: 'memory',
                  nodeId: node.id,
                  value: structuredClone(memoryRef.current[node.id]),
                }
              : node.data.kind === 'logic' && result.meta?.generatedRouter
                ? {
                    kind: 'router',
                    nodeId: node.id,
                    value: structuredClone(routerStateRef.current[node.id]),
                  }
                : node.data.kind === 'governor'
                  ? {
                      kind: 'governor',
                      nodeId: node.id,
                      value: structuredClone(governorStateRef.current[node.id]),
                    }
                  : null,
        },
      );

      const targets = nextTargets(node, result, currentNodes, currentEdges);
      return targets
        .map(({ edge, node: target }) => {
          const channel = edge.data?.channel || 'data';
          flashEdge(
            edge.id,
            channel === 'write' ? 'memory-write' : 'forward',
            channel === 'write' ? 1400 : 900,
          );
          updateNodeRuntime(target.id, { status: 'queued' });
          const routedEvent = {
            id: crypto.randomUUID(),
            nodeId: target.id,
            depth: event.depth + 1,
            channel: edge.data?.channel || 'data',
            envelope: {
              id: crypto.randomUUID(),
              type: node.data.outputType || 'event',
              payload: result.payload,
              sourceNodeId: node.id,
              createdAt: Date.now(),
            },
          };
          addLog(
            'route',
            node.data.label,
            `Sent ${edge.data?.channel || 'data'} to ${target.data.label}.`,
            runSessionId,
            {
              edgeId: edge.id,
              sourceNodeId: node.id,
              targetNodeId: target.id,
              channel: edge.data?.channel || 'data',
              sourceEventId: event.id,
              queuedEvent: routedEvent,
            },
          );
          return routedEvent;
        });
    } catch (error) {
      if (error.name !== 'AbortError') {
        updateNodeRuntime(node.id, {
          status: 'error',
          activity: '',
          lastOutput: error.message,
        });
        addLog('error', node.data.label, error.message, runSessionId, {
          stack: error.stack || null,
        });
      }
      return [];
    }
  }, [
    addLog,
    callLLM,
    callSearch,
    flashEdge,
    requestManualUserInput,
    runRouter,
    updateNodeRuntime,
  ]);

  const finishRun = useCallback((message = 'Queue is empty.', runSessionId = activeSessionRef.current, processedEvents = eventCountRef.current) => {
    if (activeSessionRef.current !== runSessionId) return;
    runningRef.current = false;
    cancelPendingUserInputs();
    pausedRef.current = false;
    pausedAtRef.current = null;
    releasePausedLoop();
    setRunning(false);
    setPaused(false);
    setQueueSize(queueRef.current.length);
    addLog('info', 'Runtime', message, runSessionId, {
      processedEvents,
      remainingEvents: queueRef.current.length,
    });
    const pendingLogs =
      sessionLogChainsRef.current.get(runSessionId) || Promise.resolve();
    const finishWrite = pendingLogs
      .then(() =>
        fetch(`/api/sessions/${runSessionId}/finish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reason: message,
            processedEvents,
            remainingEvents: queueRef.current.length,
            finalState: {
              memory: memoryRef.current,
              routerState: routerStateRef.current,
              governorState: governorStateRef.current,
            },
          }),
        }),
      )
      .catch(() => {});
    sessionLogChainsRef.current.set(runSessionId, finishWrite);
    finishWrite.finally(() => {
      if (sessionLogChainsRef.current.get(runSessionId) === finishWrite) {
        sessionLogChainsRef.current.delete(runSessionId);
      }
    });
  }, [addLog, cancelPendingUserInputs, releasePausedLoop]);

  const runLiveLoop = useCallback(async (runSessionId) => {
    const result = await drainParallel({
      sessionId: runSessionId,
      isActive: (id) =>
        runningRef.current && activeSessionRef.current === id,
      queue: queueRef.current,
      processEvent,
      onQueueChange: setQueueSize,
      isPaused: (id) =>
        pausedRef.current && activeSessionRef.current === id,
      waitForResume,
      maxEvents: MAX_EVENTS,
    });
    if (result.reason !== 'superseded') {
      finishRun(
        result.reason === 'limit'
          ? 'Stopped at the 200-event safety limit.'
          : 'Parallel run complete.',
        runSessionId,
        result.processed,
      );
    }
  }, [finishRun, processEvent, waitForResume]);

  const runSequentialLoop = useCallback(async (runSessionId) => {
    const result = await drainSequential({
      sessionId: runSessionId,
      isActive: (id) =>
        runningRef.current && activeSessionRef.current === id,
      queue: queueRef.current,
      processEvent,
      onQueueChange: setQueueSize,
      wait: () => new Promise((resolve) => window.setTimeout(resolve, 420)),
      isPaused: (id) =>
        pausedRef.current && activeSessionRef.current === id,
      waitForResume,
      maxEvents: MAX_EVENTS,
    });
    if (result.reason !== 'superseded') {
      finishRun(
        result.reason === 'limit'
          ? 'Stopped at the 200-event safety limit.'
          : 'Sequential run complete.',
        runSessionId,
        result.processed,
      );
    }
  }, [finishRun, processEvent, waitForResume]);

  const seedRun = useCallback(async (
    triggerIds = null,
    { preserveState = false } = {},
  ) => {
    const diagnostics = diagnoseGraph(nodesRef.current, edgesRef.current);
    const structuralErrors = diagnostics.filter(
      (diagnostic) => diagnostic.severity === 'error',
    );
    if (structuralErrors.length) {
      logSequenceRef.current = 0;
      setLogs([]);
      for (const diagnostic of diagnostics) {
        addLog(
          diagnostic.severity || 'warning',
          'Preflight',
          diagnostic.message,
          null,
          diagnostic,
        );
      }
      addLog(
        'error',
        'Preflight',
        `Run blocked by ${structuralErrors.length} structural error${structuralErrors.length === 1 ? '' : 's'}.`,
        null,
        { structuralErrors },
      );
      return null;
    }
    const previousSessionId = activeSessionRef.current;
    abortRef.current?.abort();
    cancelPendingUserInputs();
    pausedRef.current = false;
    pausedAtRef.current = null;
    releasePausedLoop();
    if (runningRef.current && previousSessionId) {
      queueRef.current = [];
      finishRun(
        'Superseded by a new run.',
        previousSessionId,
        eventCountRef.current,
      );
    }
    abortRef.current = new AbortController();
    const runSessionId = crypto.randomUUID();
    activeSessionRef.current = runSessionId;
    setSessionId(runSessionId);
    logSequenceRef.current = 0;
    const graphKey = continuationGraphKey(name, nodesRef.current, edgesRef.current);
    const continuedState =
      preserveState && continuationGraphKeyRef.current === graphKey;
    const nextState = initializeRunState(nodesRef.current, {
      preserve: continuedState,
      previousMemory: memoryRef.current,
      previousRouterState: routerStateRef.current,
    });
    memoryRef.current = nextState.memory;
    routerStateRef.current = nextState.routerState;
    governorStateRef.current = {};
    nodeOutputsRef.current = {};
    continuationGraphKeyRef.current = graphKey;
    eventCountRef.current = 0;
    setLogs([]);
    const runNodes = nodesRef.current.map(resetNodeRuntime);
    const runEdges = edgesRef.current.map(clearEdgeRuntime);
    runGraphRef.current = {
      sessionId: runSessionId,
      nodes: structuredClone(runNodes),
      edges: structuredClone(runEdges),
    };
    nodesRef.current = runNodes;
    setNodes(runNodes);
    queueRef.current = runGraphRef.current.nodes
      .filter(
        (node) =>
          node.data.kind === 'trigger' &&
          (!triggerIds || triggerIds.includes(node.id)),
      )
      .map((node) => ({
        id: crypto.randomUUID(),
        nodeId: node.id,
        depth: 0,
        channel: 'trigger',
        envelope: {
          id: crypto.randomUUID(),
          type: 'trigger',
          payload: node.data.config.payload,
          sourceNodeId: null,
          createdAt: Date.now(),
        },
      }));
    setQueueSize(queueRef.current.length);
    runningRef.current = true;
    pausedRef.current = false;
    setRunning(true);
    setPaused(false);
    try {
      await fetch('/api/sessions/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: runSessionId,
          name,
          executionMode: executionMode === 'live' ? 'parallel' : 'sequential',
          continuedState,
          graph: {
            nodes: runGraphRef.current.nodes,
            edges: runGraphRef.current.edges,
          },
        }),
      });
    } catch {
      // The in-app trace still works if disk logging is temporarily unavailable.
    }
    addLog(
      'info',
      'Runtime',
      `${continuedState ? 'Continued prior state and q' : 'Q'}ueued ${queueRef.current.length} trigger${queueRef.current.length === 1 ? '' : 's'}.`,
      runSessionId,
      {
        triggerIds,
        queueLength: queueRef.current.length,
        preserveStateRequested: preserveState,
        continuedState,
      },
    );
    for (const warning of diagnostics) {
      addLog(
        warning.severity || 'warning',
        'Preflight',
        warning.message,
        runSessionId,
        warning,
      );
    }
    return runSessionId;
  }, [
    addLog,
    cancelPendingUserInputs,
    executionMode,
    finishRun,
    name,
    releasePausedLoop,
    setNodes,
  ]);

  const onRun = useCallback(async () => {
    const runSessionId = await seedRun();
    if (!runSessionId) return;
    if (activeSessionRef.current !== runSessionId) return;
    if (executionMode === 'live') {
      runLiveLoop(runSessionId);
    } else {
      runSequentialLoop(runSessionId);
    }
  }, [executionMode, runLiveLoop, runSequentialLoop, seedRun]);

  const onStop = useCallback(() => {
    const runSessionId = activeSessionRef.current;
    const cancelledEvents = queueRef.current.length;
    abortRef.current?.abort();
    cancelPendingUserInputs();
    pausedRef.current = false;
    pausedAtRef.current = null;
    releasePausedLoop();
    queueRef.current = [];
    finishRun(
      cancelledEvents
        ? `Stopped by user; cancelled ${cancelledEvents} queued event${cancelledEvents === 1 ? '' : 's'}.`
        : 'Stopped by user.',
      runSessionId,
    );
  }, [cancelPendingUserInputs, finishRun, releasePausedLoop]);

  const onPause = useCallback(() => {
    const runSessionId = activeSessionRef.current;
    if (!runningRef.current || pausedRef.current || !runSessionId) return;
    pausedRef.current = true;
    pausedAtRef.current = Date.now();
    setPaused(true);
    addLog(
      'pause',
      'Runtime',
      'Pause requested; the current node or parallel wave may finish before the queue holds.',
      runSessionId,
      {
        queuedEvents: queueRef.current.length,
        processedEvents: eventCountRef.current,
      },
    );
  }, [addLog]);

  const onResume = useCallback(() => {
    const runSessionId = activeSessionRef.current;
    if (!runningRef.current || !pausedRef.current || !runSessionId) return;
    const pausedDurationMs = pausedAtRef.current
      ? Date.now() - pausedAtRef.current
      : null;
    pausedRef.current = false;
    pausedAtRef.current = null;
    setPaused(false);
    addLog(
      'resume',
      'Runtime',
      `Resumed the same session with ${queueRef.current.length} queued event${queueRef.current.length === 1 ? '' : 's'}.`,
      runSessionId,
      {
        queuedEvents: queueRef.current.length,
        processedEvents: eventCountRef.current,
        pausedDurationMs,
      },
    );
    releasePausedLoop();
  }, [addLog, releasePausedLoop]);

  const newProject = useCallback(() => {
    const confirmed = window.confirm(
      'Start a blank harness? Unsaved canvas changes will be lost.',
    );
    if (!confirmed) return;

    const previousSessionId = activeSessionRef.current;
    abortRef.current?.abort();
    cancelPendingUserInputs();
    queueRef.current = [];
    if (runningRef.current && previousSessionId) {
      finishRun(
        'Stopped to start a blank harness.',
        previousSessionId,
        eventCountRef.current,
      );
    }
    activeSessionRef.current = null;
    runGraphRef.current = { sessionId: null, nodes: [], edges: [] };
    continuationGraphKeyRef.current = null;
    runningRef.current = false;
    pausedRef.current = false;
    pausedAtRef.current = null;
    releasePausedLoop();
    memoryRef.current = {};
    routerStateRef.current = {};
    governorStateRef.current = {};
    nodeOutputsRef.current = {};
    eventCountRef.current = 0;
    localStorage.removeItem(STORAGE_KEY);
    setRunning(false);
    setPaused(false);
    setQueueSize(0);
    setSessionId(null);
    setLogs([]);
    setSelectedId(null);
    setSelectedEdgeId(null);
    setEdgeMenu(null);
    setName('Untitled Harness');
    setNodes([]);
    setEdges([]);
  }, [
    cancelPendingUserInputs,
    finishRun,
    releasePausedLoop,
    setEdges,
    setNodes,
  ]);

  const onConnect = useCallback((connection) => {
    const source = nodesRef.current.find((node) => node.id === connection.source);
    const target = nodesRef.current.find((node) => node.id === connection.target);
    if (!source || !target || source.id === target.id) return;
    const channel = inferChannel(source, target, connection);
    setEdges((current) =>
      addEdge(
        {
          ...connection,
          id: crypto.randomUUID(),
          type: 'default',
          label: channel,
          data: { channel },
          markerEnd: { type: MarkerType.ArrowClosed, color: CHANNEL_COLORS[channel] },
          style: { stroke: CHANNEL_COLORS[channel], strokeWidth: 2 },
        },
        current,
      ),
    );
  }, [setEdges]);

  const addNode = useCallback((kind, position) => {
    const fallback = screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    const node = createNode(kind, position || fallback);
    const sameKindCount = nodesRef.current.filter(
      (candidate) => candidate.data.kind === kind,
    ).length;
    if (sameKindCount > 0) {
      node.data.label = `${node.data.label} ${sameKindCount + 1}`;
    }
    setNodes((current) => [...current, node]);
    setSelectedId(node.id);
    setSelectedEdgeId(null);
    setEdgeMenu(null);
    setEdges((current) =>
      current.map((edge) => ({ ...edge, selected: false })),
    );
  }, [screenToFlowPosition, setEdges, setNodes]);

  const selectedNode = nodes.find((node) => node.id === selectedId) || null;

  const fireSelectedTrigger = useCallback(async () => {
    if (!selectedNode || selectedNode.data.kind !== 'trigger') return;
    const runSessionId = await seedRun(
      [selectedNode.id],
      { preserveState: Boolean(selectedNode.data.config.continueState) },
    );
    if (!runSessionId) return;
    if (activeSessionRef.current !== runSessionId) return;
    if (executionMode === 'live') {
      runLiveLoop(runSessionId);
    } else {
      runSequentialLoop(runSessionId);
    }
  }, [
    executionMode,
    runLiveLoop,
    runSequentialLoop,
    seedRun,
    selectedNode,
  ]);

  const updateSelected = useCallback((data) => {
    setNodes((current) =>
      current.map((node) => (node.id === selectedId ? { ...node, data } : node)),
    );
  }, [selectedId, setNodes]);

  const generateRouterCode = useCallback(async (node) => {
    const nodeId = node.id;
    setRouterJobs((current) => ({
      ...current,
      [nodeId]: { status: 'generating', message: 'Coding Agent is building the Router with Terra.' },
    }));
    try {
      const response = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate_router',
          message: node.data.config?.routerPrompt || 'Build this Router.',
          selectedNode: node,
          nodes: nodesRef.current,
          edges: edgesRef.current,
          logs: logs.slice(-30),
        }),
      });
      const body = await readApiJson(response, 'Router generation failed.');
      if (body.budget) setDemoBudget(body.budget);
      if (!response.ok || !body.router) throw new Error(body.error || 'The assistant did not return Router code.');
      setNodes((current) => current.map((candidate) => candidate.id === nodeId ? {
        ...candidate,
        data: { ...candidate.data, config: {
          ...candidate.data.config,
          generatedVersions: candidate.data.config.generatedCode ? [...(candidate.data.config.generatedVersions || []), { code: candidate.data.config.generatedCode, summary: candidate.data.config.generatedSummary || '', assumptions: candidate.data.config.generatedAssumptions || [], tests: candidate.data.config.generatedTests || [], generatedAt: candidate.data.config.generatedAt || null }].slice(-10) : candidate.data.config.generatedVersions || [],
          operation: 'generated', generatedCode: body.router.code, generatedSummary: body.router.summary,
          generatedAssumptions: body.router.assumptions || [], generatedTests: body.router.tests || [], generatedAt: new Date().toISOString(), generatedJobId: crypto.randomUUID(),
        } },
      } : candidate));
      setRouterJobs((current) => ({ ...current, [nodeId]: { status: 'completed', message: 'Router generated and sandbox-validated.', result: body.router } }));
      setAssistantMessages((current) => [...current, { role: 'assistant', text: body.message || 'Router generated and validated.' }]);
      addLog('complete', node.data.label, 'Coding Agent generated and validated the Router.', null, { summary: body.router.summary });
    } catch (error) {
      setRouterJobs((current) => ({
        ...current,
        [nodeId]: { status: 'failed', error: error.message },
      }));
      addLog('error', node.data.label, error.message);
    }
  }, [addLog, logs, setNodes]);

  const askAssistant = useCallback(async () => {
    const message = assistantDraft.trim();
    if (!message || assistantLoading) return;
    setAssistantMessages((current) => [...current, { role: 'user', text: message }]);
    setAssistantDraft('');
    setAssistantLoading(true);
    try {
      const response = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'chat', message, selectedNode, nodes, edges, logs: logs.slice(-30) }),
      });
      const body = await readApiJson(response, 'Assistant request failed.');
      if (body.budget) setDemoBudget(body.budget);
      if (!response.ok) throw new Error(body.error || 'Assistant request failed.');
      setAssistantMessages((current) => [...current, { role: 'assistant', text: body.message }]);
    } catch (error) {
      setAssistantMessages((current) => [...current, { role: 'assistant', text: `Unable to help: ${error.message}` }]);
    } finally {
      setAssistantLoading(false);
    }
  }, [assistantDraft, assistantLoading, edges, logs, nodes, selectedNode]);

  const loadDemo = useCallback(async (demoId) => {
    const demo = DEMOS.find((candidate) => candidate.id === demoId);
    if (!demo) return;
    const project = await demo.load();
    continuationGraphKeyRef.current = null;
    memoryRef.current = {};
    routerStateRef.current = {};
    governorStateRef.current = {};
    setName(project.name || 'Demo Harness');
    setNodes(project.nodes.map(normalizeNodeContracts));
    setEdges(project.edges.map(clearEdgeRuntime));
    setSelectedId(null);
    setSelectedEdgeId(null);
    setLogs([]);
    window.setTimeout(() => fitView({ padding: 0.16 }), 50);
  }, [fitView, setEdges, setNodes]);

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    deleteNode(selectedId);
  }, [deleteNode, selectedId]);

  const saveProject = useCallback(() => {
    const project = createPortableProject({ name, nodes, edges });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    downloadText(
      `${name.trim().replaceAll(/\s+/g, '-').toLowerCase() || 'synapse-flow'}.synapse.json`,
      JSON.stringify(project, null, 2),
      'application/json',
    );
    addLog(
      'info',
      'Project',
      'Saved a versioned portable harness with stable IDs and complete configuration.',
      null,
      {
        format: project.format,
        version: project.version,
        nodes: project.nodes.length,
        edges: project.edges.length,
      },
    );
  }, [addLog, edges, name, nodes]);

  const loadProject = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.synapse.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const project = JSON.parse(await file.text());
        continuationGraphKeyRef.current = null;
        memoryRef.current = {};
        routerStateRef.current = {};
        governorStateRef.current = {};
        setName(project.name || 'Untitled Harness');
        setNodes(Array.isArray(project.nodes) ? project.nodes.map(normalizeNodeContracts) : []);
        setEdges(Array.isArray(project.edges) ? project.edges.map(clearEdgeRuntime) : []);
        setSelectedId(null);
        setSelectedEdgeId(null);
        setEdgeMenu(null);
        window.setTimeout(() => fitView({ padding: 0.16 }), 50);
        addLog('info', 'Project', `Loaded ${file.name}.`);
      } catch (error) {
        addLog('error', 'Project', `Could not load file: ${error.message}`);
      }
    };
    input.click();
  }, [addLog, fitView, setEdges, setNodes]);

  const exportMarkdown = useCallback(() => {
    const markdown = exportGraphMarkdown({ name, nodes, edges });
    downloadText(
      `${name.trim().replaceAll(/\s+/g, '-').toLowerCase() || 'synapse-flow'}-implementation.md`,
      markdown,
      'text/markdown',
    );
    addLog(
      'info',
      'Project',
      'Exported a self-contained IDE reconstruction package.',
      null,
      {
        nodes: nodes.length,
        edges: edges.length,
        includesMachineReadableGraph: true,
        includesRouterSource: true,
        includesPreflightReport: true,
      },
    );
  }, [addLog, edges, name, nodes]);

  return (
    <div className="app-shell">
      <TopBar
        name={name}
        onNameChange={setName}
        executionMode={executionMode}
        onModeChange={setExecutionMode}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        running={running}
        paused={paused}
        queueSize={queueSize}
        onRun={onRun}
        onStop={onStop}
        onPause={onPause}
        onResume={onResume}
        onNew={newProject}
        onSave={saveProject}
        onLoad={loadProject}
        onExport={exportMarkdown}
        demos={DEMOS}
        onLoadDemo={loadDemo}
      />
      <main className="workspace">
        <NodePalette onAdd={addNode} />
        <section
          className="canvas-shell"
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
          }}
          onDrop={(event) => {
            event.preventDefault();
            const kind = event.dataTransfer.getData('application/synapse-node');
            if (kind) addNode(kind, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
          }}
        >
          <div className="canvas-status">
            <span className={`status-dot ${serverStatus.configured ? 'online' : ''}`} />
            {serverStatus.configured ? serverStatus.model : `API ${serverStatus.model === 'offline' ? 'offline' : 'not configured'}`}
          </div>
          {viewMode === '2d' ? (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            connectionLineType={ConnectionLineType.Bezier}
            onNodeClick={(_event, node) => selectNode(node.id)}
            onEdgeClick={(_event, edge) => selectConnection(edge.id, true)}
            onEdgeContextMenu={(event, edge) => {
              event.preventDefault();
              selectConnection(edge.id, true);
              setEdgeMenu({
                edgeId: edge.id,
                x: Math.min(event.clientX, window.innerWidth - 190),
                y: Math.min(event.clientY, window.innerHeight - 54),
              });
            }}
            onPaneClick={clearSelection}
            deleteKeyCode={null}
            fitView
            fitViewOptions={{ padding: 0.16 }}
            minZoom={0.25}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="#303639" />
            <Controls position="bottom-left" showInteractive={false} />
            <MiniMap
              position="bottom-right"
              pannable
              zoomable
              nodeColor={(node) => node.style?.background || '#596267'}
              maskColor="rgba(12, 14, 15, 0.72)"
            />
          </ReactFlow>
          ) : (
            <Suspense fallback={<div className="graph-3d-loading">Loading 3D view...</div>}>
              <Graph3DCanvas
                nodes={nodes}
                edges={edges}
                selectedId={selectedId}
                onSelectNode={selectNode}
                onClearSelection={clearSelection}
                onMoveNode={moveNode3d}
              />
            </Suspense>
          )}
          {viewMode === '2d' && edgeMenu && (
            <div
              className="edge-context-menu"
              style={{ left: edgeMenu.x, top: edgeMenu.y }}
              role="menu"
            >
              <button
                onClick={() => deleteConnection(edgeMenu.edgeId)}
                role="menuitem"
                type="button"
              >
                <Trash2 size={15} />
                Delete connection
              </button>
            </div>
          )}
        </section>
        <Inspector
          node={selectedNode}
          nodes={nodes}
          edges={edges}
          selectedEdgeId={selectedEdgeId}
          running={running}
          routerJob={selectedNode ? routerJobs[selectedNode.id] : null}
          onChange={updateSelected}
          onDelete={deleteSelected}
          onSelectConnection={(edgeId) => selectConnection(edgeId)}
          onDeleteConnection={deleteConnection}
          onFireTrigger={fireSelectedTrigger}
          onGenerateRouter={() => selectedNode && generateRouterCode(selectedNode)}
          onSubmitUserInput={submitManualUserInput}
        />
        <AssistantPanel
          messages={assistantMessages}
          draft={assistantDraft}
          onDraftChange={setAssistantDraft}
          onSend={askAssistant}
          onGenerateRouter={() => selectedNode && generateRouterCode(selectedNode)}
          loading={assistantLoading}
          budget={demoBudget}
          selectedNode={selectedNode}
        />
      </main>
      <RunLog
        logs={logs}
        sessionId={sessionId}
        onClear={() => setLogs([])}
      />
    </div>
  );
}
