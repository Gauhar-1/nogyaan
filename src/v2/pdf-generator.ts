import { jsPDF } from 'jspdf';
import { NogyaanState } from './types.js';

/**
 * Native JSON-to-PDF Generator for nogyaan V2 Director's Treatment.
 * Generates high-end, monochrome, selectable-text PDFs directly from NogyaanState JSON.
 * Completely replaces DOM-screenshot / window.print() captures.
 */
export function buildTreatmentPdfDoc(state: NogyaanState): jsPDF {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4'
  });

  const pageWidth = doc.internal.pageSize.getWidth(); // 595.28 pt
  const pageHeight = doc.internal.pageSize.getHeight(); // 841.89 pt
  const marginLeft = 45;
  const marginRight = 45;
  const contentWidth = pageWidth - marginLeft - marginRight; // 505.28 pt
  const marginTop = 45;
  const marginBottom = 45;
  const maxContentY = pageHeight - marginBottom; // 796.89 pt

  const projectId = state.project_id || 'NOGYAAN PRODUCTION BLUEPRINT';
  const medium = state.global_medium || 'Live-Action Cinematic';
  const premise = state.core_premise || 'No core premise recorded.';
  const notes = state.global_director_notes || '';
  const assets = state.assets || { characters: {}, backgrounds: {}, product: '' };
  const scenes = state.scenes || [];

  let currentY = marginTop;

  // Running header on subsequent / continuation pages
  const printRunningHeader = (leftText: string, rightText: string) => {
    doc.setFont('courier', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(120, 120, 120);
    doc.text(leftText.toUpperCase(), marginLeft, 32);
    const rWidth = doc.getTextWidth(rightText.toUpperCase());
    doc.text(rightText.toUpperCase(), pageWidth - marginRight - rWidth, 32);
    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.5);
    doc.line(marginLeft, 36, pageWidth - marginRight, 36);
  };

  // Section divider rule
  const drawDivider = (y: number, stroke: number = 0.5, gray: number = 220) => {
    doc.setDrawColor(gray, gray, gray);
    doc.setLineWidth(stroke);
    doc.line(marginLeft, y, marginLeft + contentWidth, y);
  };

  // Check page overflow on Page 1
  const ensureSpace = (needed: number, sectionHeader?: string) => {
    if (currentY + needed > maxContentY) {
      doc.addPage();
      currentY = marginTop + 10;
      if (sectionHeader) {
        printRunningHeader('ASSET BIBLE (CONTINUED)', projectId);
        currentY += 16;
      }
    }
  };

  // ==========================================================================
  // PAGE 1: COVER & CONTEXT
  // ==========================================================================

  // 1. Running Top Meta
  doc.setFont('courier', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(110, 110, 110);
  doc.text('NOGYAAN STUDIO // PRODUCTION SPECIFICATION BLUEPRINT', marginLeft, currentY);
  const projRight = `PROJECT: ${projectId.toUpperCase()}`;
  doc.text(projRight, pageWidth - marginRight - doc.getTextWidth(projRight), currentY);
  currentY += 8;
  drawDivider(currentY, 0.75, 180);
  currentY += 26;

  // 2. Document Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(0, 0, 0);
  doc.text("Director's Treatment & SOTA Blueprints", marginLeft, currentY);
  currentY += 16;

  doc.setFont('courier', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(90, 90, 90);
  doc.text(`GLOBAL RENDER MEDIUM: [${medium}] · SEQUENTIAL STORYBOARD ENGINE`, marginLeft, currentY);
  currentY += 12;
  drawDivider(currentY, 1, 60);
  currentY += 22;

  // 3. Core Theme / Campaign Premise
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(80, 80, 80);
  doc.text('CAMPAIGN CORE PREMISE & EMOTIONAL GOAL', marginLeft, currentY);
  currentY += 14;

  doc.setFont('times', 'italic');
  doc.setFontSize(11);
  doc.setTextColor(20, 20, 20);
  const premiseLines = doc.splitTextToSize(`"${premise}"`, contentWidth - 18);
  const premiseHeight = premiseLines.length * 14;

  // Left accent bar
  doc.setFillColor(60, 60, 60);
  doc.rect(marginLeft, currentY - 9, 2.5, premiseHeight + 3, 'F');
  doc.text(premiseLines, marginLeft + 12, currentY);
  currentY += premiseHeight + 14;

  // Persistent Cinematic Rules (Director Notes)
  if (notes && notes.trim().length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(90, 90, 90);
    doc.text('PERSISTENT CINEMATIC DIRECTIVES (DIRECTOR NOTES):', marginLeft, currentY);
    currentY += 12;

    doc.setFont('courier', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(40, 40, 40);
    const noteLines = doc.splitTextToSize(notes, contentWidth - 16);
    const noteHeight = noteLines.length * 11;
    doc.setFillColor(248, 248, 248);
    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.5);
    doc.rect(marginLeft, currentY - 8, contentWidth, noteHeight + 10, 'FD');
    doc.text(noteLines, marginLeft + 8, currentY + 2);
    currentY += noteHeight + 18;
  }

  drawDivider(currentY, 0.5, 210);
  currentY += 20;

  // 4. Asset Bible Specifications
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  doc.text('ASSET BIBLE (SPECIFICATIONS)', marginLeft, currentY);
  currentY += 16;

  // Hero Product
  ensureSpace(45, 'ASSET BIBLE');
  doc.setFont('courier', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(50, 50, 50);
  doc.text('HERO PRODUCT [@PROD_01]:', marginLeft, currentY);
  currentY += 12;

  doc.setFont('times', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(30, 30, 30);
  const prodText = assets.product || 'Awaiting hero product specification.';
  const prodLines = doc.splitTextToSize(prodText, contentWidth - 10);
  doc.text(prodLines, marginLeft + 10, currentY);
  currentY += prodLines.length * 12 + 14;

  // Characters
  const charEntries = Object.entries(assets.characters || {});
  ensureSpace(35 + charEntries.length * 24, 'ASSET BIBLE');
  doc.setFont('courier', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(50, 50, 50);
  doc.text(`CHARACTERS (${charEntries.length} REGISTERED):`, marginLeft, currentY);
  currentY += 12;

  if (charEntries.length === 0) {
    doc.setFont('times', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    doc.text('No characters registered.', marginLeft + 10, currentY);
    currentY += 16;
  } else {
    for (const [cKey, cDesc] of charEntries) {
      ensureSpace(28, 'ASSET BIBLE');
      const tag = `@${cKey.replace(/^@/, '')}`;
      doc.setFont('courier', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(0, 0, 0);
      doc.text(tag, marginLeft + 10, currentY);

      doc.setFont('times', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(40, 40, 40);
      const cLines = doc.splitTextToSize(cDesc, contentWidth - 95);
      doc.text(cLines, marginLeft + 85, currentY);
      currentY += Math.max(cLines.length * 11, 14) + 6;
    }
    currentY += 6;
  }

  // Environments
  const bgEntries = Object.entries(assets.backgrounds || {});
  ensureSpace(35 + bgEntries.length * 24, 'ASSET BIBLE');
  doc.setFont('courier', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(50, 50, 50);
  doc.text(`ENVIRONMENTS (${bgEntries.length} REGISTERED):`, marginLeft, currentY);
  currentY += 12;

  if (bgEntries.length === 0) {
    doc.setFont('times', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    doc.text('No environments registered.', marginLeft + 10, currentY);
    currentY += 16;
  } else {
    for (const [bKey, bDesc] of bgEntries) {
      ensureSpace(28, 'ASSET BIBLE');
      const tag = `@${bKey.replace(/^@/, '')}`;
      doc.setFont('courier', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(0, 0, 0);
      doc.text(tag, marginLeft + 10, currentY);

      doc.setFont('times', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(40, 40, 40);
      const bLines = doc.splitTextToSize(bDesc, contentWidth - 95);
      doc.text(bLines, marginLeft + 85, currentY);
      currentY += Math.max(bLines.length * 11, 14) + 6;
    }
  }

  // ==========================================================================
  // SUBSEQUENT PAGES: THE SCENES & SOTA SHOTS
  // ==========================================================================

  scenes.forEach((scene, sceneIndex) => {
    // Each scene starts on a subsequent page
    doc.addPage();
    currentY = marginTop;

    printRunningHeader(`ACT 0${sceneIndex + 1} // ${scene.scene_id}`, projectId);
    currentY += 15;

    // Scene Title Banner
    const lockedScript: any = scene.locked_script;
    const scriptStyle =
      lockedScript?.style ||
      lockedScript?.writer_persona ||
      (lockedScript ? 'Locked' : 'Pending');
    const scriptText =
      lockedScript?.txt ||
      lockedScript?.narrative_block ||
      'Awaiting locked script narrative.';

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(0, 0, 0);
    doc.text(`SCENE: ${scene.scene_id}`, marginLeft, currentY);

    doc.setFont('courier', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(70, 70, 70);
    const badgeText = `SCRIPT LOCKED [${scriptStyle.toUpperCase()}]`;
    doc.text(badgeText, pageWidth - marginRight - doc.getTextWidth(badgeText), currentY);
    currentY += 8;
    drawDivider(currentY, 0.75, 140);
    currentY += 18;

    // Scene Narrative & Visual Intent Story Block
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(90, 90, 90);
    doc.text('SCENE NARRATIVE & VISUAL INTENT:', marginLeft, currentY);
    currentY += 12;

    doc.setFont('times', 'italic');
    doc.setFontSize(10.5);
    doc.setTextColor(20, 20, 20);
    const scriptLines = doc.splitTextToSize(`"${scriptText}"`, contentWidth - 20);
    const scriptBlockHeight = scriptLines.length * 13;

    // Narrative accent border
    doc.setFillColor(60, 60, 60);
    doc.rect(marginLeft, currentY - 8, 2.5, scriptBlockHeight + 2, 'F');
    doc.text(scriptLines, marginLeft + 12, currentY);
    currentY += scriptBlockHeight + 10;

    // Active References Tagging
    if (scene.active_refs && scene.active_refs.length > 0) {
      doc.setFont('courier', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(90, 90, 90);
      doc.text(`ACTIVE REFERENCES: ${scene.active_refs.join('   ')}`, marginLeft + 12, currentY);
      currentY += 12;
    }

    // Rolling Spatial Memory
    if (scene.spatial_memory && scene.spatial_memory.length > 0) {
      doc.setFont('courier', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(80, 80, 80);
      doc.text(`ROOM GEOMETRY: ${scene.spatial_memory.join(' · ')}`, marginLeft + 12, currentY);
      currentY += 12;
    }

    // Audio stems
    if (lockedScript?.audio_stem) {
      doc.setFont('courier', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(100, 100, 100);
      const dialoguePart = lockedScript.audio_stem.dialogue
        ? `DIALOGUE: "${lockedScript.audio_stem.dialogue}"`
        : 'DIALOGUE: None';
      const sfxPart = lockedScript.audio_stem.sfx ? `SFX: ${lockedScript.audio_stem.sfx}` : '';
      doc.text(`${dialoguePart}  |  ${sfxPart}`, marginLeft + 12, currentY);
      currentY += 12;
    }

    currentY += 6;
    drawDivider(currentY, 0.5, 210);
    currentY += 18;

    // DP Shot Coverage Section Header
    const shotEntries = Object.entries(scene.shots || {});
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    doc.text(`DIRECTOR OF PHOTOGRAPHY (DP) COVERAGE (${shotEntries.length} SHOTS)`, marginLeft, currentY);
    currentY += 14;

    if (shotEntries.length === 0) {
      doc.setFont('times', 'italic');
      doc.setFontSize(9.5);
      doc.setTextColor(120, 120, 120);
      doc.text('No shots pitched or compiled for this scene yet.', marginLeft + 10, currentY);
      currentY += 20;
      return;
    }

    // ========================================================================
    // Loop through the locked shots with Smart Page-Break-Before logic
    // ========================================================================
    shotEntries.forEach(([shotKey, shotVal]) => {
      const lockedShot: any = (shotVal as any).locked_shot || shotVal;
      if (!lockedShot) return;

      const shotStyle =
        lockedShot.style ||
        lockedShot.director_persona ||
        (lockedShot.visual_intent ? 'SOTA Shot' : 'Auteur');
      const shotIntent =
        lockedShot.visual_intent ||
        lockedShot.txt ||
        'No visual intent specified.';
      const rawPayload =
        lockedShot.sota_payload ||
        lockedShot.prmpt ||
        lockedShot.ai_payload ||
        '';
      const formattedPayload = `[${medium}] ${rawPayload}`;

      // 1. Calculate intent lines & height
      doc.setFont('times', 'italic');
      doc.setFontSize(9.5);
      const intentLines = doc.splitTextToSize(`"${shotIntent}"`, contentWidth - 24);
      const intentHeight = intentLines.length * 12;

      // 2. Calculate technical payload lines & height
      doc.setFont('courier', 'normal');
      doc.setFontSize(7.5);
      const payloadLines = doc.splitTextToSize(formattedPayload, contentWidth - 28);
      const payloadBoxHeight = payloadLines.length * 10 + 16;

      // 3. Total required height for this single shot block:
      // Header (16) + Intent (12 + intentHeight) + Payload Box (14 + payloadBoxHeight) + Bottom Margin (22)
      const totalShotHeight = 16 + 12 + intentHeight + 14 + payloadBoxHeight + 22;

      // 4. SMART PAGE-BREAK-BEFORE LOGIC:
      // If the shot block exceeds remaining page height, break page before starting the shot.
      // This guarantees a shot's technical payload is NEVER split awkwardly across two pages!
      if (currentY + totalShotHeight > maxContentY) {
        doc.addPage();
        currentY = marginTop;
        printRunningHeader(`ACT 0${sceneIndex + 1} // ${scene.scene_id} (CONTINUED)`, projectId);
        currentY += 22;
      }

      // Render Shot Header
      doc.setFont('courier', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(0, 0, 0);
      doc.text(`${shotKey}`, marginLeft, currentY);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(80, 80, 80);
      doc.text(`[${shotStyle.toUpperCase()}]`, marginLeft + 65, currentY);
      currentY += 6;
      drawDivider(currentY, 0.4, 215);
      currentY += 12;

      // Render Visual Intent (Inset with italic styling)
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(110, 110, 110);
      doc.text('VISUAL INTENT:', marginLeft + 8, currentY);
      currentY += 10;

      doc.setFont('times', 'italic');
      doc.setFontSize(9.5);
      doc.setTextColor(30, 30, 30);
      // Left gray inset rule
      doc.setFillColor(120, 120, 120);
      doc.rect(marginLeft + 8, currentY - 7, 1.5, intentHeight + 2, 'F');
      doc.text(intentLines, marginLeft + 18, currentY);
      currentY += intentHeight + 10;

      // Render SOTA Technical AI Payload in Monospace Blockquote Box
      doc.setFont('courier', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(90, 90, 90);
      doc.text('AI VIDEO DIFFUSION PAYLOAD (SOTA COMPILATION):', marginLeft + 8, currentY);
      currentY += 8;

      // Background box: Pale gray fill, light gray border
      doc.setFillColor(246, 246, 246);
      doc.setDrawColor(215, 215, 215);
      doc.setLineWidth(0.5);
      doc.rect(marginLeft + 8, currentY - 6, contentWidth - 8, payloadBoxHeight, 'FD');

      // Left dark accent bar
      doc.setFillColor(50, 50, 50);
      doc.rect(marginLeft + 8, currentY - 6, 2.5, payloadBoxHeight, 'F');

      // Monospace payload text inside box
      doc.setFont('courier', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(25, 25, 25);
      doc.text(payloadLines, marginLeft + 18, currentY + 6);
      currentY += payloadBoxHeight + 18;
    });
  });

  // ==========================================================================
  // RUNNING FOOTERS ON EVERY PAGE
  // ==========================================================================
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    const footerY = pageHeight - 25;
    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.5);
    doc.line(marginLeft, footerY - 10, pageWidth - marginRight, footerY - 10);

    doc.setFont('courier', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(130, 130, 130);
    doc.text('NOGYAAN STUDIO // DIRECTOR\'S BLUEPRINT · PRODUCTION CONFIDENTIAL', marginLeft, footerY);

    const pageStr = `PAGE ${p} OF ${totalPages}`;
    const pageStrWidth = doc.getTextWidth(pageStr);
    doc.setFont('courier', 'bold');
    doc.setTextColor(90, 90, 90);
    doc.text(pageStr, pageWidth - marginRight - pageStrWidth, footerY);
  }

  return doc;
}

export const createTreatmentPdf = buildTreatmentPdfDoc;

/**
 * Generates binary Buffer containing the native selectable-text PDF.
 */
export function generateTreatmentPdfBuffer(state: NogyaanState): Buffer {
  const doc = buildTreatmentPdfDoc(state);
  const arrayBuffer = doc.output('arraybuffer');
  return Buffer.from(arrayBuffer);
}

/**
 * Triggers client-side browser file download for the treatment blueprint PDF.
 */
export function downloadTreatmentPdf(
  state: NogyaanState,
  filename: string = 'directors-treatment-blueprint.pdf'
): void {
  const doc = buildTreatmentPdfDoc(state);
  if (typeof window !== 'undefined' && typeof doc.save === 'function') {
    doc.save(filename);
  }
}

