import * as cp from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { getBackendBin } from './backend'

let serverProc: cp.ChildProcess | null = null

export function isServerRunning(){ return serverProc !== null && !serverProc.killed }

export async function startServer(backendPath:string, host:string, port:number, models: Array<{id:string, family:string, path:string, task:string}>): Promise<number> {
  if (isServerRunning()) await stopServer()
  const bin = getBackendBin(backendPath,'server')
  if (!bin) throw new Error('audiocpp_server not found in backend')

  // write temp config
  const cfg = {
    host, port,
    backend:'best',
    threads: 2,
    lazy_load: true,
    models: models.map(m=>({ id:m.id, family:m.family, path:m.path, task:m.task, mode:'offline' }))
  }
  const tmpCfg = path.join(backendPath,'studio_server.json')
  fs.writeFileSync(tmpCfg, JSON.stringify(cfg,null,2))

  serverProc = cp.spawn(bin, ['--config', tmpCfg], { cwd: backendPath, stdio:['ignore','pipe','pipe'] })
  serverProc.stdout?.on('data', d=> console.log('[server]', d.toString()))
  serverProc.stderr?.on('data', d=> console.log('[server:err]', d.toString()))
  serverProc.on('exit', (code)=>{ console.log('server exit',code); serverProc=null })
  // wait a bit for health
  await new Promise(r=> setTimeout(r, 900))
  return serverProc.pid ?? 0
}

export async function stopServer(): Promise<void> {
  if (!serverProc) return
  const p = serverProc
  serverProc=null
  p.kill()
  await new Promise(r=> setTimeout(r, 400))
  try{ p.kill('SIGKILL') }catch{}
}

export function getServerPid(){ return serverProc?.pid ?? null }
