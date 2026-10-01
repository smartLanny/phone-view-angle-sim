// 截图 / 调试：启动 Vite，开无头 Chromium（软件 WebGL），按任务逐个打开页面、等就绪、截图或读调试数据。
// 用法: node tools/shot.mjs jobs.json
//   jobs: [{ "url": "?style=a", "out": "shots/a.png", "w": 1600, "h": 900, "dpr": 1, "eval": "JSON 表达式(可选)" }]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const jobs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const exe = process.env.CHROME || path.join(os.homedir(), '.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell');
const server = await createServer({ logLevel: 'error', server: { port: 5199 } });
await server.listen();
const base = 'http://127.0.0.1:5199/';
const browser = await chromium.launch({
  executablePath: exe,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
try {
  for (const j of jobs) {
    const page = await browser.newPage({ viewport: { width: j.w || 1600, height: j.h || 900 }, deviceScaleFactor: j.dpr || 1 });
    const logs = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
    await page.goto(base + (j.url || ''), { waitUntil: 'load' });
    await page.waitForFunction(() => (window).__ready === true, null, { timeout: 120000 });
    if (j.eval) {
      const v = await page.evaluate(j.eval);
      if (j.evalOut) fs.writeFileSync(j.evalOut, typeof v === 'string' ? v : JSON.stringify(v, null, 1));
      else console.log(typeof v === 'string' ? v : JSON.stringify(v));
    }
    if (j.out) {
      fs.mkdirSync(path.dirname(j.out), { recursive: true });
      await page.screenshot({ path: j.out });
      console.log('shot', j.out);
    }
    if (logs.length) console.log(logs.join('\n'));
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
