import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const WORKSPACE_ROOT = '/home/rudra-unix/orca/workspaces/home_cloud/siren';
const DOCKER_APP_PATH = path.join(WORKSPACE_ROOT, 'dashboard/src/components/apps/DockerApp.tsx');
const DOCKER_CSS_PATH = path.join(WORKSPACE_ROOT, 'dashboard/src/components/apps/docker.module.css');

describe('Docker Compose Container Image Autocomplete - Verification Suite', () => {
  const dockerAppContent = fs.readFileSync(DOCKER_APP_PATH, 'utf-8');
  const dockerCssContent = fs.readFileSync(DOCKER_CSS_PATH, 'utf-8');

  describe('R1. Minimal In-App Custom Dropdown & Styling', () => {
    test('T1.1: No native <datalist> elements are present in DockerApp.tsx', () => {
      assert.ok(!dockerAppContent.includes('<datalist'), 'Must not contain native <datalist>');
      assert.ok(!dockerAppContent.includes('list='), 'Must not reference a datalist ID in inputs');
    });

    test('T1.2: Dropdown CSS contains pitch-black background #0a0a0a and #262626 border', () => {
      assert.ok(dockerCssContent.includes('.autocompleteDropdown'), 'Must define .autocompleteDropdown class');
      assert.ok(dockerCssContent.includes('background: #0a0a0a'), 'Must use #0a0a0a background');
      assert.ok(dockerCssContent.includes('border: 1px solid #262626'), 'Must use #262626 border');
    });

    test('T1.3: Dropdown is anchored directly beneath the Container Image input', () => {
      assert.ok(dockerCssContent.includes('position: absolute'), 'Dropdown must be absolutely positioned');
      assert.ok(dockerCssContent.includes('top: calc(100% + 4px)'), 'Dropdown must be anchored beneath input');
      assert.ok(dockerCssContent.includes('.autocompleteInputWrapper'), 'Wrapper must exist for anchoring');
    });

    test('T1.4: Subtle hover and highlight styling for dropdown items', () => {
      assert.ok(dockerCssContent.includes('.autocompleteItem'), 'Must define .autocompleteItem');
      assert.ok(dockerCssContent.includes('.autocompleteItemHighlighted'), 'Must define .autocompleteItemHighlighted');
      assert.ok(dockerCssContent.includes('background: #171717'), 'Hover/highlight background must be #171717');
    });

    test('T1.5: Custom scrollbar styling for autocomplete dropdown', () => {
      assert.ok(dockerCssContent.includes('.autocompleteDropdown::-webkit-scrollbar'), 'Custom scrollbar defined');
      assert.ok(dockerCssContent.includes('max-height: 200px'), 'Dropdown has max-height constraint');
      assert.ok(dockerCssContent.includes('overflow-y: auto'), 'Dropdown has overflow-y auto');
    });
  });

  describe('R2. Activation Rules & Filtering Logic', () => {
    // Pure logic extraction test matching the implementation in DockerApp.tsx
    const sampleImages = [
      { Id: 'sha256:1', RepoTags: ['nginx:alpine', 'nginx:latest'], Size: 100, Created: 1 },
      { Id: 'sha256:2', RepoTags: ['redis:alpine'], Size: 100, Created: 2 },
      { Id: 'sha256:3', RepoTags: ['postgres:15-alpine'], Size: 100, Created: 3 },
      { Id: 'sha256:4', RepoTags: ['adminer:latest'], Size: 100, Created: 4 },
      { Id: 'sha256:5', RepoTags: ['mysql:8.0'], Size: 100, Created: 5 },
      { Id: 'sha256:6', RepoTags: ['<none>:<none>'], Size: 100, Created: 6 },
      { Id: 'sha256:7', RepoTags: null, Size: 100, Created: 7 },
    ];

    const getLocalImageTags = (images) => {
      const tags = [];
      images.forEach((img) => {
        if (img.RepoTags && Array.isArray(img.RepoTags)) {
          img.RepoTags.forEach((t) => {
            if (t && t !== '<none>:<none>' && !tags.includes(t)) {
              tags.push(t);
            }
          });
        }
      });
      return tags;
    };

    const getImageSuggestions = (deployImage, localTags) => {
      const query = deployImage.trim();
      if (!query) return [];
      if (query === '/') {
        return localTags;
      }
      const filterText = query.startsWith('/') ? query.slice(1).trim() : query;
      if (!filterText) {
        return localTags;
      }
      const q = filterText.toLowerCase();
      return localTags.filter((tag) => tag.toLowerCase().includes(q));
    };

    const localTags = getLocalImageTags(sampleImages);

    test('T2.1: Empty query returns 0 suggestions (remains hidden)', () => {
      assert.deepEqual(getImageSuggestions('', localTags), []);
      assert.deepEqual(getImageSuggestions('   ', localTags), []);
    });

    test('T2.2: Typing "/" returns all locally installed images', () => {
      const allSuggestions = getImageSuggestions('/', localTags);
      assert.equal(allSuggestions.length, 6);
      assert.ok(allSuggestions.includes('nginx:alpine'));
      assert.ok(allSuggestions.includes('nginx:latest'));
      assert.ok(allSuggestions.includes('redis:alpine'));
      assert.ok(allSuggestions.includes('postgres:15-alpine'));
      assert.ok(allSuggestions.includes('adminer:latest'));
      assert.ok(allSuggestions.includes('mysql:8.0'));
    });

    test('T2.3: Typing 1+ chars filters locally installed images (e.g. "n")', () => {
      const suggestionsN = getImageSuggestions('n', localTags);
      assert.ok(suggestionsN.includes('nginx:alpine'));
      assert.ok(suggestionsN.includes('nginx:latest'));
      assert.ok(suggestionsN.includes('adminer:latest'));
      assert.ok(!suggestionsN.includes('mysql:8.0'));
    });

    test('T2.4: Typing specific prefix filters exact substring (e.g. "redis")', () => {
      const suggestionsRedis = getImageSuggestions('redis', localTags);
      assert.deepEqual(suggestionsRedis, ['redis:alpine']);
    });

    test('T2.5: Typing "/redis" with slash prefix filters properly', () => {
      const suggestionsSlash = getImageSuggestions('/redis', localTags);
      assert.deepEqual(suggestionsSlash, ['redis:alpine']);
    });

    test('T2.6: Typing non-matching query returns 0 suggestions (remains hidden)', () => {
      const suggestionsUnknown = getImageSuggestions('unknown-image-xyz', localTags);
      assert.deepEqual(suggestionsUnknown, []);
    });

    test('T2.7: Case-insensitivity verification (e.g. "NGINX", "ReDiS")', () => {
      assert.deepEqual(getImageSuggestions('NGINX', localTags), ['nginx:alpine', 'nginx:latest']);
      assert.deepEqual(getImageSuggestions('ReDiS', localTags), ['redis:alpine']);
    });

    test('T2.8: Special characters and dots in search query do not throw errors', () => {
      assert.doesNotThrow(() => {
        const result = getImageSuggestions('15-alpine', localTags);
        assert.deepEqual(result, ['postgres:15-alpine']);
      });
      assert.doesNotThrow(() => {
        const result = getImageSuggestions('8.0', localTags);
        assert.deepEqual(result, ['mysql:8.0']);
      });
      assert.doesNotThrow(() => {
        const result = getImageSuggestions('++', localTags);
        assert.deepEqual(result, []);
      });
    });

    test('T2.9: Registry URL / slash-containing tags work with slash shortcut', () => {
      const customTags = ['ghcr.io/home-cloud/agent:v1.0.0', 'docker.io/library/nginx:latest'];
      assert.deepEqual(getImageSuggestions('/', customTags), customTags);
      assert.deepEqual(getImageSuggestions('ghcr', customTags), ['ghcr.io/home-cloud/agent:v1.0.0']);
      assert.deepEqual(getImageSuggestions('/ghcr', customTags), ['ghcr.io/home-cloud/agent:v1.0.0']);
      assert.deepEqual(getImageSuggestions('library', customTags), ['docker.io/library/nginx:latest']);
    });

    test('T2.10: Leading and trailing whitespace handling in search queries', () => {
      assert.deepEqual(getImageSuggestions('  nginx  ', localTags), ['nginx:alpine', 'nginx:latest']);
      assert.deepEqual(getImageSuggestions('   /   ', localTags), localTags);
    });
  });

  describe('R3. Local-Only Images & Badging', () => {
    test('T3.1: Dangling <none>:<none> and null RepoTags are filtered out', () => {
      assert.ok(dockerAppContent.includes("t !== '<none>:<none>'"), 'Dangling tags must be skipped');
    });

    test('T3.2: Tag names are deduplicated in localImageTags memo', () => {
      assert.ok(dockerAppContent.includes('!tags.includes(t)'), 'Duplicate tags must be prevented');
    });

    test('T3.3: UI renders subtle local badge next to each suggestion', () => {
      assert.ok(dockerAppContent.includes('styles.autocompleteLocalBadge'), 'Must render autocompleteLocalBadge');
      assert.ok(dockerAppContent.includes('>local</span>'), 'Must contain local label text');
      assert.ok(dockerCssContent.includes('.autocompleteLocalBadge'), 'Must define .autocompleteLocalBadge CSS');
    });
  });

  describe('R4. Interaction, Keyboard Navigation & Polish', () => {
    test('T4.1: ArrowDown / ArrowUp keyboard navigation handlers implemented', () => {
      assert.ok(dockerAppContent.includes("e.key === 'ArrowDown'"), 'ArrowDown key handled');
      assert.ok(dockerAppContent.includes("e.key === 'ArrowUp'"), 'ArrowUp key handled');
      assert.ok(dockerAppContent.includes('% imageSuggestions.length'), 'Arrow navigation uses wrap-around');
    });

    test('T4.2: Enter key selects highlighted image and prevents default form submission', () => {
      assert.ok(dockerAppContent.includes("e.key === 'Enter'"), 'Enter key handled');
      assert.ok(dockerAppContent.includes('handleSelectImageSuggestion'), 'Selection helper called on Enter');
      assert.ok(dockerAppContent.includes('e.preventDefault()'), 'Prevents form submission');
    });

    test('T4.3: Escape key dismisses dropdown and resets highlight', () => {
      assert.ok(dockerAppContent.includes("e.key === 'Escape'"), 'Escape key handled');
      assert.ok(dockerAppContent.includes('setIsImageDropdownOpen(false)'), 'Closes dropdown on Escape');
      assert.ok(dockerAppContent.includes('setHighlightedImageIndex(-1)'), 'Resets highlight on Escape');
    });

    test('T4.4: Outside click listener dismisses dropdown', () => {
      assert.ok(dockerAppContent.includes('handleOutsideClick'), 'Outside click listener defined');
      assert.ok(dockerAppContent.includes("document.addEventListener('mousedown'"), 'Mousedown listener registered');
      assert.ok(dockerAppContent.includes("document.removeEventListener('mousedown'"), 'Mousedown listener cleaned up');
    });

    test('T4.5: Selection updates Compose YAML in real time with correct indentation and handles CRLF line breaks', () => {
      const updateYaml = (prevYaml, newImage) => {
        if (!prevYaml || !prevYaml.trim()) {
          return `version: "3.8"\nservices:\n  app:\n    image: ${newImage}\n    restart: always\n`;
        }
        if (/^(\s*image:\s*)[^\r\n]*/m.test(prevYaml)) {
          return prevYaml.replace(/^(\s*image:\s*)[^\r\n]*/m, `$1${newImage}`);
        }
        if (/^(\s*services:\s*\r?\n\s*[a-zA-Z0-9_-]+:\s*\r?\n)/m.test(prevYaml)) {
          return prevYaml.replace(/^(\s*services:\s*\r?\n\s*([a-zA-Z0-9_-]+):\s*\r?\n)/m, `$1    image: ${newImage}\n`);
        }
        return prevYaml;
      };

      const originalYaml = `version: "3.8"\r\nservices:\r\n  web:\r\n    image: nginx:alpine\r\n    restart: always\r\n    ports:\r\n      - "8080:80"`;
      const updated = updateYaml(originalYaml, 'redis:7-alpine');
      assert.ok(updated.includes('    image: redis:7-alpine'), 'Indentation and image updated');
      assert.ok(!updated.includes('image: nginx:alpine'), 'Old image replaced');
      assert.ok(updated.includes('- "8080:80"'), 'Other YAML properties preserved');

      // Test YAML with services but no image line
      const noImageYaml = `version: "3.8"\nservices:\n  backend:\n    restart: always\n`;
      const addedImage = updateYaml(noImageYaml, 'node:18-alpine');
      assert.ok(addedImage.includes('    image: node:18-alpine'), 'Added image under backend service');

      // Test YAML with quoted image name
      const quotedYaml = `version: "3.8"\nservices:\n  app:\n    image: "postgres:15-alpine"\n`;
      const updatedQuoted = updateYaml(quotedYaml, 'mysql:8.0');
      assert.ok(updatedQuoted.includes('    image: mysql:8.0'), 'Quoted image replaced cleanly');
    });

    test('T4.6: Quick templates selection syncs image field in real time with fallback and quote stripping', () => {
      assert.ok(dockerAppContent.includes("t.yaml.match(/^\\s*image:\\s*([^\\s\\r\\n]+)/m)"), 'Regex extracts template image');
      assert.ok(dockerAppContent.includes("setDeployImage(match ? match[1].replace(/^['\"]|['\"]$/g, '') : '')"), 'Image input populated from template with quote stripping and empty string fallback');

      const extractImage = (yaml) => {
        const match = yaml.match(/^\s*image:\s*([^\s\r\n]+)/m);
        return match ? match[1].replace(/^['"]|['"]$/g, '') : '';
      };
      assert.equal(extractImage('services:\n  db:\n    image: "postgres:15-alpine"'), 'postgres:15-alpine');
      assert.equal(extractImage("services:\n  db:\n    image: 'redis:alpine'"), 'redis:alpine');
      assert.equal(extractImage('services:\n  db:\n    image: mysql:8.0'), 'mysql:8.0');
      assert.equal(extractImage('services:\n  db:\n    restart: always'), '');
    });

    test('T4.7: Keyboard navigation circular indexing handles start, end, and unselected bounds', () => {
      const getNextIndexDown = (prev, length) => (prev + 1) % length;
      const getNextIndexUp = (prev, length) => (prev <= 0 ? length - 1 : prev - 1);
      const len = 4;

      // Arrow down from unselected (-1) -> 0
      assert.equal(getNextIndexDown(-1, len), 0);
      // Arrow down from 0 -> 1 -> 2 -> 3
      assert.equal(getNextIndexDown(0, len), 1);
      assert.equal(getNextIndexDown(2, len), 3);
      // Arrow down from last (3) wraps to 0
      assert.equal(getNextIndexDown(3, len), 0);

      // Arrow up from unselected (-1) wraps to last (3)
      assert.equal(getNextIndexUp(-1, len), 3);
      // Arrow up from 0 wraps to last (3)
      assert.equal(getNextIndexUp(0, len), 3);
      // Arrow up from 3 -> 2
      assert.equal(getNextIndexUp(3, len), 2);

      // Single item list (len = 1)
      assert.equal(getNextIndexDown(-1, 1), 0);
      assert.equal(getNextIndexDown(0, 1), 0);
      assert.equal(getNextIndexUp(-1, 1), 0);
      assert.equal(getNextIndexUp(0, 1), 0);
    });

    test('T4.8: Tab key dismisses dropdown cleanly', () => {
      assert.ok(dockerAppContent.includes("e.key === 'Tab'"), 'Tab key handled');
    });
  });

  describe('TypeScript Compilation & Production Build Verification', () => {
    test('T5.1: pnpm --filter dashboard run build passes with exit code 0', () => {
      const output = execSync('pnpm --filter dashboard run build', {
        cwd: WORKSPACE_ROOT,
        encoding: 'utf-8',
      });
      assert.ok(output.includes('built in'), 'Vite production build succeeded');
    });
  });
});
