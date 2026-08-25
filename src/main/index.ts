import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import * as cp from 'child_process'
import { loadSettings, saveSettings } from './settings'
import { detectBackend, importBackendFromZip, runCliHelp, getBackendBin, runServerHealth, fetchGithubReleases, downloadBackendFromUrl } from './backend'
import { scanInstalled, deleteModel, getModelPath, getModelsDir } from './models'
import { startServer, stopServer, isServerRunning, getServerPid } from './server'

let win: BrowserWindow | null = null
let settings = loadSettings()

function createWindow() {
  win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 1020,
    minHeight: 680,
    backgroundColor: '#0f1115',
    title: 'audio.cpp Studio',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    autoHideMenuBar: true,
  })

  const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production'
  if (isDev) {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
    win.webContents.openDevTools({ mode: 'detach' })
  }
  win.webContents.on('did-fail-load', (_e, code, desc, url) => console.error('did-fail-load', code, desc, url))
  win.webContents.on('console-message', (_e, level, msg) => console.log('renderer console:', msg))
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
app.on('before-quit', async () => { await stopServer() })

// ---- IPC ----
ipcMain.handle('settings:get', () => settings)
ipcMain.handle('settings:save', (_e, s) => {
  settings = { ...settings, ...s }
  saveSettings(settings)
  return settings
})
ipcMain.handle('dialog:chooseFolder', async () => {
  const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] })
  if (r.canceled || !r.filePaths[0]) return null
  return r.filePaths[0]
})
ipcMain.handle('dialog:chooseFile', async (_e, filters) => {
  const r = await dialog.showOpenDialog(win!, { properties:['openFile'], filters })
  if (r.canceled || !r.filePaths[0]) return null
  return r.filePaths[0]
})
ipcMain.handle('shell:openFolder', async (_e, p:string) => {
  if (fs.existsSync(p)) await shell.openPath(p)
})

ipcMain.handle('backend:info', async () => {
  return detectBackend(settings.backendPath)
})
ipcMain.handle('backend:importZip', async (_e, zipPath:string) => {
  const res = await importBackendFromZip(zipPath, settings.dataRoot)
  settings.backendPath = res.backendPath
  settings.backendVersion = res.version
  saveSettings(settings)
  return { ...res, info: detectBackend(settings.backendPath) }
})
ipcMain.handle('backend:cliHelp', async () => {
  if (!settings.backendPath) throw new Error('No backend configured')
  return await runCliHelp(settings.backendPath)
})
ipcMain.handle('backend:health', async () => {
  return await runServerHealth(settings.serverHost, settings.serverPort)
})
ipcMain.handle('backend:listReleases', async ()=> {
  return await fetchGithubReleases(10)
})
ipcMain.handle('backend:downloadRelease', async (e, url:string)=>{
  const onProg = (pct:number, dl:number, total:number)=>{ try{ e.sender.send('backend:downloadProgress', {url, pct, dl, total})}catch{} }
  const r = await downloadBackendFromUrl(url, settings.dataRoot, onProg)
  settings.backendPath = r.backendPath
  settings.backendVersion = r.version
  saveSettings(settings)
  e.sender.send('backend:downloadProgress', {url, pct:100, done:true, version:r.version})
  return { ...r, info: detectBackend(settings.backendPath) }
})

