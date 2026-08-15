export async function* readSseData(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;

  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        completed = true;
        buffer += decoder.decode();
        break;
      }

      buffer += decoder.decode(result.value, { stream: true });
      const parsed = extractEvents(buffer);
      buffer = parsed.remainder;
      for (const data of parsed.events) yield data;
    }

    if (buffer.trim().length > 0) {
      const data = parseEventBlock(buffer);
      if (data !== undefined) yield data;
    }
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function extractEvents(value: string): { events: string[]; remainder: string } {
  const events: string[] = [];
  let remainder = value;

  while (true) {
    const separator = /\r?\n\r?\n/.exec(remainder);
    if (!separator || separator.index === undefined) break;

    const block = remainder.slice(0, separator.index);
    remainder = remainder.slice(separator.index + separator[0].length);
    const data = parseEventBlock(block);
    if (data !== undefined) events.push(data);
  }

  return { events, remainder };
}

function parseEventBlock(block: string): string | undefined {
  const dataLines = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''));

  return dataLines.length === 0 ? undefined : dataLines.join('\n');
}
