import React, { useState, useEffect } from 'react';
import { NogyaanState, Medium, LockedScript, LockedShot } from '../v2/types.js';

export const DirectorsTreatmentApp: React.FC = () => {
  const [state, setState] = useState<NogyaanState | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [copiedShotId, setCopiedShotId] = useState<string | null>(null);
  const [collapsedPayloads, setCollapsedPayloads] = useState<Record<string, boolean>>({});

  useEffect(() => {
    // 1. Initial State Fetch
    fetch('/api/v2/state')
      .then((res) => res.json())
      .then((data: NogyaanState) => {
        setState(data);
      })
      .catch((err) => console.error('Failed to fetch initial state:', err));

    // 2. Real-Time Server-Sent Events (SSE) Stream
    let eventSource: EventSource | null = null;
    try {
      eventSource = new EventSource('/api/v2/events');

      eventSource.onopen = () => {
        setIsConnected(true);
      };

      eventSource.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'INIT' || payload.type === 'STATE_UPDATED') {
            setState(payload.state);
          }
        } catch (err) {
          console.error('Failed to parse SSE event:', err);
        }
      };

      eventSource.onerror = () => {
        setIsConnected(false);
      };
    } catch {
      // Fallback polling if SSE is unsupported
      const interval = setInterval(() => {
        fetch('/api/v2/state')
          .then((res) => res.json())
          .then((data: NogyaanState) => setState(data))
          .catch(() => {});
      }, 3000);
      return () => clearInterval(interval);
    }

    return () => {
      if (eventSource) eventSource.close();
    };
  }, []);

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

  const togglePayloadCollapse = (shotId: string) => {
    setCollapsedPayloads((prev) => ({
      ...prev,
      [shotId]: !prev[shotId]
    }));
  };

  if (!state) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black text-neutral-400 font-mono text-xs uppercase tracking-widest">
        CONNECTING TO NOGYAAN ENGINE...
      </div>
    );
  }

  const { assets, global_medium, scenes, core_premise, global_director_notes, project_id } = state;

  return (
    <div className="flex h-screen w-full bg-black text-neutral-100 font-sans overflow-hidden">
      {/* ==================================================================== */}
      {/* 1. STICKY SIDEBAR: ASSET BIBLE & PERSISTENT RULES (Read-Only 25%)    */}
      {/* ==================================================================== */}
      <aside className="w-1/4 min-w-[300px] max-w-[380px] h-screen bg-neutral-950 border-r border-neutral-800 flex flex-col flex-shrink-0 z-20">
        {/* Sidebar Header */}
        <div className="p-5 border-b border-neutral-800 flex items-center justify-between">
          <div>
            <h2 className="text-xs font-mono font-bold tracking-widest text-white uppercase">
              ASSET LOCKER
            </h2>
            <span className="text-[10px] text-neutral-500 font-mono block mt-0.5">
              SPECIFICATION BIBLE
            </span>
          </div>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-neutral-800 bg-neutral-900 text-neutral-400 uppercase tracking-widest">
            {isConnected ? 'LIVE SSE' : 'OFFLINE'}
          </span>
        </div>

        {/* Global Render Medium Spec (Read-Only) */}
        <div className="p-4 border-b border-neutral-800 bg-neutral-950">
          <span className="block text-[10px] font-mono font-bold text-neutral-400 uppercase tracking-widest mb-1">
            GLOBAL RENDER MEDIUM
          </span>
          <span className="text-xs font-mono text-white font-semibold">
            {global_medium}
          </span>
          <p className="mt-1 text-[10px] text-neutral-500 font-mono">
            Prepended dynamically to video prompts upon copy.
          </p>
        </div>

        {/* Persistent Cinematic Rules (Read-Only) */}
        {global_director_notes && (
          <div className="p-4 border-b border-neutral-800 bg-neutral-950">
            <span className="block text-[10px] font-mono font-bold text-neutral-400 uppercase tracking-widest mb-1">
              PERSISTENT CINEMATIC RULES
            </span>
            <p className="text-xs font-mono text-neutral-300 leading-relaxed">
              {global_director_notes}
            </p>
          </div>
        )}

        {/* Scrollable Bible Contents */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Hero Product Card */}
          <div className="bg-neutral-900 border border-neutral-800 rounded p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-neutral-400">
                HERO PRODUCT
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-neutral-800 text-white border border-neutral-700">
                @PROD_01
              </span>
            </div>
            <p className="text-xs text-neutral-300 font-sans leading-relaxed">
              {assets.product || (
                <span className="italic text-neutral-500">Awaiting asset extraction.</span>
              )}
            </p>
          </div>

          {/* Characters Card */}
          <div className="bg-neutral-900 border border-neutral-800 rounded p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-neutral-400">
                CHARACTERS
              </span>
              <span className="text-[10px] font-mono text-neutral-500">
                {Object.keys(assets.characters || {}).length} TOTAL
              </span>
            </div>
            <div className="space-y-2.5">
              {Object.keys(assets.characters || {}).length === 0 ? (
                <p className="text-xs italic text-neutral-500">No characters registered.</p>
              ) : (
                Object.entries(assets.characters).map(([id, desc]) => (
                  <div key={id} className="p-2.5 rounded bg-neutral-950 border border-neutral-800">
                    <span className="text-[11px] font-mono font-bold text-white block">
                      @{id.replace(/^@/, '')}
                    </span>
                    <p className="text-xs text-neutral-300 mt-1 leading-snug font-sans">{desc}</p>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Backgrounds Card */}
          <div className="bg-neutral-900 border border-neutral-800 rounded p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-neutral-400">
                ENVIRONMENTS
              </span>
              <span className="text-[10px] font-mono text-neutral-500">
                {Object.keys(assets.backgrounds || {}).length} TOTAL
              </span>
            </div>
            <div className="space-y-2.5">
              {Object.keys(assets.backgrounds || {}).length === 0 ? (
                <p className="text-xs italic text-neutral-500">No environments registered.</p>
              ) : (
                Object.entries(assets.backgrounds).map(([id, desc]) => (
                  <div key={id} className="p-2.5 rounded bg-neutral-950 border border-neutral-800">
                    <span className="text-[11px] font-mono font-bold text-white block">
                      @{id.replace(/^@/, '')}
                    </span>
                    <p className="text-xs text-neutral-300 mt-1 leading-snug font-sans">{desc}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </aside>

      {/* ==================================================================== */}
      {/* 2. MAIN TIMELINE (Read-Only 75% Width)                                */}
      {/* ==================================================================== */}
      <main className="flex-1 h-screen overflow-y-auto bg-black p-8 space-y-10">
        {/* Global Document Header with Core Theme & Campaign Goal */}
        <header className="border-b border-neutral-800 pb-6 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[10px] font-mono font-bold tracking-widest uppercase text-neutral-500 block mb-1">
                THE DIRECTOR'S TREATMENT // READ-ONLY LIVE WORKBENCH
              </span>
              <h1 className="text-2xl font-bold tracking-tight text-white font-sans uppercase">
                {project_id || 'NOGYAAN PRODUCTION'}
              </h1>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-mono px-2.5 py-1 rounded bg-neutral-900 border border-neutral-800 text-neutral-300 uppercase">
                {global_medium}
              </span>
              <span className="text-[10px] font-mono px-2.5 py-1 rounded bg-neutral-900 border border-neutral-800 text-neutral-400 uppercase">
                {scenes.length} SCENES IN SEQUENCE
              </span>
            </div>
          </div>

          {/* Prominently Displayed Core Theme / Campaign Goal */}
          <div className="p-5 bg-neutral-950 border border-neutral-800 rounded">
            <span className="text-[10px] font-mono font-bold tracking-widest uppercase text-neutral-400 block mb-2">
              CAMPAIGN CORE PREMISE & EMOTIONAL GOAL
            </span>
            <p className="font-serif text-lg leading-relaxed text-white">
              {core_premise || 'No core campaign premise established yet. Call init_brief and lock_core_theme.'}
            </p>
            {global_director_notes && (
              <div className="mt-3 pt-3 border-t border-neutral-800">
                <span className="text-[10px] font-mono font-bold tracking-widest uppercase text-neutral-400 block mb-1">
                  PERSISTENT CINEMATIC DIRECTIVES:
                </span>
                <p className="font-mono text-xs text-neutral-300">
                  {global_director_notes}
                </p>
              </div>
            )}
          </div>
        </header>

        {/* Empty State */}
        {scenes.length === 0 ? (
          <div className="border border-dashed border-neutral-800 rounded p-12 text-center">
            <p className="text-base font-semibold text-neutral-300">No Scenes Created Yet</p>
            <p className="text-xs text-neutral-500 mt-2 max-w-md mx-auto font-mono">
              Call pitch_script_options from Claude chat to begin the Writer's Room.
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
                collapsedPayloads={collapsedPayloads}
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
// Scene Section Component (Strictly Read-Only)
// ============================================================================

interface SceneSectionProps {
  scene: NogyaanState['scenes'][number];
  index: number;
  globalMedium: Medium;
  copiedShotId: string | null;
  collapsedPayloads: Record<string, boolean>;
  onCopyPrompt: (shotId: string, aiPayload: string) => void;
  onToggleCollapse: (shotId: string) => void;
}

const SceneSection: React.FC<SceneSectionProps> = ({
  scene,
  index,
  globalMedium,
  copiedShotId,
  collapsedPayloads,
  onCopyPrompt,
  onToggleCollapse
}) => {
  const { scene_id, locked_script, active_refs, spatial_memory, shots } = scene;
  const shotEntries = Object.entries(shots || {});

  const scriptTxt = (locked_script as any)?.txt || (locked_script as any)?.narrative_block || '';
  const scriptStyle = (locked_script as any)?.style || (locked_script as any)?.writer_persona || 'Locked';
  const scriptId = (locked_script as any)?.id || (locked_script as any)?.option_id || scene_id;

  return (
    <section className="bg-neutral-950 border border-neutral-800 rounded p-6">
      {/* Scene Top Badge */}
      <div className="flex items-center justify-between border-b border-neutral-800 pb-4 mb-6">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs font-bold px-2.5 py-1 rounded bg-neutral-900 border border-neutral-800 text-neutral-300">
            ACT {String(index + 1).padStart(2, '0')}
          </span>
          <h2 className="text-base font-bold text-white tracking-wide font-mono">
            {scene_id}
          </h2>
        </div>
        <div>
          {locked_script ? (
            <span className="text-xs font-mono font-medium px-2.5 py-1 rounded bg-neutral-900 border border-neutral-800 text-neutral-300 uppercase">
              SCRIPT LOCKED ({scriptStyle})
            </span>
          ) : (
            <span className="text-xs font-mono font-medium px-2.5 py-1 rounded bg-neutral-900 border border-neutral-800 text-neutral-500 uppercase">
              PENDING SCRIPT
            </span>
          )}
        </div>
      </div>

      {/* Surface Crucial State Data: Scene Visual Intent Story Block BEFORE Shot Cards */}
      {locked_script && (
        <div className="mb-8 p-5 bg-neutral-900 border border-neutral-800 rounded">
          <div className="flex items-center justify-between mb-3 border-b border-neutral-800 pb-2">
            <span className="text-[10px] uppercase font-mono font-bold tracking-widest text-neutral-400">
              SCENE NARRATIVE // VISUAL INTENT
            </span>
            <span className="text-[10px] font-mono text-neutral-500">
              {scriptId}
            </span>
          </div>
          <p className="font-serif text-base italic leading-relaxed text-neutral-100 mb-4">
            "{scriptTxt}"
          </p>

          {/* Active Refs Tagging */}
          {active_refs && active_refs.length > 0 && (
            <div className="pt-3 border-t border-neutral-800 flex items-center gap-2 mb-3">
              <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-400">
                ACTIVE REFERENCES:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {active_refs.map((ref) => (
                  <span
                    key={ref}
                    className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-neutral-800 border border-neutral-700 text-neutral-300"
                  >
                    {ref}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Rolling Spatial Memory (Room Geometry) */}
          {spatial_memory && spatial_memory.length > 0 && (
            <div className="pt-3 border-t border-neutral-800 flex flex-col gap-1.5 mb-3">
              <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-400 font-semibold">
                ROOM GEOMETRY (SPATIAL MEMORY):
              </span>
              <div className="flex flex-wrap gap-1.5">
                {spatial_memory.map((fact, idx) => (
                  <span
                    key={idx}
                    className="text-[10px] font-mono px-2 py-0.5 rounded bg-neutral-800 border border-neutral-700 text-neutral-300"
                  >
                    [SPATIAL] {fact}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Temporal Handshake (Last Shot Egress) */}
          {scene.last_shot_egress && (
            <div className="pt-3 border-t border-neutral-800 flex flex-col gap-1.5 mb-3">
              <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-400 font-semibold">
                TEMPORAL HANDSHAKE (LAST SHOT EGRESS):
              </span>
              <span className="text-xs font-mono text-neutral-300 bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1">
                [EGRESS] {scene.last_shot_egress}
              </span>
            </div>
          )}

          {/* Audio Stems Separation */}
          {(locked_script as any).audio_stem && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-3 border-t border-neutral-800 text-xs">
              <div className="p-3 bg-neutral-950 rounded border border-neutral-800">
                <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-neutral-400 block mb-1">
                  DIALOGUE (LIP-SYNC STEM)
                </span>
                <p className="font-serif italic text-neutral-200">
                  {(locked_script as any).audio_stem?.dialogue
                    ? `"${(locked_script as any).audio_stem.dialogue}"`
                    : 'None (Action only)'}
                </p>
              </div>
              <div className="p-3 bg-neutral-950 rounded border border-neutral-800">
                <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-neutral-400 block mb-1">
                  SFX & AMBIENCE (FOLEY STEM)
                </span>
                <p className="font-mono text-neutral-300">
                  {(locked_script as any).audio_stem?.sfx || 'Ambient soundscape'}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Phase 3: DP Shot Coverage */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-mono font-bold uppercase tracking-widest text-neutral-300">
            DIRECTOR OF PHOTOGRAPHY (DP) COVERAGE
          </h3>
          <span className="text-[10px] font-mono text-neutral-500">
            {shotEntries.length} SHOTS TOTAL
          </span>
        </div>

        {shotEntries.length === 0 ? (
          <p className="text-xs font-mono text-neutral-500 py-3">
            No shots pitched yet for this scene. Call pitch_shot_concepts in chat to generate 3 concepts.
          </p>
        ) : (
          <div className="space-y-6">
            {shotEntries.map(([shotKey, shotVal]) => {
              const lockedShot = (shotVal as any).locked_shot || shotVal;
              if (
                !lockedShot ||
                (!lockedShot.visual_intent &&
                  !lockedShot.txt &&
                  !lockedShot.sota_payload &&
                  !lockedShot.prmpt)
              )
                return null;
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
                  isPayloadCollapsed={!!collapsedPayloads[sId]}
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
// Shot Card Component (Strictly Read-Only, Monochrome, ONLY Button: Copy)
// ============================================================================

interface ShotCardProps {
  shotKey: string;
  shot: LockedShot;
  nodeId: string;
  globalMedium: Medium;
  isCopied: boolean;
  isPayloadCollapsed: boolean;
  onCopy: (prmpt: string) => void;
  onToggleCollapse: () => void;
}

const ShotCard: React.FC<ShotCardProps> = ({
  shotKey,
  shot,
  globalMedium,
  isCopied,
  isPayloadCollapsed,
  onCopy,
  onToggleCollapse
}) => {
  const shotStyle =
    (shot as any).style ||
    (shot as any).director_persona ||
    ((shot as any).visual_intent ? 'SOTA Shot' : 'Auteur');
  const shotTxt = (shot as any).visual_intent || (shot as any).txt || '';
  const shotPrmpt =
    (shot as any).sota_payload || (shot as any).prmpt || (shot as any).ai_payload || '';

  return (
    <div className="bg-neutral-950 border border-neutral-800 rounded p-5 transition-all">
      {/* Shot Header */}
      <div className="flex items-center justify-between mb-3 border-b border-neutral-800 pb-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-neutral-900 text-white border border-neutral-800">
            {shotKey}
          </span>
          <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-neutral-900 text-neutral-300 border border-neutral-800">
            {shotStyle}
          </span>
        </div>

        {/* The ONLY button allowed on a Shot Card: Copy AI Payload */}
        <button
          onClick={() => onCopy(shotPrmpt)}
          className={`px-3 py-1.5 text-xs font-mono font-bold tracking-wider uppercase transition-colors border ${
            isCopied
              ? 'bg-white text-black border-white'
              : 'bg-neutral-900 hover:bg-white hover:text-black text-neutral-200 border-neutral-700'
          }`}
        >
          {isCopied ? 'COPIED' : 'COPY AI PAYLOAD'}
        </button>
      </div>

      {/* Visual Intent (High-End Serif Typography for Screenplay Feel) */}
      <div className="mb-4">
        <span className="text-[10px] font-mono text-neutral-500 uppercase tracking-widest block mb-1.5">
          SHOT VISUAL INTENT
        </span>
        <blockquote className="font-serif text-base italic leading-relaxed text-neutral-100 border-l border-neutral-700 pl-3.5 py-0.5">
          "{shotTxt}"
        </blockquote>
      </div>

      {/* AI Video Diffusion Payload (Collapsible Monospaced Block) */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-mono text-neutral-500 uppercase tracking-widest">
            AI VIDEO DIFFUSION PAYLOAD (SOTA COMPILATION)
          </span>
          <button
            onClick={onToggleCollapse}
            className="text-[10px] font-mono text-neutral-400 hover:text-white transition-colors"
          >
            {isPayloadCollapsed ? '[EXPAND]' : '[COLLAPSE]'}
          </button>
        </div>

        {!isPayloadCollapsed && (
          <div className="bg-black border border-neutral-800 rounded p-3 font-mono text-xs text-neutral-300 leading-relaxed overflow-x-auto">
            <span className="text-neutral-500 select-none mr-2">$</span>
            <span className="text-white font-semibold select-none">[{globalMedium}] </span>
            <span>{shotPrmpt}</span>
          </div>
        )}
      </div>
    </div>
  );
};

export const NogyaanV2App = DirectorsTreatmentApp;
export default DirectorsTreatmentApp;
