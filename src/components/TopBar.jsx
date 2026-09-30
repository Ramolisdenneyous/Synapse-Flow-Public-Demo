import {
  Download,
  FileDown,
  FilePlus2,
  FolderOpen,
  Pause,
  Play,
  Save,
  Square,
} from 'lucide-react';

export default function TopBar({
  name,
  onNameChange,
  executionMode,
  onModeChange,
  viewMode,
  onViewModeChange,
  running,
  paused,
  queueSize,
  onRun,
  onStop,
  onPause,
  onResume,
  onNew,
  onSave,
  onLoad,
  onExport,
  demos,
  onLoadDemo,
}) {
  return (
    <header className="topbar">
      <div className="brand-block">
        <div className="brand-mark" aria-hidden="true">
          SF
        </div>
        <div>
          <strong>Synapse Flow</strong>
          <span>Harness lab</span>
        </div>
      </div>

      <input
        className="project-name"
        value={name}
        onChange={(event) => onNameChange(event.target.value)}
        aria-label="Harness name"
      />

      <div className="toolbar-modes">
        <div className="mode-switch" aria-label="Execution mode">
          <button
            className={executionMode === 'step' ? 'active' : ''}
            onClick={() => onModeChange('step')}
            type="button"
          >
            Sequential
          </button>
          <button
            className={executionMode === 'live' ? 'active' : ''}
            onClick={() => onModeChange('live')}
            type="button"
          >
            Parallel
          </button>
        </div>
        <div className="view-switch" aria-label="Graph view">
          <button
            className={viewMode === '2d' ? 'active' : ''}
            onClick={() => onViewModeChange('2d')}
            title="2D graph view"
            type="button"
          >
            2D
          </button>
          <button
            className={viewMode === '3d' ? 'active' : ''}
            onClick={() => onViewModeChange('3d')}
            title="3D graph view"
            type="button"
          >
            3D
          </button>
        </div>
      </div>

      <div className="toolbar-actions">
        <select className="demo-picker" defaultValue="" onChange={(event) => { if (event.target.value) onLoadDemo(event.target.value); event.target.value = ''; }} aria-label="Load a demo harness">
          <option value="">Load demo…</option>
          {demos.map((demo) => <option key={demo.id} value={demo.id}>{demo.label}</option>)}
        </select>
        <button className="new-button" onClick={onNew} title="Start a blank harness" type="button">
          <FilePlus2 size={17} />
          New
        </button>
        <button className="icon-button" onClick={onSave} title="Save harness" type="button">
          <Save size={18} />
        </button>
        <button className="icon-button" onClick={onLoad} title="Load harness file" type="button">
          <FolderOpen size={18} />
        </button>
        <button className="icon-button" onClick={onExport} title="Export Markdown" type="button">
          <FileDown size={18} />
        </button>
        <span className="toolbar-divider" />
        {!running ? (
          <button className="run-button" onClick={onRun} type="button">
            <Play size={17} fill="currentColor" />
            Run all
          </button>
        ) : (
          <>
            <button
              className="icon-button execution-control"
              onClick={paused ? onResume : onPause}
              title={paused ? 'Resume this session' : 'Pause after current work'}
              type="button"
            >
              {paused ? <Play size={18} fill="currentColor" /> : <Pause size={18} fill="currentColor" />}
            </button>
            <button className="stop-button" onClick={onStop} type="button">
              <Square size={16} fill="currentColor" />
              Stop
            </button>
          </>
        )}
        <span className="queue-count" title="Queued events">
          {queueSize}
        </span>
      </div>
    </header>
  );
}