ipcMain.handle('models:list', async () => scanInstalled(settings.dataRoot))
ipcMain.handle('models:delete', async (_e, id:string) => {
  deleteModel(settings.dataRoot, id)
  return scanInstalled(settings.dataRoot)
})
ipcMain.handle('models:download', async (e, id:string, url?:string) => {
  // Placeholder: create folder and simulate progress. Real download would use hf URL.
  const dir = getModelPath(settings.dataRoot, id)
  fs.mkdirSync(dir,{recursive:true})
  // If url provided attempt real download of single file
  if (url) {
    const { downloadFile } = await import('./models')
    const dest = path.join(dir, path.basename(new URL(url).pathname) || 'model.gguf')
    let last = 0
    const onProg = (pct:number, dl:number, total:number) => {
      if (pct!==last){ last=pct; e.sender.send('models:downloadProgress', { id, pct, dl, total, file: dest }) }
    }
    try{
      await downloadFile(url, dest, onProg)
      e.sender.send('models:downloadProgress', { id, pct:100, done:true })
    }catch(err:any){
      e.sender.send('models:downloadProgress', { id, error: err.message })
      throw err
    }
    return scanInstalled(settings.dataRoot)
  }
  // Demo mode: simulate download
  for (let pct=0; pct<=100; pct+=10){
    await new Promise(r=> setTimeout(r,120))
    e.sender.send('models:downloadProgress', { id, pct })
  }
  // create dummy placeholder so UI shows installed
  fs.writeFileSync(path.join(dir,'.placeholder'),'download simulated - replace with real gguf')
  e.sender.send('models:downloadProgress', { id, pct:100, done:true })
  return scanInstalled(settings.dataRoot)
})

ipcMain.handle('server:start', async (_e, models:any[]) => {
  if (!settings.backendPath) throw new Error('No backend')
  const pid = await startServer(settings.backendPath, settings.serverHost, settings.serverPort, models)
  return { pid, running: isServerRunning() }
})
ipcMain.handle('server:stop', async ()=> { await stopServer(); return { running:isServerRunning()} })
ipcMain.handle('server:status', async ()=> ({ running:isServerRunning(), pid:getServerPid(), host:settings.serverHost, port:settings.serverPort }))

// Generation via CLI (fallback) — spawns audiocpp_cli
async function runCli(args:string[], timeout=120000): Promise<{out:string, err:string, code:number|null}>{
  const bin = settings.backendPath ? getBackendBin(settings.backendPath,'cli') : null
  if (!bin) throw new Error('Backend CLI not found — import a backend zip in Settings')
  return await new Promise((resolve,reject)=>{
    const p = cp.spawn(bin!, args, { cwd: settings.dataRoot })
    let out='', err=''
    p.stdout?.on('data', d=> out+=d.toString())
    p.stderr?.on('data', d=> err+=d.toString())
    const t = setTimeout(()=> { p.kill(); reject(new Error('CLI timeout')) }, timeout)
    p.on('close', code=> { clearTimeout(t); resolve({out,err,code}) })
    p.on('error', reject)
  })
}

ipcMain.handle('gen:tts', async (_e, opts:any) => {
  // opts: { modelId, text, voiceRef?, voiceId?, language?, outFile? }
  const modelsDir = getModelsDir(settings.dataRoot)
  const modelPath = path.join(modelsDir, opts.modelId)
  if (!fs.existsSync(modelPath)) throw new Error('Model not installed: '+opts.modelId)
  const outDir = path.join(settings.dataRoot,'outputs')
  fs.mkdirSync(outDir,{recursive:true})
  const outFile = opts.outFile || path.join(outDir, `tts_${Date.now()}.wav`)
  // try server first if running
  if (isServerRunning()){
    try{
      const res = await fetch(`http://${settings.serverHost}:${settings.serverPort}/v1/audio/speech`,{
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ model: opts.modelId, input: opts.text, voice: opts.voiceId || undefined })
      })
      if (res.ok){
        const buf = Buffer.from(await res.arrayBuffer())
        fs.writeFileSync(outFile, buf)
        return { outFile, via:'server', status:res.status }
      }
    }catch{}
  }
  // fallback CLI — if binary missing we fake success for demo
  const bin = settings.backendPath ? getBackendBin(settings.backendPath,'cli') : null
  if (!bin){
    // demo: write a 1sec silent wav placeholder? For now create empty file
    fs.writeFileSync(outFile+'.txt', `DEMO TTS output for "${opts.text.slice(0,60)}" model=${opts.modelId}`)
    return { outFile: outFile+'.txt', via:'demo (no backend)', note:'Install backend to generate real audio' }
  }
  const args = ['--task','tts','--family', opts.family||opts.modelId, '--model', modelPath, '--text', opts.text, '--out', outFile]
  if (opts.voiceRef) args.push('--voice-ref', opts.voiceRef)
  if (opts.voiceId) args.push('--voice-id', opts.voiceId)
  if (opts.language) args.push('--load-option', `language=${opts.language}`)
  const r = await runCli(args)
  if (!fs.existsSync(outFile)) throw new Error('CLI failed: '+r.err.slice(0,500))
  return { outFile, via:'cli', log:r.err.slice(0,800) }
})

