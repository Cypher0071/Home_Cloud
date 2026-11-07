import assert from 'node:assert/strict';
import { checkPortRows, defaultPortRows, suggestHostPort } from '../src/utils/portChecks.ts';

console.log('--- Running Port Check Tests ---');

const errors = (issues) => issues.filter((i) => i.level === 'error');
const warnings = (issues) => issues.filter((i) => i.level === 'warning');

// suggestHostPort
assert.equal(suggestHostPort(5432, new Set()), 5432, 'high ports keep their own number when free');
assert.equal(suggestHostPort(80, new Set()), 8080, 'web ports below 1024 start at 8080');
assert.equal(suggestHostPort(80, new Set([8080, 8081])), 8082);
assert.equal(suggestHostPort(6665, new Set()), 6670, 'skips browser-blocked 6665-6669');
console.log('  ✔ suggests free, browser-safe host ports');

// Two images that both listen on 80: the second just gets the next host port.
{
  const used = [{ port: 8080, owner: 'container "excalidraw"', active: true }];
  assert.deepEqual(defaultPortRows([80], used), [{ hostPort: '8081', containerPort: '80' }]);
  assert.deepEqual(defaultPortRows([80, 443], []), [
    { hostPort: '8080', containerPort: '80' },
    { hostPort: '8081', containerPort: '443' },
  ]);
  assert.deepEqual(defaultPortRows([], [], '5432'), [{ hostPort: '5432', containerPort: '5432' }], 'preset fallback');
  assert.deepEqual(defaultPortRows([], []), [{ hostPort: '', containerPort: '' }]);
  console.log('  ✔ pre-fills one row per declared port, around ports in use');
}

// The excalidraw mistake: host 6666 (browser-blocked), container 6767 (image listens on 80).
{
  const [issues] = checkPortRows([{ hostPort: '6666', containerPort: '6767' }], [], [80]);
  assert.equal(errors(issues).length, 0, 'both are warnings, not blockers');
  const unsafe = issues.find((i) => i.field === 'host');
  assert.match(unsafe.message, /Browsers block port 6666/);
  assert.equal(unsafe.fix.value, '6767', 'fix stays near the container port and is safe');
  const wrong = issues.find((i) => i.field === 'container');
  assert.match(wrong.message, /listens on 80, not 6767/);
  assert.deepEqual(wrong.fix, { field: 'container', value: '80', label: 'Use 80' });
  console.log('  ✔ flags browser-blocked host ports and undeclared container ports');
}

// Hard errors
{
  const used = [
    { port: 8080, owner: 'container "excalidraw"', active: true },
    { port: 9000, owner: 'stopped container "old"', active: false },
  ];
  const [inUse] = checkPortRows([{ hostPort: '8080', containerPort: '80' }], used, [80]);
  assert.match(errors(inUse)[0].message, /already used by container "excalidraw"/);
  assert.equal(errors(inUse)[0].fix.value, '8081');

  const [reserved] = checkPortRows([{ hostPort: '9000', containerPort: '80' }], used, [80]);
  assert.equal(errors(reserved).length, 0);
  assert.match(warnings(reserved)[0].message, /reserved by stopped container "old"/);

  const dupes = checkPortRows([
    { hostPort: '8100', containerPort: '80' },
    { hostPort: '8100', containerPort: '443' },
  ], [], []);
  assert.ok(dupes.every((row) => errors(row).some((i) => /another row/.test(i.message))));
  assert.notEqual(dupes[0][0].fix.value, '8100');

  assert.equal(errors(checkPortRows([{ hostPort: '99999', containerPort: '80' }], [], [])[0]).length, 1);
  assert.equal(errors(checkPortRows([{ hostPort: '8080', containerPort: '' }], [], [80])[0])[0].fix.value, '80');
  assert.equal(checkPortRows([{ hostPort: '', containerPort: '' }], used, [80])[0].length, 0, 'empty rows are ignored');
  assert.equal(checkPortRows([{ hostPort: '8081', containerPort: '80' }], used, [80])[0].length, 0, 'a good row is clean');
  console.log('  ✔ blocks taken, duplicate, malformed and half-filled mappings');
}

console.log('All port check tests passed.');
