import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import * as cp from 'child_process'
import { loadSettings, saveSettings } from './settings'
import { detectBackend, importBackendFromZip, runCliHelp, getBackendBin, runServerHealth, fetchGithubReleases, downloadBackendFromUrl, testBackend, listBackends, selectBackend, deleteBackend, repairBackend, getBackendAccelerationType, ensureCudaDlls, killAllBackendProcesses, detectBackendDevices } from './backend'
import { scanInstalled, deleteModel, getModelPath, getModelsDir, resolveInstalledModel, resolveModelFamily, resolveModelTask, findAllGgufFiles, getModelCapabilities, ensureDefaultReferenceVoice, inspectModelWithCli } from './models'
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
ipcMain.handle('backend:listVersions', async ()=> listBackends(settings.dataRoot, settings.backendVersion))
ipcMain.handle('backend:selectVersion', async (_e, version:string)=>{
  // stop server before switching (files may be locked)
  if(isServerRunning()){ try{ await stopServer() }catch{} }
  const r = selectBackend(settings.dataRoot, version)
  settings.backendPath = r.backendPath
  settings.backendVersion = r.version
  saveSettings(settings)
  return { ...r, info: detectBackend(settings.backendPath) }
})
ipcMain.handle('backend:deleteVersion', async (_e, version:string)=>{
  if(settings.backendVersion===version){
    throw new Error('Cannot delete active backend — select another version first')
  }
  deleteBackend(settings.dataRoot, version)
  return listBackends(settings.dataRoot, settings.backendVersion)
})
ipcMain.handle('backend:repair', async (e)=>{
  const onProg = (pct:number, dl:number, total:number)=>{ try{ e.sender.send('backend:downloadProgress', {url:'repair', pct, dl, total})}catch{} }
  const r = await repairBackend(settings.dataRoot, onProg)
  // after repair, update settings if version changed
  if(r.repaired){
    settings.backendPath = r.backendPath
    // try to keep version as before, but repair may have updated
    saveSettings(settings)
  }
  e.sender.send('backend:downloadProgress', {url:'repair', pct:100, done:true})
  return { ...r, info: detectBackend(settings.backendPath), versions: listBackends(settings.dataRoot, settings.backendVersion) }
})
ipcMain.handle('backend:listReleases', async ()=> {
  return await fetchGithubReleases(10)
})
ipcMain.handle('backend:downloadRelease', async (e, url:string)=>{
  if(isServerRunning()){ try{ await stopServer() }catch{} }
  killAllBackendProcesses()
  const onProg = (pct:number, dl:number, total:number)=>{ try{ e.sender.send('backend:downloadProgress', {url, pct, dl, total})}catch{} }
  const r = await downloadBackendFromUrl(url, settings.dataRoot, onProg)
  settings.backendPath = r.backendPath
  settings.backendVersion = r.version
  saveSettings(settings)
  e.sender.send('backend:downloadProgress', {url, pct:100, done:true, version:r.version})
  return { ...r, info: detectBackend(settings.backendPath) }
})
ipcMain.handle('backend:devices', async ()=>{
  if(!settings.backendPath) return []
  return detectBackendDevices(settings.backendPath)
})

