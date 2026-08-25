import * as cp from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { getBackendBin } from './backend'

let serverProc: cp.ChildProcess | null = null
let serverLog = ''

export function isServerRunning(){ return serverProc !== null && serverProc.exitCode===null && !serverProc.killed }
export function getServerLog(){ return serverLog.slice(-4000) }

export async function startServer(backendPath:string, host:string, port:number, models: Array<{id:string, family:string, path:string, task:string}>): Promise<number> {
  if (isServerRunning()) await stopServer()
  const bin = getBackendBin(backendPath,'server')
  if (!bin) {
    const files = fs.existsSync(backendPath) ? fs.readdirSync(backendPath).slice(0,30).join(', ') : 'no backend dir'
    throw new Error(`audiocpp_server not found in ${backendPath}. Files: ${files}. Try re-downloading backend ZIP (needs audiocpp_server.exe).`)
  }
  // ensure executable
  try{ fs.chmodSync(bin, 0o755) }catch{}

  const cfg = {
    host, port,
    backend:'best',
    threads: 2,
    lazy_load: true,
    models: models.map(m=>({ id:m.id, family:m.family, path:m.path, task:m.task, mode:'offline' }))
  }
  const tmpCfg = path.join(backendPath,'studio_server.json')
  fs.writeFileSync(tmpCfg, JSON.stringify(cfg,null,2))
  serverLog = ''

  // log file
  const logDir = path.join(path.dirname(backendPath), '..', 'logs')
  try{ fs.mkdirSync(logDir,{recursive:true}) }catch{}
  const logFile = path.join(logDir, 'server.log')

  serverProc = cp.spawn(bin, ['--config', tmpCfg], { cwd: backendPath, stdio:['ignore','pipe','pipe'] })
  serverProc.stdout?.on('data', d=> { const s=d.toString(); serverLog+=s; try{ fs.appendFileSync(logFile, s)}catch{} })
  serverProc.stderr?.on('data', d=> { const s=d.toString(); serverLog+=s; try{ fs.appendFileSync(logFile, '[ERR] '+s)}catch{} })
  serverProc.on('exit', (code, sig)=>{ serverLog+=`\n[exit code=${code} sig=${sig}]\n`; })
  serverProc.on('error', (err)=>{ serverLog+=`\n[spawn error ${err.message}]\n` })

  // wait for health with polling
  const maxWait = 6000
  const start = Date.now()
  let lastExitCode: number | null = null
  const exitPromise = new Promise<number|null>(res=>{
    if(!serverProc) return res(null)
    serverProc.once('exit', (code)=>{ lastExitCode = code; res(code) })
  })
  while(Date.now()-start < maxWait){
    await new Promise(r=> setTimeout(r, 500))
    if(!isServerRunning()){
      const tail = serverLog.slice(-1500)
      const code = lastExitCode
      // 3221225781 = 0xC0000135 STATUS_DLL_NOT_FOUND
      if(code===3221225781 || code===3221225501){
        const hasCudaDlls = (()=>{ try{
          const files = fs.readdirSync(path.dirname(bin)).join(' ').toLowerCase() + ' ' + (fs.existsSync(backendPath)? fs.readdirSync(backendPath).join(' ').toLowerCase():'')
          return files.includes('cudart') || files.includes('cublas') || bin.toLowerCase().includes('cuda')
        }catch{ return false }})()
        const hasVCRuntime = fs.existsSync('C:\\Windows\\System32\\vcruntime140.dll') || fs.existsSync('C:\\Windows\\System32\\vcruntime140_1.dll')
        const isCudaBackend = hasCudaDlls || (backendPath && backendPath.toLowerCase().includes('cuda'))
        let hint = ''
        if(!hasVCRuntime) hint += '\n• VC++ 2015-2022 Redistributable NOT found (vcruntime140.dll missing). Install: https://aka.ms/vs/17/release/vc_redist.x64.exe  then reboot.'
        if(isCudaBackend) hint += '\n• This looks like a CUDA backend (cudart/cublas). It needs: NVIDIA GPU + NVIDIA Driver + CUDA 12 runtime. If you have no NVIDIA GPU or no CUDA, download the CPU backend ZIP instead (choose the non-CUDA asset on GitHub Releases). CUDA ZIPs are ~2GB, CPU ZIPs are smaller.'
        hint += '\n• Try: Settings → Fetch releases → pick the ZIP with \"cpu\" or \"windows-cpu\" in the name.'
        hint += '\n• Or test: Settings → Test --help (runs audiocpp_server --help without starting server) to see DLL error.'
        hint += `\n• Log tail:\n${tail}`
        hint += `\n• Backend: ${backendPath}\n  Bin: ${bin}\n  Exit code: ${code} (0x${(code>>>0).toString(16)} STATUS_DLL_NOT_FOUND)`
        throw new Error(`Server failed to start — missing DLL (code ${code}).${hint}`)
      }
      throw new Error(`Server exited quickly (code ${lastExitCode}). Log:\n${tail}\nCheck backend ZIP matches OS (Windows CUDA vs CPU) and VC++ runtime is installed. Try CPU build.`)
    }
    try{
      const http = require('http')
      const ok: boolean = await new Promise(res=>{
        const req = http.get(`http://${host}:${port}/health`, (r:any)=>{ res(r.statusCode===200); r.resume() })
        req.on('error',()=> res(false))
        req.setTimeout(800,()=>{ try{req.destroy()}catch{}; res(false)})
      })
      if(ok) return serverProc.pid ?? 0
    }catch{}
  }
  // still not healthy but process is running — maybe health endpoint different, consider running
  if(isServerRunning()) return serverProc.pid ?? 0
  throw new Error(`Server not responding at http://${host}:${port}/health after ${maxWait}ms. Log:\n${serverLog.slice(-1200)}`)
}

export async function stopServer(): Promise<void> {
  if (!serverProc) return
  const p = serverProc
  serverProc=null
  try{ p.kill() }catch{}
  await new Promise(r=> setTimeout(r, 600))
  try{ p.kill('SIGKILL' as any) }catch{}
}

export function getServerPid(){ return serverProc?.pid ?? null }
export function getServerStatus(){ return { running:isServerRunning(), pid:getServerPid(), log:getServerLog().slice(-800) } }
