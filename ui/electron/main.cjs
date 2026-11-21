const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const RPC_BIN = path.join(PROJECT_ROOT, 'bin', 'RegistrationRpc');

let rpc = null;
let ready = false;
let rpcReadyInfo = null;
let seq = 0;
const pending = new Map();
let buffer = '';

function startRpc() {
  // In development without a built C++ service, run in mock mode (renderer falls back).
  if (!require('node:fs').existsSync(RPC_BIN)) {
    console.warn('[ui] RegistrationRpc not found; renderer will use mock data.');
    return;
  }
  const fixture = process.argv.includes('--fixture');
  const args = ['--root', PROJECT_ROOT];
  if (fixture) args.push('--fixture');
  rpc = spawn(RPC_BIN, args, { cwd: PROJECT_ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
  rpc.stdout.setEncoding('utf8');
  rpc.stdout.on('data', (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (!line.trim()) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.event === 'ready') { ready = true; rpcReadyInfo = msg; continue; }
      const entry = pending.get(msg.id);
      if (entry) { pending.delete(msg.id); entry.resolve(msg); }
    }
  });
  rpc.stderr.on('data', (d) => console.error('[rpc]', d.toString().trim()));
  rpc.on('exit', (code) => {
    ready = false;
    for (const entry of pending.values()) entry.reject(new Error(`RPC service exited (${code})`));
    pending.clear();
  });
}

function rpcCall(op, params) {
  return new Promise((resolve, reject) => {
    if (!rpc || !ready) return reject(new Error('RPC service not ready'));
    const id = String(++seq);
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`RPC timeout for ${op}`));
    }, 30000);
    const entry = {
      resolve: (msg) => { clearTimeout(timer); resolve(msg); },
      reject: (err) => { clearTimeout(timer); reject(err); }
    };
    pending.set(id, entry);
    rpc.stdin.write(JSON.stringify({ id, op, params }) + '\n');
  });
}

ipcMain.handle('rpc:info', () => rpcReadyInfo);
ipcMain.handle('shell:openExternal', async (_event, url) => {
  // Only allow the official registration host over https.
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'www.114yygh.com') return false;
  await shell.openExternal(url);
  return true;
});
ipcMain.handle('file:read', async (_event, rel) => {
  const fs = require('node:fs');
  const full = path.resolve(PROJECT_ROOT, rel);
  if (!full.startsWith(PROJECT_ROOT)) throw new Error('path outside project');
  return fs.readFileSync(full, 'utf8');
});
ipcMain.handle('rpc:call', async (_event, { op, params }) => {
  try { return await rpcCall(op, params || {}); }
  catch (e) { return { ok: false, status: 'failed', failure: 'rpc_error', message: e.message }; }
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1180, height: 820,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false }
  });
  console.log('[ui] argv:', JSON.stringify(process.argv));
  const pageArg = process.argv.find((a) => a.startsWith('--ui-page='));
  const hash = pageArg ? `#${pageArg.slice('--ui-page='.length)}` : '';
  const devUrl = process.env.VITE_DEV_URL;
  if (devUrl) win.loadURL(devUrl + hash);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash: hash.slice(1) });

  const shotArg = process.argv.find((a) => a.startsWith('--shot='));
  if (shotArg) {
    const shotPath = shotArg.slice('--shot='.length);
    win.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        win.webContents.capturePage().then((image) => {
          require('node:fs').writeFileSync(shotPath, image.toPNG());
          console.log('[ui] screenshot saved to', shotPath);
        });
      }, 2500);
    });
  }
}

app.whenReady().then(() => {
  startRpc();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (rpc) rpc.kill();
  if (process.platform !== 'darwin') app.quit();
});