ipcMain.handle('gen:music', async (_e, opts:any)=>{
  const modelPath = path.join(getModelsDir(settings.dataRoot), opts.modelId)
  if (!fs.existsSync(modelPath)) throw new Error('Model not installed')
  const outDir = path.join(settings.dataRoot,'outputs')
  fs.mkdirSync(outDir,{recursive:true})
  const outFile = path.join(outDir, `music_${Date.now()}.wav`)
  const bin = settings.backendPath ? getBackendBin(settings.backendPath,'cli') : null
  if (!bin){
    fs.writeFileSync(outFile+'.txt', `DEMO MUSIC prompt="${opts.prompt}" lyrics="${(opts.lyrics||'').slice(0,80)}"`)
    return { outFile: outFile+'.txt', via:'demo' }
  }
  const args = ['--task','gen','--family', opts.family||opts.modelId, '--model', modelPath, '--text', opts.prompt, '--out', outFile]
  if (opts.lyrics) args.push('--request-option', `lyrics=${opts.lyrics}`)
  if (opts.duration) args.push('--request-option', `duration=${opts.duration}`)
  const r = await runCli(args, 300000)
  if (!fs.existsSync(outFile)) throw new Error('CLI failed: '+r.err.slice(0,500))
  return { outFile, via:'cli', log:r.err.slice(0,800) }
})

ipcMain.handle('gen:asr', async (_e, opts:any)=>{
  const modelPath = path.join(getModelsDir(settings.dataRoot), opts.modelId)
  if (!fs.existsSync(modelPath)) throw new Error('Model not installed')
  if (!opts.audioPath || !fs.existsSync(opts.audioPath)) throw new Error('Audio file not found')
  if (isServerRunning()){
    try{
      const fd = new FormData()
      // @ts-ignore node 18 form-data needs Blob
      const buf = fs.readFileSync(opts.audioPath)
      fd.append('file', new Blob([buf]), path.basename(opts.audioPath))
      fd.append('model', opts.modelId)
      const res = await fetch(`http://${settings.serverHost}:${settings.serverPort}/v1/audio/transcriptions`,{ method:'POST', body: fd as any })
      if (res.ok){
        const j:any = await res.json()
        return { text: j.text || j.transcript || JSON.stringify(j), via:'server' }
      }
    }catch{}
  }
  const bin = settings.backendPath ? getBackendBin(settings.backendPath,'cli') : null
  if (!bin){
    return { text: `[DEMO] Transcription of ${path.basename(opts.audioPath)} — install backend for real ASR.`, via:'demo' }
  }
  const args = ['--task','asr','--family', opts.family||opts.modelId, '--model', modelPath, '--audio', opts.audioPath]
  const r = await runCli(args)
  return { text: (r.out||r.err).slice(0,4000) || ' (no output)', via:'cli' }
})

ipcMain.handle('outputs:list', async ()=>{
  const outDir = path.join(settings.dataRoot,'outputs')
  if (!fs.existsSync(outDir)) return []
  return fs.readdirSync(outDir).map(f=>{
    const p = path.join(outDir,f)
    const s = fs.statSync(p)
    return { name:f, path:p, size:s.size, mtime:s.mtimeMs }
  }).sort((a,b)=> b.mtime-a.mtime).slice(0,100)
})
ipcMain.handle('outputs:reveal', async (_e, file:string)=>{
  if (fs.existsSync(file)) shell.showItemInFolder(file)
})