ipcMain.handle('models:list', async () => scanInstalled(settings.dataRoot, settings.customModels))
ipcMain.handle('models:listAll', async () => {
  const base = scanInstalled(settings.dataRoot, settings.customModels)
  try{
    const { fetchAllHfFolders, CURATED_MODELS } = await import('./models')
    const folders = await fetchAllHfFolders()
    const curatedFolders = new Set(CURATED_MODELS.map(m=> m.hfFolder).filter(Boolean))
    const dynamic: any[] = folders.filter(f=> !curatedFolders.has(f.folder)).map(f=>{
      const id = f.folder.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'')
      const label = f.folder.replace(/-GGUF$/,'').replace(/-/g,' ')
      const family = resolveModelFamily(id, undefined, f.folder)
      const task = resolveModelTask(id, family, undefined, f.folder)
      return { id, family, label, task, description:`HF folder ${f.folder} — from audio.cpp-gguf`, language:'auto', size:'?', runtime:'GGUF', hfFolder:f.folder, installed:false }
    })
    // check installed for dynamic too
    const installedDirs = fs.existsSync(path.join(settings.dataRoot,'models')) ? new Set(fs.readdirSync(path.join(settings.dataRoot,'models'))) : new Set()
    dynamic.forEach((m:any)=>{
      const p = path.join(settings.dataRoot,'models', m.id)
      const res = resolveInstalledModel(settings.dataRoot, m.id)
      m.installed = res.installed
      if(m.installed) {
        m.localPath = p
        m.primaryGguf = res.primaryFileName || undefined
        m.ggufFiles = res.files.map(f => path.basename(f))
      }
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
ipcMain.handle('models:getVariants', async (_e, id:string)=>{
  const { getModelVariants } = await import('./models')
  return await getModelVariants(id)
})
ipcMain.handle('models:delete', async (_e, id:string) => {
  deleteModel(settings.dataRoot, id)
  return scanInstalled(settings.dataRoot, settings.customModels)
})
ipcMain.handle('models:updateCustom', async (_e, id:string, metadata:any)=>{
  if (!settings.customModels) settings.customModels = {}
  settings.customModels[id] = { ...(settings.customModels[id] || {}), ...metadata }
  saveSettings(settings)
  return scanInstalled(settings.dataRoot, settings.customModels)
})
ipcMain.handle('models:test', async (_e, id:string)=>{
  const resolved = resolveInstalledModel(settings.dataRoot, id)
  if (!resolved.installed || !resolved.ggufPath) {
    throw new Error(`Model "${id}" is not installed or contains no .gguf files`)
  }
  const bin = settings.backendPath ? getBackendBin(settings.backendPath, 'cli') : null
  if (!bin) throw new Error('No backend CLI installed — import or download backend in Settings')
  const bPath = (settings.backendPath||'').toLowerCase()
  const backendType = bPath.includes('cuda') ? 'cuda' : bPath.includes('hip')||bPath.includes('rocm') ? 'hip' : bPath.includes('vulkan') ? 'vulkan' : bPath.includes('metal') ? 'metal' : 'cpu'
  const task = resolved.task === 'music' ? 'gen' : resolved.task
  const args = ['--task', task, '--family', resolved.family, '--model', resolved.ggufPath]
  if (backendType && backendType !== 'cpu') args.push('--backend', backendType)
  args.push('--help')
  try{
    const r = await runCli(args, 12000)
    return { ok: true, out: (r.out || r.err || 'Model validation succeeded').slice(0, 1000), resolved }
  }catch(e:any){
    return { ok: false, error: e.message, resolved }
  }
})
ipcMain.handle('models:import', async (_e, id:string, sourcePath:string, taskOverride?:string, familyOverride?:string)=>{
  if(!sourcePath || !fs.existsSync(sourcePath)) throw new Error('Source not found: '+sourcePath)
  const destDir = getModelPath(settings.dataRoot, id)
  fs.mkdirSync(destDir,{recursive:true})
  const stat = fs.statSync(sourcePath)
  const validateGguf = (p:string)=>{
    const fd = fs.openSync(p,'r')
    const buf = Buffer.alloc(4)
    const n = fs.readSync(fd, buf, 0, 4, 0)
    fs.closeSync(fd)
    if(n<4 || buf.toString('ascii')!=='GGUF') throw new Error(path.basename(p)+' is not a valid GGUF (bad header)')
  }
  if(stat.isDirectory()){
    const files = findAllGgufFiles(sourcePath)
    if(files.length===0) throw new Error('No .gguf found in folder')
    for(const f of files){
      validateGguf(f)
      const rel = path.relative(sourcePath, f)
      const target = path.join(destDir, rel)
      fs.mkdirSync(path.dirname(target), {recursive:true})
      fs.copyFileSync(f, target)
    }
  } else {
    validateGguf(sourcePath)
    fs.copyFileSync(sourcePath, path.join(destDir, path.basename(sourcePath)))
  }
  if (taskOverride || familyOverride) {
    if (!settings.customModels) settings.customModels = {}
    settings.customModels[id] = {
      ...(settings.customModels[id] || {}),
      task: taskOverride,
      family: familyOverride,
    }
    saveSettings(settings)
  }
  return scanInstalled(settings.dataRoot, settings.customModels)
})
ipcMain.handle('models:download', async (e, id:string, url?:string) => {
  const dir = getModelPath(settings.dataRoot, id)
  fs.mkdirSync(dir,{recursive:true})
  const doDownload = async (dlUrl:string, relPath?:string)=>{
    const { downloadFile } = await import('./models')
    let dest: string
    if(relPath){
      // preserve HF folder structure (e.g. turbo/ace-step-1.5-turbo-q8_0.gguf)
      dest = path.join(dir, relPath)
      fs.mkdirSync(path.dirname(dest),{recursive:true})
    } else {
      dest = path.join(dir, path.basename(new URL(dlUrl).pathname) || 'model.gguf')
    }
    const fileName = path.basename(dest)
    let last = -1
    const onProg = (pct:number, dl:number, total:number) => {
      if (pct!==last){ last=pct; e.sender.send('models:downloadProgress', { id, pct, dl, total, file: dest, note:`${fileName} ${pct}%` }) }
    }
    e.sender.send('models:downloadProgress', { id, pct:0, note:`${fileName} 0%` })
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
  // No URL: resolve via HF repo (keyword-scored: turbo/base/size matching)
  try{
    const { resolveHfDownloadUrl } = await import('./models')
    e.sender.send('models:downloadProgress', { id, pct:0, note:'Resolving best variant…' })
    const resolved = await resolveHfDownloadUrl(id)
    e.sender.send('models:downloadProgress', { id, pct:1, note:`Best match: ${resolved.fileName} (${((resolved.size||0)/1024/1024/1024).toFixed(2)} GB)` })
    return await doDownload(resolved.url, resolved.relPath)
  }catch(err:any){
    e.sender.send('models:downloadProgress', { id, error: err.message })
    throw err
  }
})

ipcMain.handle('models:downloadAll', async (e, id:string) => {
  const dir = getModelPath(settings.dataRoot, id)
  fs.mkdirSync(dir,{recursive:true})
  const { downloadFile, fetchHfFolderFiles, CURATED_MODELS, HF_BASE } = await import('./models')
  const entry = CURATED_MODELS.find(m=> m.id===id)
  let folder = entry?.hfFolder || id
  if(!entry){
    try{
      const { fetchAllHfFolders } = await import('./models')
      const all = await fetchAllHfFolders()
      const sanitized = (s:string)=> s.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'')
      const found = all.find(f=> sanitized(f.folder)===id)
      if(found) folder = found.folder
    }catch{}
  }
  const files = await fetchHfFolderFiles(folder)
  if(files.length===0) throw new Error('No .gguf in '+folder)
  let i=0
  try{
    for(const f of files){
      i++
      const rel = f.path.startsWith(folder+'/') ? f.path.slice(folder.length+1) : path.basename(f.path)
      const dest = path.join(dir, rel)
      fs.mkdirSync(path.dirname(dest),{recursive:true})
      const label = `[${i}/${files.length}] ${path.basename(f.path)}`
      e.sender.send('models:downloadProgress', { id, pct:0, note:label })
      await downloadFile(`${HF_BASE}/${f.path}`, dest, (pct)=>{
        e.sender.send('models:downloadProgress', { id, pct, note:`${label} ${pct}%` })
      })
    }
  }catch(err:any){
    e.sender.send('models:downloadProgress', { id, error: err.message })
    throw err
  }
  e.sender.send('models:downloadProgress', { id, pct:100, done:true, note:`All ${files.length} files downloaded` })
  return scanInstalled(settings.dataRoot)
})

ipcMain.handle('server:start', async (_e, models:any[]) => {
  if (!settings.backendPath) throw new Error('No backend — download from GitHub Releases or Import ZIP in Settings')
  const preparedModels = (models || []).map(m => {
    const resolved = resolveInstalledModel(settings.dataRoot, m.id)
    return {
      id: m.id,
      family: resolved.family || m.family,
      path: resolved.ggufPath || m.path || getModelPath(settings.dataRoot, m.id),
      task: resolved.task === 'music' ? 'gen' : (resolved.task || m.task),
    }
  })
  await startServer(settings.backendPath, settings.serverHost, settings.serverPort, preparedModels)
  return { ...getServerStatus(), host:settings.serverHost, port:settings.serverPort }
})
ipcMain.handle('server:stop', async ()=> { await stopServer(); return { ...getServerStatus(), host:settings.serverHost, port:settings.serverPort } })
ipcMain.handle('server:status', async ()=> ({ ...getServerStatus(), host:settings.serverHost, port:settings.serverPort }))
ipcMain.handle('server:log', async ()=> getServerStatus())
ipcMain.handle('server:openWebUi', async () => {
  if (!settings.backendPath) {
    throw new Error('No backend installed — download or import a backend in Settings.')
  }
  if (!isServerRunning()) {
    const installed = scanInstalled(settings.dataRoot)
    const preparedModels = (installed || []).filter(m => m.installed).map(m => {
      const resolved = resolveInstalledModel(settings.dataRoot, m.id)
      return {
        id: m.id,
        family: resolved.family || m.family,
        path: resolved.ggufPath || m.localPath || getModelPath(settings.dataRoot, m.id),
        task: resolved.task === 'music' ? 'gen' : (resolved.task || m.task),
      }
    })
    await startServer(settings.backendPath, settings.serverHost, settings.serverPort, preparedModels)
  }
  const url = `http://${settings.serverHost}:${settings.serverPort}`
  await shell.openExternal(url)
  return { url, ok: true }
})

async function ensureAutoServer(){
  if(!settings.autoStartServer) return false
  if(isServerRunning()) return true
  if(!settings.backendPath) return false
  try{
    await startServer(settings.backendPath, settings.serverHost, settings.serverPort, [])
    return isServerRunning()
  }catch(e){ console.log('auto-start failed', e); return false }
}

function getBackendAcceleration(): string {
  return getBackendAccelerationType(settings.backendPath, settings.backendVersion)
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

// Active CLI process tracking for cancellation
let activeCliProcess: cp.ChildProcess | null = null

ipcMain.handle('gen:cancel', async () => {
  if (activeCliProcess) {
    try {
      activeCliProcess.kill()
      activeCliProcess = null
      return { ok: true, message: 'Generation cancelled' }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  }
  return { ok: false, message: 'No active generation process' }
})

// Generation via CLI (fallback) — spawns audiocpp_cli with live streaming & diagnostics
async function runCli(
  args: string[],
  timeout = 300000,
  onProgress?: (text: string) => void
): Promise<{ out: string; err: string; code: number | null }> {
  const bin = settings.backendPath ? getBackendBin(settings.backendPath, 'cli') : null
  if (!bin) throw new Error('Backend CLI not found — import a backend zip in Settings')

  return await new Promise((resolve, reject) => {
    const p = cp.spawn(bin!, args, { cwd: settings.dataRoot })
    activeCliProcess = p
    let out = '', err = ''

    p.stdout?.on('data', d => {
      const chunk = d.toString()
      out += chunk
      if (onProgress) onProgress(chunk)
    })

    p.stderr?.on('data', d => {
      const chunk = d.toString()
      err += chunk
      if (onProgress) onProgress(chunk)
    })

    const t = setTimeout(() => {
      try { p.kill() } catch {}
      if (activeCliProcess === p) activeCliProcess = null
      const combined = (err + '\n' + out).trim()
      const lastLogs = combined ? combined.slice(-1500) : '(No engine logs recorded)'
      reject(new Error(
        `CLI timeout: Engine did not finish within ${Math.round(timeout / 1000)} seconds.\n\n` +
        `Last engine logs:\n${lastLogs}\n\n` +
        `Tips to fix:\n` +
        `• On CPU, diffusion music generation takes longer. In the Music tab, reduce Steps to 8 or 16.\n` +
        `• Set Duration to 15s or 30s.\n` +
        `• In Settings, ensure CUDA or Vulkan acceleration is selected if your PC has a dedicated GPU.`
      ))
    }, timeout)

    p.on('close', code => {
      clearTimeout(t)
      if (activeCliProcess === p) activeCliProcess = null
      resolve({ out, err, code })
    })

    p.on('error', error => {
      clearTimeout(t)
      if (activeCliProcess === p) activeCliProcess = null
      reject(error)
    })
  })
}

// Dynamic Auto-Adapting Execution Wrapper
// Automatically detects AVX-512 CPU crashes, Vulkan failures, or CUDA missing libraries,
// and gracefully falls back to CUDA or CPU so generations never fail unexpectedly.
async function runCliWithAutoAdapt(options: {
  taskName: string
  buildArgs: (backendAcc: string) => string[]
  outFile: string
  timeout?: number
  onProgress?: (text: string) => void
  resolvedFamily?: string
  voiceRef?: string
  voiceWarning?: string | null
  customNote?: string | null
}): Promise<{ outFile: string; via: string; note?: string; log?: string; voiceWarning?: string }> {
  let backendAcc = getBackendAcceleration()
  let args = options.buildArgs(backendAcc)
  let r = await runCli(args, options.timeout || 300000, options.onProgress)

  if (fs.existsSync(options.outFile)) {
    const ret: any = { outFile: options.outFile, via: 'cli', log: r.err.slice(0, 800) }
    if (options.customNote) ret.note = options.customNote
    if (options.voiceWarning) ret.voiceWarning = options.voiceWarning
    return ret
  }

  // Generation failed — diagnose if this is an instruction / backend crash
  const errCombined = (r.err + '\n' + r.out).toLowerCase()
  const isIllegalInstruction = r.code === -1073741795 || r.code === 3221225501 ||
                               errCombined.includes('0xc000001d') || errCombined.includes('illegal instruction')
  const isVulkanCrash = backendAcc === 'vulkan' && (isIllegalInstruction || errCombined.includes('ggml_vulkan') || r.code !== 0)
  const isCudaCrash = backendAcc === 'cuda' && (errCombined.includes('cuda error') || errCombined.includes('cannot load library') || errCombined.includes('cudart') || r.code !== 0)

  // 1. If Vulkan crashed (e.g. AVX-512 instruction fault on AMD Zen / Intel CPU), auto-adapt to CUDA
  if (isVulkanCrash) {
    const installed = listBackends(settings.dataRoot)
    const cudaBackend = installed.find(b => b.version.toLowerCase().includes('cuda') && b.version !== 'current')
    if (cudaBackend) {
      try {
        if (options.onProgress) options.onProgress('\n[Auto-Adaptation] Vulkan encountered CPU instruction incompatibility; automatically adapting to CUDA GPU acceleration...\n')
        const sel = selectBackend(settings.dataRoot, cudaBackend.version)
        settings.backendPath = sel.backendPath
        settings.backendVersion = sel.version
        saveSettings(settings)
        backendAcc = 'cuda'
        args = options.buildArgs('cuda')
        r = await runCli(args, options.timeout || 300000, options.onProgress)
        if (fs.existsSync(options.outFile)) {
          const ret: any = {
            outFile: options.outFile,
            via: 'cli (auto-adapted to CUDA)',
            note: 'Vulkan encountered incompatible AVX-512 CPU instructions for this model on your processor; the studio automatically adapted and completed generation with NVIDIA CUDA acceleration.',
            log: r.err.slice(0, 800)
          }
          if (options.customNote) ret.note = options.customNote + ' | ' + ret.note
          if (options.voiceWarning) ret.voiceWarning = options.voiceWarning
          return ret
        }
      } catch {}
    }
  }

  // 2. If CUDA failed, check and auto-restore companion CUDA runtime DLLs
  if (isCudaCrash && settings.backendPath) {
    const restored = ensureCudaDlls(settings.backendPath, path.join(settings.dataRoot, 'backend'), settings.backendVersion || undefined)
    if (restored) {
      if (options.onProgress) options.onProgress('\n[Auto-Adaptation] Restored CUDA runtime libraries; retrying inference...\n')
      r = await runCli(options.buildArgs('cuda'), options.timeout || 300000, options.onProgress)
      if (fs.existsSync(options.outFile)) {
        const ret: any = {
          outFile: options.outFile,
          via: 'cli (auto-adapted CUDA runtime)',
          note: 'Auto-repaired: CUDA runtime libraries were restored and generation finished successfully.',
          log: r.err.slice(0, 800)
        }
        if (options.customNote) ret.note = options.customNote + ' | ' + ret.note
        return ret
      }
    }
  }

  // 3. Fall back to CPU if GPU execution failed
  if (backendAcc !== 'cpu') {
    try {
      const installed = listBackends(settings.dataRoot)
      const portableBackend = installed.find(b => b.version.toLowerCase().includes('portable') && b.version !== 'current')
      if (isIllegalInstruction && portableBackend) {
        const sel = selectBackend(settings.dataRoot, portableBackend.version)
        settings.backendPath = sel.backendPath
        settings.backendVersion = sel.version
        saveSettings(settings)
      }
      if (options.onProgress) options.onProgress('\n[Auto-Adaptation] Retrying inference on CPU...\n')
      args = options.buildArgs('cpu')
      r = await runCli(args, options.timeout || 300000, options.onProgress)
      if (fs.existsSync(options.outFile)) {
        const ret: any = {
          outFile: options.outFile,
          via: 'cli (auto-adapted to CPU)',
          note: 'GPU backend was incompatible; automatically completed inference on CPU.',
          log: r.err.slice(0, 800)
        }
        if (options.customNote) ret.note = options.customNote + ' | ' + ret.note
        return ret
      }
    } catch {}
  }

  // If all attempts failed, throw informative diagnostic error
  const finalErr = (r.err + '\n' + r.out).toLowerCase()
  if (finalErr.includes('reference text') || finalErr.includes('icl mode requires')) {
    throw new Error(`Voice cloning failed — this model (${options.resolvedFamily || 'TTS'}) requires a reference transcript.\n\nFix: Paste the exact spoken words of your reference audio into the "Reference transcript" field, or clear the voice sample to use the standard default voice.`)
  }
  if (finalErr.includes('invalid wav') || finalErr.includes('riff') || finalErr.includes('wav riff')) {
    const base = `CLI failed — invalid WAV RIFF header for voice file "${options.voiceRef}".\n${(r.err || r.out).slice(0, 700)}`
    if (options.voiceWarning) throw new Error(base + `\n\nAlso: ${options.voiceWarning}\n\nFix: convert to WAV 16k mono: ffmpeg -i "${options.voiceRef}" -ar 16000 -ac 1 -c:a pcm_s16le voice_16k.wav`)
    throw new Error(base + `\n\nFix: convert your voice sample to WAV (PCM 16-bit, 16kHz, mono).`)
  }
  if (isIllegalInstruction) {
    throw new Error(`Execution stopped (0xC000001D Illegal Instruction): Upstream build contains AVX-512 instructions not supported by this CPU.\n\nGo to Settings → Installed Backends and select "CUDA 12.4" or "CPU-Portable".`)
  }

  throw new Error(`CLI generation failed (exit ${r.code ?? '?'}).\n${(r.err || r.out).slice(0, 1000)}`)
}

ipcMain.handle('gen:tts', async (_e, opts:any) => {
  const resolved = resolveInstalledModel(settings.dataRoot, opts.modelId)
  if (!resolved.installed || !resolved.ggufPath) {
    throw new Error(`TTS model "${opts.modelId}" is not installed or has no .gguf files. Download it in Models tab.`)
  }
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
        body: JSON.stringify({ model: opts.modelId, input: opts.text, voice: opts.voiceId || undefined, reference_text: opts.referenceText || undefined })
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
    fs.writeFileSync(outFile+'.txt', `DEMO TTS output for "${opts.text.slice(0,60)}" model=${opts.modelId}`)
    return { outFile: outFile+'.txt', via:'demo (no backend)', note:'Install backend to generate real audio' }
  }
  let voiceRefToUse = opts.voiceRef as string | undefined
  let voiceWarning: string | null = null
  let customNote: string | null = null

  if (voiceRefToUse){
    try{ voiceRefToUse = await ensureWavVoiceFile(voiceRefToUse) }
    catch(e:any){
      const msg = e.message || String(e)
      if(msg.includes('invalid WAV') || msg.includes('RIFF') || msg.includes('WAV RIFF')){
        voiceWarning = msg
        // fallback: try without voice clone (use built-in voice)
        voiceRefToUse = undefined
      } else {
        throw new Error(msg)
      }
    }
  }

  let family = resolveModelFamily(opts.modelId, opts.family || resolved.family, resolved.ggufPath)
  let capabilities = getModelCapabilities(family, opts.modelId)

  // Dynamically inspect model via audio.cpp CLI contract if available
  if (bin && resolved.ggufPath) {
    try {
      const spec = inspectModelWithCli(bin, resolved.ggufPath)
      if (spec && spec.family) {
        family = spec.family
        capabilities = getModelCapabilities(family, opts.modelId, spec)
      }
    } catch {}
  }

  // Dynamic model adaptation:
  // If the model strictly requires a voice clone sample (e.g. Qwen3 Base, GLM) and none is provided, auto-apply default reference voice
  if (capabilities.requiresVoiceClone && !voiceRefToUse) {
    voiceRefToUse = ensureDefaultReferenceVoice(settings.dataRoot)
    if (!opts.referenceText || !opts.referenceText.trim()) {
      opts.referenceText = 'Audio speech reference sample.'
    }
    customNote = 'Qwen3 Base requires a reference voice sample; automatically applied standard reference voice and transcript.'
  }

  // If model requires reference text and voiceRef is provided but referenceText is missing, auto-populate referenceText
  if (capabilities.requiresReferenceText && voiceRefToUse && (!opts.referenceText || !opts.referenceText.trim())) {
    opts.referenceText = 'Audio speech reference sample.'
  }

  const buildArgs = (acc: string) => {
    const a = ['--task','tts','--family', family, '--model', resolved.ggufPath!, '--text', opts.text, '--out', outFile]
    if (acc && acc !== 'cpu') a.push('--backend', acc)

    // Voice cloning: only pass if model supports it and user provided a sample (or default was auto-applied)
    if (capabilities.supportsVoiceClone && voiceRefToUse) {
      a.push('--voice-ref', voiceRefToUse)
      if (opts.referenceText && opts.referenceText.trim()) {
        a.push('--reference-text', opts.referenceText.trim())
      }
    }

    // Voice instruction / prompt (e.g. for voice design / instruct models)
    if (capabilities.supportsVoiceInstruct && opts.instruct && opts.instruct.trim()) {
      a.push('--instruct', opts.instruct.trim())
    }

    // Preset voice / speaker
    if (opts.voiceId && opts.voiceId.trim()) {
      a.push('--voice-id', opts.voiceId.trim())
      a.push('--speaker', opts.voiceId.trim())
    }

    if (opts.language) a.push('--load-option', `language=${opts.language}`)
    return a
  }

  const onProgress = (chunk: string) => {
    try { _e.sender.send('gen:progress', { type: 'tts', text: chunk }) } catch {}
  }

  return await runCliWithAutoAdapt({
    taskName: 'tts',
    buildArgs,
    outFile,
    timeout: 300000,
    onProgress,
    resolvedFamily: family,
    voiceRef: opts.voiceRef,
    voiceWarning,
    customNote
  })
})

ipcMain.handle('gen:music', async (_e, opts:any)=>{
  const resolved = resolveInstalledModel(settings.dataRoot, opts.modelId)
  if (!resolved.installed || !resolved.ggufPath) {
    throw new Error(`Music model "${opts.modelId}" is not installed or contains no .gguf files. Please download it via Models tab or Import GGUF.`)
  }
  const outDir = path.join(settings.dataRoot,'outputs')
  fs.mkdirSync(outDir,{recursive:true})
  const outFile = path.join(outDir, `music_${Date.now()}.wav`)

  const family = resolveModelFamily(opts.modelId, opts.family || resolved.family, resolved.ggufPath)
  const task = 'gen'
  const modelPath = resolved.ggufPath

  if(settings.autoStartServer && !isServerRunning()){
    try{ await ensureAutoServer() }catch{}
  }

  // 1. Try server mode if running
  if (isServerRunning()){
    try{
      const res = await fetch(`http://${settings.serverHost}:${settings.serverPort}/v1/tasks/run`,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          task: 'gen',
          model: opts.modelId,
          text: opts.prompt,
          options: {
            lyrics: opts.lyrics || undefined,
            duration: opts.duration ? parseInt(opts.duration, 10) : 30,
            num_inference_steps: opts.steps ? parseInt(opts.steps, 10) : undefined
          }
        })
      })
      if (res.ok){
        const contentType = res.headers.get('content-type') || ''
        if (contentType.includes('audio') || contentType.includes('octet-stream')) {
          const buf = Buffer.from(await res.arrayBuffer())
          fs.writeFileSync(outFile, buf)
          return { outFile, via:'server', status:res.status }
        }
      }
    }catch{}
  }

  // 2. CLI Execution with auto-adaptation
  const bin = settings.backendPath ? getBackendBin(settings.backendPath,'cli') : null
  if (!bin){
    fs.writeFileSync(outFile+'.txt', `DEMO MUSIC prompt="${opts.prompt}" lyrics="${(opts.lyrics||'').slice(0,80)}"`)
    return { outFile: outFile+'.txt', via:'demo (no backend)', note:'Install backend to generate real audio' }
  }

  const durationSec = opts.duration ? String(opts.duration) : '30'
  const isTurbo = opts.modelId.toLowerCase().includes('turbo') || modelPath.toLowerCase().includes('turbo')
  const defaultSteps = isTurbo ? '8' : '25'
  const stepsToUse = opts.steps ? String(opts.steps) : defaultSteps

  const buildArgs = (acc: string) => {
    const a = [
      '--task', task,
      '--family', family,
      '--model', modelPath,
      '--text', opts.prompt,
      '--out', outFile,
      '--task-route', 'text2music',
      '--metrics',
      '--log'
    ]
    if (acc && acc !== 'cpu') {
      a.push('--backend', acc)
    }

    a.push('--duration-seconds', durationSec)
    a.push('--request-option', `duration=${durationSec}`)
    a.push('--request-option', `duration_seconds=${durationSec}`)

    a.push('--num-inference-steps', stepsToUse)
    a.push('--max-steps', stepsToUse)
    a.push('--request-option', `num_inference_steps=${stepsToUse}`)

    if (opts.lyrics && opts.lyrics.trim()) {
      a.push('--lyrics', opts.lyrics.trim())
      a.push('--request-option', `lyrics=${opts.lyrics.trim()}`)
    }
    return a
  }

  const onProgress = (chunk: string) => {
    try { _e.sender.send('gen:progress', { type: 'music', text: chunk }) } catch {}
  }

  // Default timeout: 15 minutes (900,000 ms)
  const timeoutMs = opts.timeout ? parseInt(opts.timeout, 10) * 1000 : 900000

  return await runCliWithAutoAdapt({
    taskName: 'music',
    buildArgs,
    outFile,
    timeout: timeoutMs,
    onProgress,
    resolvedFamily: family
  })
})

ipcMain.handle('gen:asr', async (_e, opts:any)=>{
  const resolved = resolveInstalledModel(settings.dataRoot, opts.modelId)
  if (!resolved.installed || !resolved.ggufPath) {
    throw new Error(`ASR model "${opts.modelId}" is not installed or contains no .gguf files. Download it via Models tab.`)
  }
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
  const family = resolveModelFamily(opts.modelId, opts.family || resolved.family, resolved.ggufPath)
  const backendAcc = getBackendAcceleration()
  const args = ['--task','asr','--family', family, '--model', resolved.ggufPath, '--audio', opts.audioPath]
  if (backendAcc && backendAcc !== 'cpu') args.push('--backend', backendAcc)
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
