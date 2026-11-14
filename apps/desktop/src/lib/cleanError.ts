/**
 * An agent's error as people read it: without the terminal's colour codes (`ESC[91m`, also when the
 * escape character itself was dropped and only `[91m` is left) and with its whitespace folded.
 */
export function cleanError(text: string): string {
  return (
    text
      // eslint-disable-next-line no-control-regex
      .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f�]/g, '')
      .replace(/\[(?:\d{1,3}(?:;\d{1,3})*)m/g, '')
      .replace(/[ \t]+/g, ' ')
      .trim()
  );
}
