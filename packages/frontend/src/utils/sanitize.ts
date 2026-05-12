/**
 * Sanitizes LLM-generated explanation text for safe plain-text rendering.
 *
 * - Preserves **bold** markers so the caller can render them (e.g. as <strong>)
 * - Strips all other markdown syntax
 * - Removes bare URLs the model might hallucinate
 *
 * Always set the result via textContent (not innerHTML) unless you explicitly
 * handle the bold markers yourself.
 */
export function sanitizeExplanation(text: string): string {
  return (
    text
      // Strip markdown headings
      .replace(/^#{1,6}\s+/gm, '')
      // Strip unordered list markers
      .replace(/^[-*+]\s+/gm, '')
      // Strip ordered list markers
      .replace(/^\d+\.\s+/gm, '')
      // Strip inline code
      .replace(/`([^`]*)`/g, '$1')
      // Strip code blocks
      .replace(/```[\s\S]*?```/g, '')
      // Strip [text](url) links — keep the label
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      // Strip bare URLs
      .replace(/https?:\/\/\S+/g, '')
      // Strip italic (single * or _) but NOT double ** which is bold
      .replace(/(?<!\*)\*(?!\*)([^*]+)(?<!\*)\*(?!\*)/g, '$1')
      .replace(/(?<!_)_(?!_)([^_]+)(?<!_)_(?!_)/g, '$1')
      // Collapse 3+ newlines to 2
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/**
 * Converts sanitized text with **bold** markers into an array of segments
 * for React rendering without dangerouslySetInnerHTML.
 *
 * Usage:
 *   parseBoldSegments(sanitizeExplanation(text)).map((seg, i) =>
 *     seg.bold ? <strong key={i}>{seg.text}</strong> : <span key={i}>{seg.text}</span>
 *   )
 */
export function parseBoldSegments(text: string): { text: string; bold: boolean }[] {
  const parts = text.split(/\*\*([^*]+)\*\*/g);
  return parts.map((part, i) => ({ text: part, bold: i % 2 === 1 }));
}
