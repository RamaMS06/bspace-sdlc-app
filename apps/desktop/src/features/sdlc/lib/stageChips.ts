/**
 * The quick replies under a feature chat, by the stage the feature is on (0 Ideate … 6 Deploy): what a
 * person most often says next at that stage. Keys of `composer.chips` in the translations; the text shown
 * is what is sent. "What's next?" is always first: the entry skill answers it from the files on disk.
 */
const STAGE_CHIPS: readonly (readonly string[])[] = [
  ['next', 'ideateSummary', 'ideateGaps', 'ideateApprove'],
  ['next', 'blueprintDraft', 'blueprintQuestions', 'blueprintData'],
  ['next', 'wireframeScreens', 'wireframeFlow', 'wireframeApprove'],
  ['next', 'designScreen', 'designReview', 'designComponents'],
  ['next', 'buildScreen', 'buildEmulator', 'buildChanges'],
  ['next', 'verifyRun', 'verifyFigma', 'verifyFix'],
  ['next', 'deployNotes', 'deployClose'],
];

/** The chip keys for a stage; a finished feature (past Deploy) gets Deploy's. */
export function stageChips(stage: number): readonly string[] {
  return STAGE_CHIPS[Math.min(Math.max(stage, 0), STAGE_CHIPS.length - 1)]!;
}
