export type ComposerSubmission =
  | { kind: 'empty' }
  | { kind: 'submit'; text: string }
  | { kind: 'replay'; text: string };

export function prepareComposerSubmission(
  composerText: string,
  replayText: string | null,
  transform?: (text: string) => string,
): ComposerSubmission {
  const trimmed = composerText.trim();
  if (!trimmed) return { kind: 'empty' };
  if (replayText === composerText) return { kind: 'submit', text: composerText };
  const submitted = transform?.(trimmed) ?? trimmed;
  return submitted === composerText
    ? { kind: 'submit', text: submitted }
    : { kind: 'replay', text: submitted };
}
