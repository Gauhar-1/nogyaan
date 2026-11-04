import React, { useState, useEffect } from 'react';
import { NogyaanState, Medium, LockedScript, LockedShot } from '../v2/types.js';

const MEDIUM_OPTIONS: Medium[] = [
  'Live-Action Cinematic',
  '2D Anime',
  '3D Pixar Style'
];

export const DirectorsTreatmentApp: React.FC = () => {
  const [state, setState] = useState<NogyaanState | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [copiedShotId, setCopiedShotId] = useState<string | null>(null);
  const [reRollingNodeId, setReRollingNodeId] = useState<string | null>(null);
  const [isExtractingAssets, setIsExtractingAssets] = useState<boolean>(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [directorNotes, setDirectorNotes] = useState<string>('');
  const [isSavingNotes, setIsSavingNotes] = useState<boolean>(false);
  const [collapsedPayloads, setCollapsedPayloads] = useState<Record<string, boolean>>({});

  useEffect(() => {
    // 1. Initial State Fetch
    fetch('/api/v2/state')
      .then((res) => res.json())
      .then((data: NogyaanState) => {
        setState(data);
        if (data.global_director_notes !== undefined) {
          setDirectorNotes(data.global_director_notes);
        }
      })
      .catch((err) => console.error('Failed to fetch initial state:', err));

    // 2. Real-Time Server-Sent Events (SSE) Stream
    const eventSource = new EventSource('/api/v2/events');

    eventSource.onopen = () => {
      setIsConnected(true);
    };

    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'INIT' || payload.type === 'STATE_UPDATED') {
          setState(payload.state);
          if (payload.state?.global_director_notes !== undefined) {
            setDirectorNotes(payload.state.global_director_notes);
          }
        }
      } catch (err) {
        console.error('Failed to parse SSE event:', err);
      }
    };

    eventSource.onerror = () => {
      setIsConnected(false);
    };

    return () => {
      eventSource.close();
    };
  }, []);

  const handleMediumChange = async (newMedium: Medium) => {
    try {
      const res = await fetch('/api/v2/medium', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ medium: newMedium })
      });
      const data = await res.json();
      if (data.state) setState(data.state);
    } catch (err) {
      console.error('Failed to update medium:', err);
    }
  };

  const handleSaveDirectorNotes = async () => {
    setIsSavingNotes(true);
    try {
      const res = await fetch('/api/v2/director-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: directorNotes })
      });
      const data = await res.json();
      if (data.state) setState(data.state);
    } catch (err) {
      console.error('Failed to update director notes:', err);
    } finally {
      setIsSavingNotes(false);
    }
  };

  const handleCopyPrompt = async (shotId: string, promptText: string) => {
    const medium = state?.global_medium || 'Live-Action Cinematic';
    const fullPrompt = `[${medium}] ${promptText}`;
    try {
      await navigator.clipboard.writeText(fullPrompt);
      setCopiedShotId(shotId);
      setTimeout(() => setCopiedShotId(null), 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = fullPrompt;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopiedShotId(shotId);
      setTimeout(() => setCopiedShotId(null), 2000);
    }
  };

  const handleReroll = async (nodeId: string) => {
    const feedback = notes[nodeId]?.trim();
    if (!feedback) return;

    setReRollingNodeId(nodeId);
    try {
      const res = await fetch('/api/v2/reroll-node', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ node_id: nodeId, user_feedback: feedback })
      });
      const data = await res.json();
      if (data.result?.state) {
        setState(data.result.state);
        setNotes((prev) => ({ ...prev, [nodeId]: '' }));
      }
    } catch (err) {
      console.error('Failed to reroll node:', err);
    } finally {
      setReRollingNodeId(null);
    }
  };

  const handleExtractAssets = async () => {
    setIsExtractingAssets(true);
    try {
      const res = await fetch('/api/v2/extract-assets', { method: 'POST' });
      const data = await res.json();
      if (data.state) {
        setState(data.state);
      }
    } catch (err) {
      console.error('Failed to extract assets:', err);
    } finally {
      setIsExtractingAssets(false);
    }
  };

  const togglePayloadCollapse = (shotId: string) => {
    setCollapsedPayloads((prev) => ({
      ...prev,
      [shotId]: !prev[shotId]
    }));
  };

  if (!state) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-950 text-slate-400 font-sans">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-medium">Connecting to nogyaan Treatment Engine...</p>
        </div>
      </div>
    );
  }

  const { assets, global_medium, scenes, core_premise } = state;
  const allScenesLocked = scenes.length >= 4 && scenes.every((s) => s.locked_script);
  const hasActiveRefs = scenes.some((s) => s.active_refs && s.active_refs.length > 0);

  return (
    <div className="flex h-screen w-full bg-slate-950 text-slate-100 font-sans overflow-hidden">
      {/* ==================================================================== */}
      {/* 1. STICKY SIDEBAR: ASSET BIBLE & PERSISTENT RULES (25% Width)       */}
      {/* ==================================================================== */}
      <aside className="w-1/4 min-w-[300px] max-w-[380px] h-screen bg-slate-900 border-r border-slate-800 flex flex-col flex-shrink-0 z-20">
        {/* Sidebar Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-mono text-sm font-bold">
              N
            </div>
            <div>
              <h2 className="text-sm font-bold tracking-wider text-slate-100 uppercase font-mono">
                Asset Locker
              </h2>
              <span className="text-xs text-slate-400 font-mono">
                Project: {state.project_id}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'
              }`}
            />
            <span className="text-[10px] uppercase font-mono text-slate-400">
              {isConnected ? 'LIVE SSE' : 'OFFLINE'}
            </span>
          </div>
        </div>

        {/* Global Medium Selector */}
        <div className="p-5 border-b border-slate-800 bg-slate-900/50">
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
            Global Render Medium
          </label>
          <select
            value={global_medium}
            onChange={(e) => handleMediumChange(e.target.value as Medium)}
            className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors cursor-pointer"
          >
            {MEDIUM_OPTIONS.map((opt) => (
              <option key={opt} value={opt} className="bg-slate-800 text-slate-100">
                {opt}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-[11px] text-slate-500">
            Prepended dynamically to DP prompts upon copy.
          </p>
        </div>

        {/* Persistent Cinematic Rules (Global Director Notes) */}
        <div className="p-5 border-b border-slate-800 bg-slate-900/30">
          <div className="flex items-center justify-between mb-2">
            <label className="block text-xs font-semibold text-amber-400 uppercase tracking-wider font-mono">
              Persistent Cinematic Rules
            </label>
            <button
              onClick={handleSaveDirectorNotes}
              disabled={isSavingNotes}
              className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 transition-colors"
            >
              {isSavingNotes ? 'Saving...' : 'Save Rules'}
            </button>
          </div>
          <textarea
            value={directorNotes}
            onChange={(e) => setDirectorNotes(e.target.value)}
            placeholder="e.g., Scene 4 must visually mirror Scene 1; keep lighting warm and nostalgic across all scenes..."
            rows={2}
            className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500 font-sans resize-none"
          />
        </div>

        {/* Phase 2: Active Asset Extraction Action Banner */}
        {allScenesLocked && !hasActiveRefs && (
          <div className="p-4 bg-emerald-500/10 border-b border-emerald-500/20">
            <p className="text-xs font-medium text-emerald-300 mb-2">
              All 4 scenes locked! Tag active asset references before DP Suite:
            </p>
            <button
              onClick={handleExtractAssets}
              disabled={isExtractingAssets}
              className="w-full py-1.5 px-3 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs uppercase tracking-wide transition-all shadow-md font-mono"
            >
              {isExtractingAssets ? 'Tagging Active Assets...' : 'Extract & Tag Active Assets'}
            </button>
          </div>
        )}

        {/* Scrollable Bible Contents */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Hero Product Card */}
          <div className="bg-slate-800/60 border border-slate-700/80 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-400 font-mono">
                Hero Product
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                @PROD_01
              </span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed font-sans">
              {assets.product || (
                <span className="italic text-slate-500">Awaiting asset extraction.</span>
              )}
            </p>
          </div>

          {/* Characters Card */}
          <div className="bg-slate-800/60 border border-slate-700/80 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-indigo-400 font-mono">
                Characters
              </span>
              <span className="text-[10px] font-mono text-slate-400">
                {Object.keys(assets.characters || {}).length} Total
              </span>
            </div>
            <div className="space-y-2.5">
              {Object.keys(assets.characters || {}).length === 0 ? (
                <p className="text-xs italic text-slate-500">No characters extracted yet.</p>
              ) : (
                Object.entries(assets.characters).map(([id, desc]) => (
                  <div key={id} className="p-2.5 rounded bg-slate-900/60 border border-slate-800">
                    <span className="text-[11px] font-mono font-bold text-indigo-300">
                      @{id.replace(/^@/, '')}
                    </span>
                    <p className="text-xs text-slate-300 mt-1 leading-snug">{desc}</p>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Backgrounds Card */}
          <div className="bg-slate-800/60 border border-slate-700/80 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-amber-400 font-mono">
                Environments
              </span>
              <span className="text-[10px] font-mono text-slate-400">
                {Object.keys(assets.backgrounds || {}).length} Total
              </span>
            </div>
            <div className="space-y-2.5">
              {Object.keys(assets.backgrounds || {}).length === 0 ? (
                <p className="text-xs italic text-slate-500">No environments extracted yet.</p>
              ) : (
                Object.entries(assets.backgrounds).map(([id, desc]) => (
                  <div key={id} className="p-2.5 rounded bg-slate-900/60 border border-slate-800">
                    <span className="text-[11px] font-mono font-bold text-amber-300">
                      @{id.replace(/^@/, '')}
                    </span>
                    <p className="text-xs text-slate-300 mt-1 leading-snug">{desc}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </aside>

      {/* ==================================================================== */}
      {/* 2. MAIN TIMELINE (75% Width)                                         */}
      {/* ==================================================================== */}
      <main className="flex-1 h-screen overflow-y-auto bg-slate-950 p-8 space-y-10">
        <header className="flex items-center justify-between border-b border-slate-800 pb-5">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-100 font-sans">
              The Director's Treatment
            </h1>
            <p className="text-sm text-slate-400 mt-1 font-sans">
              Single unified directorial vision: Writer's Room, Asset Locker, and DP Suite.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono px-3 py-1.5 rounded-full bg-slate-900 border border-slate-800 text-slate-300">
              {scenes.length} Scenes in Sequence
            </span>
          </div>
        </header>

        {/* Empty State */}
        {scenes.length === 0 ? (
          <div className="border border-dashed border-slate-800 rounded-xl p-12 text-center">
            <p className="text-base font-semibold text-slate-300">No Scenes Created Yet</p>
            <p className="text-xs text-slate-500 mt-2 max-w-md mx-auto">
              Call <code className="text-emerald-400 font-mono">pitch_script_options</code> from your MCP client (Claude Desktop or Cursor) to start the Writer's Room.
            </p>
          </div>
        ) : (
          <div className="space-y-12">
            {scenes.map((scene, sceneIndex) => (
              <SceneSection
                key={scene.scene_id}
                scene={scene}
                index={sceneIndex}
                globalMedium={global_medium}
                copiedShotId={copiedShotId}
                reRollingNodeId={reRollingNodeId}
                notes={notes}
                collapsedPayloads={collapsedPayloads}
                onNoteChange={(id, val) => setNotes((prev) => ({ ...prev, [id]: val }))}
                onReroll={handleReroll}
                onCopyPrompt={handleCopyPrompt}
                onToggleCollapse={togglePayloadCollapse}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

// ============================================================================
// Scene Section Component
// ============================================================================

interface SceneSectionProps {
  scene: NogyaanState['scenes'][number];
  index: number;
  globalMedium: Medium;
  copiedShotId: string | null;
  reRollingNodeId: string | null;
  notes: Record<string, string>;
  collapsedPayloads: Record<string, boolean>;
  onNoteChange: (id: string, val: string) => void;
  onReroll: (nodeId: string) => void;
  onCopyPrompt: (shotId: string, aiPayload: string) => void;
  onToggleCollapse: (shotId: string) => void;
}

const SceneSection: React.FC<SceneSectionProps> = ({
  scene,
  index,
  globalMedium,
  copiedShotId,
  reRollingNodeId,
  notes,
  collapsedPayloads,
  onNoteChange,
  onReroll,
  onCopyPrompt,
  onToggleCollapse
}) => {
  const { scene_id, locked_script, active_refs, spatial_memory, shots } = scene;
  const shotEntries = Object.entries(shots || {});

  const scriptTxt = (locked_script as any)?.txt || (locked_script as any)?.narrative_block || '';
  const scriptStyle = (locked_script as any)?.style || (locked_script as any)?.writer_persona || 'Locked';
  const scriptId = (locked_script as any)?.id || (locked_script as any)?.option_id || scene_id;

  return (
    <section className="bg-slate-900/40 border border-slate-800 rounded-xl p-6 transition-all">
      {/* Scene Top Badge */}
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-4 mb-6">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs font-bold px-2.5 py-1 rounded bg-slate-800 border border-slate-700 text-slate-200">
            ACT {index + 1}
          </span>
          <h2 className="text-lg font-bold text-slate-100 tracking-wide font-mono">
            {scene_id}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {locked_script ? (
            <span className="text-xs font-mono font-medium px-2.5 py-1 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              SCRIPT LOCKED ({scriptStyle})
            </span>
          ) : (
            <span className="text-xs font-mono font-medium px-2.5 py-1 rounded bg-amber-500/10 border border-amber-500/20 text-amber-400">
              PENDING SCRIPT
            </span>
          )}
        </div>
      </div>

      {/* Phase 1: Locked Script Narrative */}
      {locked_script && (
        <div className="mb-8 p-5 bg-slate-900/90 border border-slate-800 rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs uppercase font-bold tracking-wider text-slate-400 font-sans">
              Locked Narrative Beat
            </span>
            <span className="text-xs font-mono text-slate-500">
              {scriptId}
            </span>
          </div>
          <p className="text-sm text-slate-200 leading-relaxed font-sans mb-4">
            {scriptTxt}
          </p>

          {/* Phase 2: Active Refs Tagging Badge Row */}
          {active_refs && active_refs.length > 0 && (
            <div className="pt-3 border-t border-slate-800/80 flex items-center gap-2 mb-3">
              <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">
                Tagged Active Refs:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {active_refs.map((ref) => (
                  <span
                    key={ref}
                    className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20 text-indigo-300"
                  >
                    {ref}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Rolling Spatial Memory (Room Geometry) */}
          {spatial_memory && spatial_memory.length > 0 && (
            <div className="pt-3 border-t border-slate-800/80 flex flex-col gap-1.5 mb-3">
              <span className="text-[11px] font-mono text-emerald-400 uppercase tracking-wider font-semibold">
                Room Geometry (Spatial Memory):
              </span>
              <div className="flex flex-wrap gap-1.5">
                {spatial_memory.map((fact, idx) => (
                  <span
                    key={idx}
                    className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-300"
                  >
                    📍 {fact}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Script Re-roll Note */}
          <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center gap-2">
            <input
              type="text"
              placeholder="Directorial note on script narrative..."
              value={notes[scene_id] || ''}
              onChange={(e) => onNoteChange(scene_id, e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onReroll(scene_id)}
              disabled={reRollingNodeId === scene_id}
              className="flex-1 bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500 font-sans"
            />
            <button
              onClick={() => onReroll(scene_id)}
              disabled={reRollingNodeId === scene_id || !notes[scene_id]?.trim()}
              className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs font-semibold text-slate-200 transition-colors font-mono"
            >
              {reRollingNodeId === scene_id ? 'Refining...' : 'Refine Script'}
            </button>
          </div>
        </div>
      )}

      {/* Phase 3: DP Shot Coverage */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 font-mono">
            Director of Photography (DP) Coverage
          </h3>
          <span className="text-xs font-mono text-slate-500">
            {shotEntries.length} Shots
          </span>
        </div>

        {shotEntries.length === 0 ? (
          <p className="text-xs italic text-slate-500 py-3">
            No shots pitched yet for this scene. Call <code className="text-emerald-400 font-mono">pitch_shot_options</code> to generate 3 treatments.
          </p>
        ) : (
          <div className="space-y-6">
            {shotEntries.map(([shotKey, shotVal]) => {
              const lockedShot = shotVal.locked_shot;
              if (!lockedShot) return null;
              const nodeIdentifier = `${scene_id}:${shotKey}`;
              const sId = (lockedShot as any).id || (lockedShot as any).option_id || shotKey;

              return (
                <ShotCard
                  key={shotKey}
                  shotKey={shotKey}
                  shot={lockedShot}
                  nodeId={nodeIdentifier}
                  globalMedium={globalMedium}
                  isCopied={copiedShotId === sId}
                  isReRolling={reRollingNodeId === nodeIdentifier}
                  isPayloadCollapsed={!!collapsedPayloads[sId]}
                  noteValue={notes[nodeIdentifier] || ''}
                  onNoteChange={(val) => onNoteChange(nodeIdentifier, val)}
                  onReroll={() => onReroll(nodeIdentifier)}
                  onCopy={(prmpt) => onCopyPrompt(sId, prmpt)}
                  onToggleCollapse={() => onToggleCollapse(sId)}
                />
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};

// ============================================================================
// Shot Card Component
// ============================================================================

interface ShotCardProps {
  shotKey: string;
  shot: LockedShot;
  nodeId: string;
  globalMedium: Medium;
  isCopied: boolean;
  isReRolling: boolean;
  isPayloadCollapsed: boolean;
  noteValue: string;
  onNoteChange: (val: string) => void;
  onReroll: () => void;
  onCopy: (prmpt: string) => void;
  onToggleCollapse: () => void;
}

const ShotCard: React.FC<ShotCardProps> = ({
  shotKey,
  shot,
  globalMedium,
  isCopied,
  isReRolling,
  isPayloadCollapsed,
  noteValue,
  onNoteChange,
  onReroll,
  onCopy,
  onToggleCollapse
}) => {
  const shotStyle = (shot as any).style || (shot as any).director_persona || 'Auteur';
  const shotTxt = (shot as any).txt || (shot as any).visual_intent || '';
  const shotPrmpt = (shot as any).prmpt || (shot as any).ai_payload || '';

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 transition-all hover:border-slate-700 shadow-md">
      {/* Shot Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-300">
            {shotKey}
          </span>
          <span className="text-xs font-semibold px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 font-mono">
            {shotStyle}
          </span>
        </div>

        {/* Neon Accented COPY FOR KLING/RUNWAY Button */}
        <button
          onClick={() => onCopy(shotPrmpt)}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded text-xs font-bold tracking-wide uppercase transition-all shadow-md font-mono ${
            isCopied
              ? 'bg-emerald-400 text-slate-950 shadow-emerald-400/30 scale-95'
              : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-emerald-500/20 hover:scale-[1.02]'
          }`}
        >
          <span>{isCopied ? '✓ COPIED!' : 'COPY FOR KLING/RUNWAY'}</span>
        </button>
      </div>

      {/* Visual Intent (Serif Typography for Director Screenplay Feel) */}
      <div className="mb-4">
        <span className="text-[11px] font-mono text-slate-500 uppercase tracking-wider block mb-1.5">
          Visual Intent
        </span>
        <blockquote className="font-serif text-base italic leading-relaxed text-slate-200 tracking-wide border-l-2 border-emerald-500/60 pl-3 py-0.5">
          "{shotTxt}"
        </blockquote>
      </div>

      {/* AI Payload (Collapsible Terminal-Style Code Block) */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-mono text-slate-500 uppercase tracking-wider">
            AI Video Diffusion Payload (Style-Agnostic)
          </span>
          <button
            onClick={onToggleCollapse}
            className="text-[11px] font-mono text-slate-400 hover:text-slate-200 transition-colors"
          >
            {isPayloadCollapsed ? 'Expand [▼]' : 'Collapse [▲]'}
          </button>
        </div>

        {!isPayloadCollapsed && (
          <div className="bg-black/90 border border-slate-800 rounded p-3 font-mono text-xs text-emerald-400/90 leading-relaxed overflow-x-auto shadow-inner">
            <span className="text-slate-500 select-none mr-2">$</span>
            <span className="text-emerald-300 font-semibold select-none">
              [{globalMedium}]{' '}
            </span>
            <span>{shotPrmpt}</span>
          </div>
        )}
      </div>

      {/* Directorial Note Re-Roll Trigger */}
      <div className="pt-3 border-t border-slate-800/80 flex items-center gap-2">
        <input
          type="text"
          placeholder="Directorial note (e.g., tighter on eyes, make lighting harsher)..."
          value={noteValue}
          onChange={(e) => onNoteChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onReroll()}
          disabled={isReRolling}
          className="flex-1 bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 font-sans"
        />
        <button
          onClick={onReroll}
          disabled={isReRolling || !noteValue.trim()}
          className="px-3.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs font-semibold text-slate-200 transition-colors font-mono"
        >
          {isReRolling ? 'Re-Rolling...' : 'Re-Roll Shot'}
        </button>
      </div>
    </div>
  );
};

export const NogyaanV2App = DirectorsTreatmentApp;
export default DirectorsTreatmentApp;
