import assert from 'node:assert/strict';
import { parseReleaseNotes, safeHref } from '../src/utils/releaseNotes.ts';

console.log('--- Running Release Notes Rendering Tests ---');

console.log('[Test 1] A real release body becomes headings, bullets and paragraphs');
{
  const body = [
    'Fixes the installer on fresh machines.',
    '',
    '### Fixed',
    '',
    '- A first install stopped at the credentials step with `Cannot find module \'dotenv\'`. The installer read',
    '  `agent/.env` before `pnpm install` had run.',
    '- The installer tests now cover an interruption.',
    '',
    '**Full Changelog**: https://github.com/Cypher0071/Home_Cloud/compare/v1.2.0...v1.2.1',
  ].join('\n');
  const blocks = parseReleaseNotes(body);
  assert.deepEqual(blocks.map((b) => b.kind), ['paragraph', 'heading', 'list', 'paragraph']);
  assert.equal(blocks[1].text, 'Fixed');
  assert.equal(blocks[2].items.length, 2, 'two bullets');
  assert.match(blocks[2].items[0], /installer read `agent\/\.env` before/, 'a wrapped bullet line joins its bullet');
  assert.match(blocks[3].text, /^\*\*Full Changelog\*\*: https:/);
  console.log('  ✔ Headings, bullets, wrapped bullets and paragraphs parsed.');
}

console.log('[Test 2] Windows line endings, empty input and odd markdown do not throw');
{
  assert.deepEqual(parseReleaseNotes(''), []);
  assert.deepEqual(parseReleaseNotes('\r\n\r\n'), []);
  const crlf = parseReleaseNotes('### A\r\n- one\r\n- two\r\n');
  assert.deepEqual(crlf.map((b) => b.kind), ['heading', 'list']);
  assert.equal(crlf[1].items.join('|'), 'one|two');
  assert.doesNotThrow(() => parseReleaseNotes('####### not a heading\n```\ncode\n```\n<script>alert(1)</script>'));
  console.log('  ✔ CRLF, empty input and unsupported syntax are handled.');
}

console.log('[Test 3] Only http(s) links become links');
{
  assert.equal(safeHref('https://github.com/Cypher0071/Home_Cloud'), 'https://github.com/Cypher0071/Home_Cloud');
  assert.equal(safeHref('http://192.168.1.5:3000/x'), 'http://192.168.1.5:3000/x');
  for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>1</script>', 'vbscript:x', 'file:///etc/passwd', '//evil.example', 'not a url', '']) {
    assert.equal(safeHref(bad), null, `must reject ${bad}`);
  }
  console.log('  ✔ javascript:, data:, file: and malformed URLs are rejected.');
}

console.log('--- ALL RELEASE NOTES TESTS PASSED ---');
