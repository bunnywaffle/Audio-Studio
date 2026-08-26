import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import * as cp from 'child_process'
import { loadSettings, saveSettings } from './settings'
import { detectBackend, importBackendFromZip, runCliHelp, getBackendBin, runServerHealth, fetchGithubReleases, downloadBackendFromUrl, testBackend, listBackends, selectBackend, deleteBackend } from './backend'
import { scanInstalled, deleteModel, getModelPath, getModelsDir } from './models'
import { startServer, stopServer, isServerRunning, getServerPid, getServerStatus } from './server'

let win: BrowserWindow | null = null
let settings = loadSettings()

function createWindow() {
  win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 1020,
    minHeight: 680,
    backgroundColor: '#050507',
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
  }
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
ipcMain.handle('backend:test', async ()=>{
  if(!settings.backendPath) throw new Error('No backend')
  return await testBackend(settings.backendPath)
})
ipcMain.handle('backend:listVersions', async ()=> listBackends(settings.dataRoot))
ipcMain.handle('backend:selectVersion', async (_e, version:string)=>{
  const r = selectBackend(settings.dataRoot, version)
  settings.backendPath = r.backendPath
  settings.backendVersion = r.version
  saveSettings(settings)
  return { ...r, info: detectBackend(settings.backendPath) }
})
ipcMain.handle('backend:deleteVersion', async (_e, version:string)=>{
  deleteBackend(settings.dataRoot, version)
  return listBackends(settings.dataRoot)
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
ipcMain.handle('models:listAll', async () => {
  const base = scanInstalled(settings.dataRoot)
  try{
    const { fetchAllHfFolders, CURATED_MODELS } = await import('./models')
    const folders = await fetchAllHfFolders()
    const curatedFolders = new Set(CURATED_MODELS.map(m=> m.hfFolder).filter(Boolean))
    const dynamic: any[] = folders.filter(f=> !curatedFolders.has(f.folder)).map(f=>{
      const id = f.folder.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'')
      const label = f.folder.replace(/-GGUF$/,'').replace(/-/g,' ')
      // infer task
      const n = f.folder.toLowerCase()
      let task: any = 'other'
      if(n.includes('tts') || n.includes('voice') || n.includes('vibe') || n.includes('chatter') || n.includes('fish') || n.includes('higgs-tts') || n.includes('index')) task='tts'
      else if(n.includes('asr') || n.includes('whisper') || n.includes('parakeet') || n.includes('nemotron') || n.includes('qwen3-asr') || n.includes('fun-asr') || n.includes('voxtral') || n.includes('hviske') || n.includes('citrinet') || n.includes('sense')) task='asr'
      else if(n.includes('music') || n.includes('step') || n.includes('stable') || n.includes('heartmula') || n.includes('minimax')) task='music'
      else if(n.includes('sep') || n.includes('roformer') || n.includes('demucs')) task='sep'
      return { id, family: id, label, task, description:`HF folder ${f.folder} — from audio.cpp-gguf`, language:'auto', size:'?', runtime:'GGUF', hfFolder:f.folder, installed:false }
    })
    // check installed for dynamic too
    const installedDirs = fs.existsSync(path.join(settings.dataRoot,'models')) ? new Set(fs.readdirSync(path.join(settings.dataRoot,'models'))) : new Set()
    dynamic.forEach((m:any)=>{
      const p = path.join(settings.dataRoot,'models', m.id)
      m.installed = installedDirs.has(m.id) && fs.existsSync(p) && fs.readdirSync(p).length>0
      if(m.installed) m.localPath = p
    })
    // merge, dedup by id
    const all = [...base]
    const baseIds = new Set(base.map(b=> b.id))
    for(const d of dynamic) if(!baseIds.has(d.id)) all.push(d)
    return all
  }catch(e){
    return base
  }
})
ipcMain.handle('models:listHf', async ()=>{
  const { fetchAllHfFolders } = await import('./models')
  return await fetchAllHfFolders()
})
ipcMain.handle('models:delete', async (_e, id:string) => {
  deleteModel(settings.dataRoot, id)
  return scanInstalled(settings.dataRoot)
})
ipcMain.handle('models:download', async (e, id:string, url?:string) => {
  const dir = getModelPath(settings.dataRoot, id)
  fs.mkdirSync(dir,{recursive:true})
  const doDownload = async (dlUrl:string)=>{
    const { downloadFile } = await import('./models')
    const dest = path.join(dir, path.basename(new URL(dlUrl).pathname) || 'model.gguf')
    let last = -1
    const onProg = (pct:number, dl:number, total:number) => {
      if (pct!==last){ last=pct; e.sender.send('models:downloadProgress', { id, pct, dl, total, file: dest }) }
    }
    // also send 0 immediately
    e.sender.send('models:downloadProgress', { id, pct:0 })
    try{
      await downloadFile(dlUrl, dest, onProg)
      e.sender.send('models:downloadProgress', { id, pct:100, done:true, file:dest })
    }catch(err:any){
      e.sender.send('models:downloadProgress', { id, error: err.message })
      throw err
    }
    return scanInstalled(settings.dataRoot)
  }
  if (url) {
    return await doDownload(url)
  }
  // No URL: resolve via HF repo
  try{
    const { resolveHfDownloadUrl } = await import('./models')
    e.sender.send('models:downloadProgress', { id, pct:0, note:'Resolving HF file…' })
    const resolved = await resolveHfDownloadUrl(id)
    // inform UI which file is chosen
    e.sender.send('models:downloadProgress', { id, pct:1, note:`Downloading ${resolved.fileName}…` })
    return await doDownload(resolved.url)
  }catch(err:any){
    e.sender.send('models:downloadProgress', { id, error: err.message })
    throw err
  }
})

ipcMain.handle('server:start', async (_e, models:any[]) => {
  if (!settings.backendPath) throw new Error('No backend — download from GitHub Releases or Import ZIP in Settings')
  await startServer(settings.backendPath, settings.serverHost, settings.serverPort, models)
  return { ...getServerStatus(), host:settings.serverHost, port:settings.serverPort }
})
ipcMain.handle('server:stop', async ()=> { await stopServer(); return { ...getServerStatus(), host:settings.serverHost, port:settings.serverPort } })
ipcMain.handle('server:status', async ()=> ({ ...getServerStatus(), host:settings.serverHost, port:settings.serverPort }))
ipcMain.handle('server:log', async ()=> getServerStatus())

async function ensureAutoServer(){
  if(!settings.autoStartServer) return false
  if(isServerRunning()) return true
  if(!settings.backendPath) return false
  try{
    await startServer(settings.backendPath, settings.serverHost, settings.serverPort, [])
    return isServerRunning()
  }catch(e){ console.log('auto-start failed', e); return false }
}

// Helpers for voice WAV validation
function isValidWavHeader(filePath:string): boolean{
  try{
    const fd = fs.openSync(filePath,'r')
    const buf = Buffer.alloc(12)
    const n = fs.readSync(fd, buf, 0, 12, 0)
    fs.closeSync(fd)
    if(n<12) return false
    return buf.toString('ascii',0,4)==='RIFF' && buf.toString('ascii',8,12)==='WAVE'
  }catch{ return false }
}
async function ensureWavVoiceFile(inputPath:string): Promise<string>{
  if(!fs.existsSync(inputPath)) throw new Error(`Voice file not found: ${inputPath}`)
  if(isValidWavHeader(inputPath)) return inputPath
  const ext = path.extname(inputPath).toLowerCase()
  const hint = `Voice file "${path.basename(inputPath)}" has invalid WAV RIFF header (found ${ext || 'no ext'}, expected .wav with RIFF/WAVE).`
  // try ffmpeg
  let ffmpegOk = false
  try{
    const r = cp.spawnSync('ffmpeg', ['-version'], {timeout:2000})
    if(r.status===0) ffmpegOk=true
  }catch{}
  if(!ffmpegOk){
    try{
      const which = process.platform==='win32' ? 'where' : 'which'
      const r = cp.spawnSync(which, ['ffmpeg'], {timeout:2000})
      if(r.status===0) ffmpegOk=true
    }catch{}
  }
  if(!ffmpegOk){
    throw new Error(`${hint}\naudio.cpp requires a valid WAV (PCM 16-bit, e.g. 16kHz mono).\n\nFix:\n• Convert with ffmpeg: ffmpeg -i "${inputPath}" -ar 16000 -ac 1 -c:a pcm_s16le "${inputPath}.converted.wav"\n• Or Audacity: Import → Export as WAV (16-bit PCM, 16000 Hz, Mono)\n• Or pick a .wav file.\n\nNo ffmpeg found on PATH — install ffmpeg (https://ffmpeg.org) or convert manually.`)
  }
  const tmpOut = path.join(require('os').tmpdir(), `voice_${Date.now()}_16k.wav`)
  await new Promise<void>((resolve, reject)=>{
    const p = cp.spawn('ffmpeg', ['-y','-i', inputPath, '-ar','16000','-ac','1','-c:a','pcm_s16le', tmpOut], {stdio:['ignore','pipe','pipe']})
    let err=''
    p.stderr?.on('data', d=> err+=d.toString())
    const to = setTimeout(()=> { try{p.kill()}catch{}; reject(new Error('ffmpeg timeout')) }, 20000)
    p.on('close', code=>{
      clearTimeout(to)
      if(code===0 && fs.existsSync(tmpOut) && isValidWavHeader(tmpOut)) resolve()
      else reject(new Error(`ffmpeg failed (code ${code}): ${err.slice(0,800)}`))
    })
    p.on('error', e=>{ clearTimeout(to); reject(e) })
  })
  return tmpOut
}

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
  const modelsDir = getModelsDir(settings.dataRoot)
  const modelPath = path.join(modelsDir, opts.modelId)
  if (!fs.existsSync(modelPath)) throw new Error('Model not installed: '+opts.modelId)
  const outDir = path.join(settings.dataRoot,'outputs')
  fs.mkdirSync(outDir,{recursive:true})
  const outFile = opts.outFile || path.join(outDir, `tts_${Date.now()}.wav`)
  if(settings.autoStartServer && !isServerRunning()){
    try{ await ensureAutoServer() }catch{}
  }
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
  let voiceRefToUse = opts.voiceRef as string | undefined
  if (voiceRefToUse){
    try{ voiceRefToUse = await ensureWavVoiceFile(voiceRefToUse) }catch(e:any){ throw new Error(e.message) }
  }
  const args = ['--task','tts','--family', opts.family||opts.modelId, '--model', modelPath, '--text', opts.text, '--out', outFile]
  if (voiceRefToUse) args.push('--voice-ref', voiceRefToUse)
  if (opts.voiceId) args.push('--voice-id', opts.voiceId)
  if (opts.language) args.push('--load-option', `language=${opts.language}`)
  const r = await runCli(args)
  if (!fs.existsSync(outFile)){
    const errLower = (r.err + r.out).toLowerCase()
    if(errLower.includes('invalid wav') || errLower.includes('riff') || errLower.includes('wav riff')){
      throw new Error(`CLI failed — invalid WAV RIFF header for voice file "${opts.voiceRef}".\n${r.err.slice(0,700)}\n\nFix: convert your voice sample to a valid WAV (PCM 16-bit, 16kHz, mono). Example: ffmpeg -i "${opts.voiceRef}" -ar 16000 -ac 1 -c:a pcm_s16le voice_16k.wav\nOr use a proper .wav file. If ffmpeg is installed, the app will auto-convert next time.`)
    }
    throw new Error('CLI failed: '+(r.err||r.out).slice(0,700))
  }
  return { outFile, via:'cli', log:r.err.slice(0,800) }
})

ipcMain.handle('gen:music', async (_e, opts:any)=>{
  const modelPath = path.join(getModelsDir(settings.dataRoot), opts.modelId)
  if (!fs.existsSync(modelPath)) throw new Error('Model not installed')
  const outDir = path.join(settings.dataRoot,'outputs')
  fs.mkdirSync(outDir,{recursive:true})
  const outFile = path.join(outDir, `music_${Date.now()}.wav`)
  if(settings.autoStartServer && !isServerRunning()){
    try{ await ensureAutoServer() }catch{}
  }
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
  if(settings.autoStartServer && !isServerRunning()){
    try{ await ensureAutoServer() }catch{}
  }
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
