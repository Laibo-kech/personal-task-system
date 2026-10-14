import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';

test('独立部署的登录、任务、日程、SOP、文档与排除模块', { timeout: 60000 }, async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'task-community-test-'));
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const password = crypto.randomBytes(24).toString('hex');
  const database = path.join(temporary, 'test.sqlite');
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(), windowsHide: true,
    env: { ...process.env, ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: password, HOST: '127.0.0.1', PORT: String(port), DATABASE_PATH: database },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', data => { logs += data; });
  child.stderr.on('data', data => { logs += data; });
  const base = `http://127.0.0.1:${port}`;
  let cookie = '';
  const request = async (url, method = 'GET', body, expected = 200, authenticated = true) => {
    const response = await fetch(base + url, {
      method, headers: { 'Content-Type': 'application/json', ...(authenticated && cookie ? { Cookie: cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    assert.equal(response.status, expected, `${method} ${url}: ${JSON.stringify(data)}`);
    return { data, response };
  };
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error(`启动失败: ${logs}`);
      try { ready = (await fetch(base + '/api/health')).ok; } catch {}
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, logs);
    await t.test('需要登录，不存在匿名任务写入口', async () => {
      await request('/api/tasks', 'GET', undefined, 401, false);
      await request('/api/external/tasks/life', 'POST', { task: '不可写入' }, 401, false);
      const login = await request('/api/auth/login', 'POST', { username: 'admin', password });
      cookie = login.response.headers.get('set-cookie').split(';')[0];
    });
    const { data: meta } = await request('/api/meta');
    const listId = meta.lists[0].id;
    let taskId;
    await t.test('空白数据与基础页面接口', async () => {
      assert.equal((await request('/api/tasks')).data.total, 0);
      for (const url of ['/api/stats', '/api/logs', '/api/projects', '/api/tags', '/api/rules', '/api/table-settings', '/api/filter-templates', '/api/sop/meta', '/api/sop/themes', '/api/sop/events', '/api/sop/executions', '/api/sop/future-occurrences', '/api/sop/view-settings', '/api/sop/calendar', '/api/sop/stats', '/api/sop/settings', '/api/calendar/settings', '/api/calendar/series', '/api/calendar/unscheduled-tasks', '/api/documents/overview', '/api/documents/tree', '/api/analytics/overview']) await request(url);
    });
    await t.test('任务新建、编辑、完成和日志回读', async () => {
      const { data: created } = await request('/api/tasks', 'POST', { title: '测试任务', listId }, 201);
      taskId = created.id;
      assert.ok(taskId);
      await request(`/api/tasks/${taskId}`, 'PATCH', { title: '测试任务已编辑', dueAt: '2030-01-15', duePrecision: 'date' });
      let task = (await request(`/api/tasks/${taskId}`)).data;
      assert.equal(task.title, '测试任务已编辑');
      await request(`/api/tasks/${taskId}`, 'PATCH', { status: '已完成' });
      task = (await request(`/api/tasks/${taskId}`)).data;
      assert.equal(task.status, '已完成');
      assert.ok(task.completedAt);
      const store = new DatabaseSync(database, { readOnly: true });
      try { assert.ok(store.prepare('SELECT count(*) AS n FROM task_logs WHERE task_id = ?').get(taskId).n >= 3); }
      finally { store.close(); }
    });
    await t.test('日程和任务共用时间，转换不会重复', async () => {
      const items = (await request('/api/calendar/items?start=2030-01-01&end=2030-02-01&from=2030-01-01&to=2030-02-01')).data;
      assert.ok(JSON.stringify(items).includes('测试任务已编辑'));
      const { data: event } = await request('/api/calendar/events', 'POST', { title: '测试日程', listId, startAt: '2030-01-15T09:00:00+08:00', endAt: '2030-01-15T10:00:00+08:00' }, 201);
      const converted = await request(`/api/calendar/events/${event.id}/convert-to-task`, 'POST', {}, 201);
      assert.ok(converted.data.taskId || converted.data.id);
    });
    await t.test('SOP主题、事件、触发和完成', async () => {
      const { data: theme } = await request('/api/sop/themes', 'POST', { name: '测试主题', ruleType: 'manual', frequencyLabel: '手动触发' }, 201);
      await request('/api/sop/events', 'POST', { themeId: theme.id, title: '测试事件' }, 201);
      await request(`/api/sop/themes/${theme.id}/trigger`, 'POST', {});
      const executions = (await request('/api/sop/executions')).data;
      const execution = (executions.data || executions.items || executions).find(item => item.title === '测试事件');
      assert.ok(execution);
      await request(`/api/sop/executions/${execution.id}/complete`, 'POST', {});
      const done = (await request(`/api/sop/executions/${execution.id}`)).data;
      assert.equal((done.execution || done).status, 'completed');
    });
    await t.test('文档新建、保存正文和回读', async () => {
      const { data: node } = await request('/api/document-nodes', 'POST', { title: '测试文档', type: 'document', markdown: '# 测试正文' }, 201);
      const document = (await request(`/api/documents/${node.id}`)).data;
      assert.ok(JSON.stringify(document).includes('# 测试正文'));
    });
    await t.test('排除模块无接口、无表、无样本记录', async () => {
      for (const url of ['/api/external/tasks/life','/api/external/tasks/work','/api/mail/topics','/api/node/templates','/api/assistant/settings','/api/integrations/feishu/status','/api/cli/access-requests']) await request(url, 'GET', undefined, 404);
      const store = new DatabaseSync(database, { readOnly: true });
      try {
        const names = store.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name);
        assert.deepEqual(names.filter(name => /^(mail_|node_|assistant_|feishu_|task_base_|okr_|cli_)/.test(name)), []);
        assert.equal(store.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
        assert.deepEqual(store.prepare('PRAGMA foreign_key_check').all(), []);
      } finally { store.close(); }
    });
  } finally {
    if (child.exitCode === null) { const exit = once(child, 'exit'); child.kill(); await exit; }
    assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep + 'task-community-test-'));
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
