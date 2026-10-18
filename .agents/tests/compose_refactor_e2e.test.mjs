import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createRequire } from 'node:module';

const WORKSPACE_ROOT = '/home/rudra-unix/orca/workspaces/home_cloud/siren';
const agentRequire = createRequire(path.join(WORKSPACE_ROOT, 'agent/index.js'));
const express = agentRequire('express');
const composeRouter = agentRequire('./routes/compose.js');
const DOCKER_APP_PATH = path.join(WORKSPACE_ROOT, 'dashboard/src/components/apps/DockerApp.tsx');
const DOCKER_CSS_PATH = path.join(WORKSPACE_ROOT, 'dashboard/src/components/apps/docker.module.css');

describe('Compose End-to-End Refactor Verification Suite', () => {

  describe('1. Security & Path Resolution', () => {
    test('1.1: isSafeProjectName accepts valid names', () => {
      assert.equal(composeRouter.isSafeProjectName('wordpress'), true);
      assert.equal(composeRouter.isSafeProjectName('my-app'), true);
      assert.equal(composeRouter.isSafeProjectName('nextcloud_db'), true);
      assert.equal(composeRouter.isSafeProjectName('service.v2'), true);
    });

    test('1.2: isSafeProjectName rejects directory traversal and unsafe characters', () => {
      assert.equal(composeRouter.isSafeProjectName('../etc'), false);
      assert.equal(composeRouter.isSafeProjectName('..'), false);
      assert.equal(composeRouter.isSafeProjectName('/root'), false);
      assert.equal(composeRouter.isSafeProjectName('app; rm -rf'), false);
      assert.equal(composeRouter.isSafeProjectName(''), false);
      assert.equal(composeRouter.isSafeProjectName(null), false);
      assert.equal(composeRouter.isSafeProjectName(undefined), false);
    });

    test('1.3: resolveComposeFolder confines projects strictly to COMPOSE_DIR', () => {
      const resolved = composeRouter.resolveComposeFolder('my-web-app');
      assert.ok(resolved.startsWith(composeRouter.COMPOSE_DIR));
      assert.equal(path.basename(resolved), 'my-web-app');

      assert.equal(composeRouter.resolveComposeFolder('../../../etc/passwd'), null);
      assert.equal(composeRouter.resolveComposeFolder('..'), null);
      assert.equal(composeRouter.resolveComposeFolder('.'), null);
    });
  });

  describe('2. Multi-Filename Compose Support (v2 Spec)', () => {
    const tempTestDir = path.join(os.tmpdir(), `compose-test-${Date.now()}`);

    before(() => {
      fs.mkdirSync(tempTestDir, { recursive: true });
    });

    after(() => {
      try {
        fs.rmSync(tempTestDir, { recursive: true, force: true });
      } catch {}
    });

    test('2.1: findComposeFile detects docker-compose.yml', () => {
      const folder = path.join(tempTestDir, 'proj1');
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(folder, 'docker-compose.yml'), 'services:\n  app:\n    image: nginx');
      assert.equal(composeRouter.findComposeFile(folder), path.join(folder, 'docker-compose.yml'));
    });

    test('2.2: findComposeFile detects compose.yaml (Docker Compose v2 standard)', () => {
      const folder = path.join(tempTestDir, 'proj2');
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(folder, 'compose.yaml'), 'services:\n  redis:\n    image: redis');
      assert.equal(composeRouter.findComposeFile(folder), path.join(folder, 'compose.yaml'));
    });

    test('2.3: findComposeFile detects compose.yml and docker-compose.yaml', () => {
      const folder = path.join(tempTestDir, 'proj3');
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(folder, 'compose.yml'), 'services:\n  db:\n    image: postgres');
      assert.equal(composeRouter.findComposeFile(folder), path.join(folder, 'compose.yml'));
    });

    test('2.4: getComposeFilePath defaults to docker-compose.yml for new deployments', () => {
      const emptyFolder = path.join(tempTestDir, 'proj-empty');
      fs.mkdirSync(emptyFolder, { recursive: true });
      assert.equal(composeRouter.getComposeFilePath(emptyFolder), path.join(emptyFolder, 'docker-compose.yml'));
    });
  });

  describe('3. HTTP Route Contract & Dual Mount (/compose + /stacks alias)', () => {
    let app;
    let server;
    let baseUrl;

    before(async () => {
      app = express();
      app.use(express.json());
      app.use('/api/docker/compose', composeRouter);
      app.use('/api/docker/stacks', composeRouter);

      server = http.createServer(app);
      await new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const port = server.address().port;
          baseUrl = `http://127.0.0.1:${port}`;
          resolve();
        });
      });
    });

    after(async () => {
      await new Promise((resolve) => server.close(resolve));
    });

    test('3.1: GET /api/docker/compose returns backward-compatible object { compose, projects, stacks }', async () => {
      const res = await fetch(`${baseUrl}/api/docker/compose`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data.compose), 'data.compose must be an array');
      assert.ok(Array.isArray(data.projects), 'data.projects must be an array');
      assert.ok(Array.isArray(data.stacks), 'data.stacks must be an array for legacy clients');
      assert.deepEqual(data.compose, data.projects);
      assert.deepEqual(data.compose, data.stacks);
    });

    test('3.2: GET /api/docker/stacks alias returns identical payload for existing clients', async () => {
      const res = await fetch(`${baseUrl}/api/docker/stacks`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data.compose));
      assert.ok(Array.isArray(data.stacks));
    });

    test('3.3: GET /api/docker/compose/:name returns 404 with clear message for nonexistent project', async () => {
      const res = await fetch(`${baseUrl}/api/docker/compose/nonexistent-project-xyz`);
      assert.equal(res.status, 404);
      const data = await res.json();
      assert.ok(data.error.includes('not found'));
    });

    test('3.4: GET /api/docker/compose/:name returns 400 for unsafe traversal name', async () => {
      const res = await fetch(`${baseUrl}/api/docker/compose/..%2F..%2Fetc`);
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.ok(data.error.includes('Invalid compose project name'));
    });

    test('3.5: POST /api/docker/compose/deploy validates required name and yaml body', async () => {
      const res = await fetch(`${baseUrl}/api/docker/compose/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.ok(data.error.includes('required'));
    });

    test('3.6: POST /api/docker/compose/:name/deploy route alias works with param name', async () => {
      const res = await fetch(`${baseUrl}/api/docker/compose/test-proj/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yaml: '' }), // missing yaml
      });
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.ok(data.error.includes('required'));
    });

    test('3.7: GET /api/docker/compose/:name/logs establishes SSE stream even if compose file is not on disk', async () => {
      const controller = new AbortController();
      const res = await fetch(`${baseUrl}/api/docker/compose/discovered-project/logs`, {
        signal: controller.signal,
      });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'text/event-stream');
      controller.abort();
    });
  });

  describe('4. Frontend Codebase Alignment (DockerApp.tsx & docker.module.css)', () => {
    const appContent = fs.readFileSync(DOCKER_APP_PATH, 'utf-8');
    const cssContent = fs.readFileSync(DOCKER_CSS_PATH, 'utf-8');

    test('4.1: activeWindowTab includes compose and default tab setup', () => {
      assert.ok(appContent.includes("activeWindowTab === 'compose'"));
      assert.ok(appContent.includes("setActiveWindowTab('compose')"));
    });

    test('4.2: Tab navigation displays "Compose"', () => {
      assert.ok(appContent.includes('<span>Compose</span>'));
    });

    test('4.3: Endpoints fetch from /api/docker/compose', () => {
      assert.ok(appContent.includes("fetch('/api/docker/compose')"));
      assert.ok(appContent.includes("fetch(`/api/docker/compose/${name}/start`"));
      assert.ok(appContent.includes("fetch(`/api/docker/compose/${name}/stop`"));
      assert.ok(appContent.includes("fetch(`/api/docker/compose/${name}`"));
      assert.ok(appContent.includes("fetch('/api/docker/compose/deploy'"));
      assert.ok(appContent.includes("EventSource(`/api/docker/compose/${selectedComposeLogsName}/logs`)"));
    });

    test('4.4: UI copy updated to Compose Project', () => {
      assert.ok(appContent.includes('Deploy Compose Project'));
      assert.ok(appContent.includes('Search compose projects by name…'));
      assert.ok(appContent.includes('active compose projects'));
      assert.ok(appContent.includes('Remove Compose Project'));
      assert.ok(appContent.includes('Compose Logs — '));
    });

    test('4.5: CSS defines compose selectors alongside legacy aliases', () => {
      assert.ok(cssContent.includes('.composeContainer'));
      assert.ok(cssContent.includes('.composeGrid'));
      assert.ok(cssContent.includes('.composeCard'));
      assert.ok(cssContent.includes('.composeTitle'));
      assert.ok(cssContent.includes('.composeStatusBadge'));
      assert.ok(cssContent.includes('.composeActionBtn'));
      assert.ok(cssContent.includes('.composeServicesList'));
    });

    test('4.6: Backward compatibility TypeScript interfaces are exported', () => {
      assert.ok(appContent.includes('export interface ComposeContainer'));
      assert.ok(appContent.includes('export type StackContainer = ComposeContainer;'));
      assert.ok(appContent.includes('export interface ComposeProject'));
      assert.ok(appContent.includes('export type Stack = ComposeProject;'));
    });
  });
});
