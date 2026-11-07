import type { ReactNode } from 'react';
import styles from './settings.module.css';
import { parseReleaseNotes, safeHref } from '../../utils/releaseNotes';

/**
 * Renders GitHub release notes, which are Markdown, without a Markdown library.
 *
 * Release notes come from a network response, so this builds React elements only and never
 * injects HTML. It supports what the notes use: headings, bullet lists, paragraphs, `code`,
 * **bold**, and [links](https://...) (http and https only). Anything else shows as plain text.
 */

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[[^\]\n]+\]\([^)\s]+\))|(https?:\/\/[^\s<>)\]]+)/g;

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push(text.slice(last, index));
    const [token] = match;
    if (match[1]) {
      nodes.push(<code key={key++} className={styles.notesCode}>{token.slice(1, -1)}</code>);
    } else if (match[2]) {
      nodes.push(<strong key={key++}>{renderInline(token.slice(2, -2))}</strong>);
    } else if (match[3]) {
      const split = token.indexOf('](');
      const label = token.slice(1, split);
      const href = safeHref(token.slice(split + 2, -1));
      nodes.push(
        href ? (
          <a key={key++} href={href} target="_blank" rel="noopener noreferrer" className={styles.notesLink}>
            {label}
          </a>
        ) : (
          label
        ),
      );
    } else {
      const href = safeHref(token);
      nodes.push(
        href ? (
          <a key={key++} href={href} target="_blank" rel="noopener noreferrer" className={styles.notesLink}>
            {token}
          </a>
        ) : (
          token
        ),
      );
    }
    last = index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export default function ReleaseNotes({ markdown }: { markdown: string }) {
  const blocks = parseReleaseNotes(markdown);
  return (
    <div className={styles.releaseNotesBody}>
      {blocks.map((block, i) => {
        if (block.kind === 'heading') {
          return (
            <div key={i} className={styles.notesHeading}>
              {renderInline(block.text)}
            </div>
          );
        }
        if (block.kind === 'list') {
          return (
            <ul key={i} className={styles.notesList}>
              {block.items.map((item, j) => (
                <li key={j}>{renderInline(item)}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className={styles.notesParagraph}>
            {renderInline(block.text)}
          </p>
        );
      })}
    </div>
  );
}
