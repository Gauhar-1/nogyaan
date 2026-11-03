import React, { useState, useEffect } from 'react';
import {
  DirectorsCut,
  RenderMedium,
  SceneCoverage,
  SubShot
} from '../domain/schemas.js';

export interface DirectorsCutViewProps {
  initialCut?: DirectorsCut | null;
  apiBaseUrl?: string;
  onMediumChange?: (medium: RenderMedium) => void;
  onRerollShot?: (shotId: string, userFeedback: string) => Promise<DirectorsCut>;
  onCompileShots?: (medium: RenderMedium) => Promise<DirectorsCut>;
}

export const RENDER_MEDIUMS: RenderMedium[] = [
  'Live-Action Cinematic',
  '2D Anime',
  '3D Pixar Style',
  'Stop Motion'
];

export const DirectorsCutView: React.FC<DirectorsCutViewProps> = ({
  initialCut = null,
  apiBaseUrl = '',
  onMediumChange,
  onRerollShot,
  onCompileShots
}) => {
  const [directorsCut, setDirectorsCut] = useState<DirectorsCut | null>(initialCut);
  const [globalMedium, setGlobalMedium] = useState<RenderMedium>(
    initialCut?.global_render_medium || 'Live-Action Cinematic'
  );
  const [feedbackMap, setFeedbackMap] = useState<Record<string, string>>({});
  const [loadingShotId, setLoadingShotId] = useState<string | null>(null);
  const [isCompiling, setIsCompiling] = useState<boolean>(false);
  const [copiedShotId, setCopiedShotId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (initialCut) {
      setDirectorsCut(initialCut);
      setGlobalMedium(initialCut.global_render_medium);
    }
  }, [initialCut]);

  const handleMediumSelect = (newMedium: RenderMedium) => {
    setGlobalMedium(newMedium);
    if (directorsCut) {
      setDirectorsCut({
        ...directorsCut,
        global_render_medium: newMedium
      });
    }
    if (onMediumChange) {
      onMediumChange(newMedium);
    }
  };

  const handleCompileShots = async () => {
    setIsCompiling(true);
    setErrorMessage(null);
    try {
      if (onCompileShots) {
        const result = await onCompileShots(globalMedium);
        setDirectorsCut(result);
      } else {
        const res = await fetch(`${apiBaseUrl}/api/compile-shots`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ global_render_medium: globalMedium })
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Failed to compile shots (${res.status})`);
        }
        const data: DirectorsCut = await res.json();
        setDirectorsCut(data);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to compile shots.');
    } finally {
      setIsCompiling(false);
    }
  };

  const handleRerollSubmit = async (shotId: string) => {
    const feedback = feedbackMap[shotId]?.trim();
    if (!feedback) return;

    setLoadingShotId(shotId);
    setErrorMessage(null);

    // Optimistic UI Update: immediately mark sub-shot with pending feedback note
    const previousCut = directorsCut;
    if (directorsCut) {
      const optimisticScenes = directorsCut.scenes.map((scene) => ({
        ...scene,
        coverage: scene.coverage.map((sh) => {
          if (sh.shot_id === shotId) {
            return {
              ...sh,
              cinematic_prompt: `${sh.cinematic_prompt} [Refining: ${feedback}...]`
            };
          }
          return sh;
        })
      }));
      setDirectorsCut({ ...directorsCut, scenes: optimisticScenes });
    }

    try {
      let updatedCut: DirectorsCut;
      if (onRerollShot) {
        updatedCut = await onRerollShot(shotId, feedback);
      } else {
        const res = await fetch(`${apiBaseUrl}/api/reroll-shot`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shot_id: shotId, user_feedback: feedback })
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Reroll failed with HTTP ${res.status}`);
        }
        updatedCut = await res.json();
      }

      setDirectorsCut(updatedCut);
      // Clear the input on success
      setFeedbackMap((prev) => ({ ...prev, [shotId]: '' }));
    } catch (err: any) {
      // Revert optimistic update on failure
      setDirectorsCut(previousCut);
      setErrorMessage(err.message || 'Failed to refine shot.');
    } finally {
      setLoadingShotId(null);
    }
  };

  const handleCopyPrompt = (fullPrompt: string, shotId: string) => {
    navigator.clipboard.writeText(fullPrompt).then(() => {
      setCopiedShotId(shotId);
      setTimeout(() => setCopiedShotId(null), 1800);
    });
  };

  return (
    <div className="directors-cut-container">
      {/* Top Header / Global Render Medium Dropdown */}
      <div className="directors-cut-header">
        <div className="header-meta">
          <span className="badge-tier">TIER 2</span>
          <h2 className="title">Director's Shot Compiler</h2>
        </div>

        <div className="controls-row">
          <div className="medium-select-group">
            <label htmlFor="global-render-medium-select">Global Render Medium:</label>
            <select
              id="global-render-medium-select"
              className="select-render-medium"
              value={globalMedium}
              onChange={(e) => handleMediumSelect(e.target.value as RenderMedium)}
            >
              {RENDER_MEDIUMS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <button
            className="btn-compile"
            onClick={handleCompileShots}
            disabled={isCompiling}
          >
            {isCompiling ? 'Compiling Sub-Shots...' : directorsCut ? 'Recompile Shots' : 'Compile 4-Scene Shot List'}
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="error-banner">
          <span>⚠️ {errorMessage}</span>
          <button className="btn-dismiss" onClick={() => setErrorMessage(null)}>×</button>
        </div>
      )}

      {/* Empty State */}
      {!directorsCut && !isCompiling && (
        <div className="empty-directors-cut">
          <p>Finalize your 4 scenes and click <strong>Compile 4-Scene Shot List</strong> to run the Coverage Matrix & Logic Tree rules.</p>
        </div>
      )}

      {/* Scenes List */}
      {directorsCut && (
        <div className="scenes-list">
          {directorsCut.scenes.map((scene: SceneCoverage, sIdx: number) => {
            const hasDialogue = Boolean(scene.audio_stem?.dialogue && scene.audio_stem.dialogue !== 'NONE');
            const hasSfx = Boolean(scene.audio_stem?.sfx && scene.audio_stem.sfx !== 'NONE');

            return (
              <div key={scene.scene_id || sIdx} className="scene-coverage-block">
                {/* Scene Header */}
                <div className="scene-header-card">
                  <div className="scene-tag-row">
                    <span className="scene-badge">{scene.scene_id}</span>
                    <span className="subshots-count">{scene.coverage.length} Sub-Shots Generated</span>
                  </div>

                  <p className="narrative-block">{scene.narrative_block}</p>

                  {/* Audio Stem Box */}
                  <div className="audio-stem-box">
                    <div className="audio-stem-title">AUDIO STEM (VO / SFX SEPARATION)</div>
                    <div className="audio-stem-tracks">
                      <div className="audio-track dialogue-track">
                        <span className="track-label">Dialogue:</span>
                        <span className="track-val">
                          {hasDialogue ? `"${scene.audio_stem.dialogue}"` : 'None (No on-camera speech)'}
                        </span>
                      </div>
                      <div className="audio-track sfx-track">
                        <span className="track-label">Foley / SFX:</span>
                        <span className="track-val">
                          {hasSfx ? scene.audio_stem.sfx : 'Ambient environment tone'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Sub-Shot Coverage Cards Grid */}
                <div className="coverage-subshots-grid">
                  {scene.coverage.map((sub: SubShot) => {
                    const fullGenerationPrompt = `[${globalMedium}] ${sub.cinematic_prompt}`;
                    const isRefiningThis = loadingShotId === sub.shot_id;
                    const isCopied = copiedShotId === sub.shot_id;

                    return (
                      <div key={sub.shot_id} className={`subshot-card ${isRefiningThis ? 'refining' : ''}`}>
                        <div className="subshot-card-top">
                          <div className="subshot-identifiers">
                            <span className="shot-id-badge">{sub.shot_id}</span>
                            <span className="subshot-type-badge">{sub.sub_shot_type}</span>
                          </div>

                          <button
                            className={`btn-copy-prompt ${isCopied ? 'copied' : ''}`}
                            onClick={() => handleCopyPrompt(fullGenerationPrompt, sub.shot_id)}
                          >
                            {isCopied ? 'Copied!' : 'Copy Prompt'}
                          </button>
                        </div>

                        {/* Prompt Display */}
                        <div className="prompt-display-box">
                          <span className="prompt-prefix">[{globalMedium}]</span>{' '}
                          <span className="prompt-content">{sub.cinematic_prompt}</span>
                        </div>

                        {/* Targeted Re-Roll / Refine Input & Button */}
                        <div className="reroll-controls">
                          <input
                            type="text"
                            className="input-refine"
                            placeholder="Edit/Refine (e.g. push-in closer, make lighting harsher...)"
                            value={feedbackMap[sub.shot_id] || ''}
                            onChange={(e) =>
                              setFeedbackMap({
                                ...feedbackMap,
                                [sub.shot_id]: e.target.value
                              })
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                handleRerollSubmit(sub.shot_id);
                              }
                            }}
                            disabled={isRefiningThis}
                          />

                          <button
                            className="btn-reroll-submit"
                            onClick={() => handleRerollSubmit(sub.shot_id)}
                            disabled={isRefiningThis || !feedbackMap[sub.shot_id]?.trim()}
                          >
                            {isRefiningThis ? 'Refining...' : 'Refine Shot'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default DirectorsCutView;
