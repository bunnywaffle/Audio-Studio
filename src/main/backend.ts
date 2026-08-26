import * as fs from 'fs'
import * as path from 'path'
import * as cp from 'child_process'
import AdmZip from 'adm-zip'

export interface BackendInfo {
  path: string | null
  hasCli: boolean
  hasServer: boolean
  hasModelManager: boolean
  version: string | null
  files: string[]
}

export function detectBackend(backendPath: string | null): BackendInfo {
  if (!backendPath || !fs.existsSync(backendPath)) {
    return { path: null, hasCli: false, hasServer: false, hasModelManager: false, version: null, files: [] }
  }
  const list = fs.readdirSync(backendPath)
  const has = (n: string) => list.some(f => f.toLowerCase().includes(n))
  const hasCli = has('audiocpp_cli') || has('audiocpp-cli')
  const hasServer = has('audiocpp_server') || has('audiocpp-server')
  const hasModelManager = has('audiocpp_model_manager') || list.includes('model_manager_v2.py')
  // try read version file if exists
  let version: string | null = null
  const vFile = path.join(backendPath, 'VERSION')
  if (fs.existsSync(vFile)) version = fs.readFileSync(vFile,'utf-8').trim().slice(0,50)
  return { path: backendPath, hasCli, hasServer, hasModelManager, version, files: list.slice(0,40) }
}

export function getBackendBin(backendPath: string, name: 'cli' | 'server' | 'model_manager'): string | null {
  if (!backendPath || !fs.existsSync(backendPath)) return null
  const candidates: Record<string,string[]> = {
    cli: ['audiocpp_cli.exe','audiocpp_cli','audiocpp-cli.exe','audiocpp-cli'],
    server: ['audiocpp_server.exe','audiocpp_server','audiocpp-server.exe','audiocpp-server'],
    model_manager: ['audiocpp_model_manager.exe','audiocpp_model_manager']
  }
  for (const c of candidates[name] ?? []) {
    const p = path.join(backendPath, c)
    if (fs.existsSync(p)) return p
    const sub = path.join(backendPath,'bin',c)
    if (fs.existsSync(sub)) return sub
  }
  // search recursively 1 level
  const files = fs.readdirSync(backendPath)
  for (const f of files) {
    const full = path.join(backendPath,f)
    if (fs.statSync(full).isDirectory()) {
      for (const c of candidates[name] ?? []) {
        const p2 = path.join(full,c)
        if (fs.existsSync(p2)) return p2
      }
    }
  }
  return null
}

export async function importBackendFromZip(zipPath: string, dataRoot: string): Promise<{ backendPath:string, version:string }> {
  if (!fs.existsSync(zipPath)) throw new Error('Zip not found: '+zipPath)
  const zip = new AdmZip(zipPath)
  const targetRoot = path.join(dataRoot,'backend')
  const tmpExtract = path.join(targetRoot,'_tmp_import_'+Date.now())
  fs.mkdirSync(tmpExtract,{recursive:true})
  zip.extractAllTo(tmpExtract, true)
  // Find folder containing binaries - may be nested
  let sourceDir = tmpExtract
  const findBinaryDir = (dir:string):string|null => {
    const entries = fs.readdirSync(dir)
    if (entries.some(e=> e.includes('audiocpp'))) return dir
    for (const e of entries) {
      const full = path.join(dir,e)
      if (fs.statSync(full).isDirectory()) {
        const found = findBinaryDir(full)
        if (found) return found
      }
    }
    return null
  }
  const found = findBinaryDir(tmpExtract)
  if (found) sourceDir = found

  const version = path.basename(zipPath).replace(/\.zip$/i,'')
  const dest = path.join(targetRoot, version)
  if (fs.existsSync(dest)) fs.rmSync(dest,{recursive:true,force:true})
  fs.mkdirSync(path.dirname(dest),{recursive:true})
  fs.cpSync(sourceDir, dest, {recursive:true})
  // also update current symlink/copy
  const current = path.join(targetRoot,'current')
  if (fs.existsSync(current)) fs.rmSync(current,{recursive:true,force:true})
  fs.cpSync(dest, current, {recursive:true})

  // cleanup tmp
  fs.rmSync(tmpExtract,{recursive:true,force:true})
  return { backendPath: current, version }
}

export interface BackendVersion {
  version: string
  path: string
  isCurrent: boolean
  hasCli: boolean
  hasServer: boolean
  sizeMB: number
  mtime: number
  files: string[]
}

export function listBackends(dataRoot:string, currentVersion?: string|null): BackendVersion[]{
  const root = path.join(dataRoot,'backend')
  if(!fs.existsSync(root)) return []
  const entries = fs.readdirSync(root)
  const out: BackendVersion[] = []
  const currentPath = path.join(root,'current')
  let currentTarget = ''
  try{
    if(fs.existsSync(currentPath)){
      // current is a copy, not symlink — try to infer by comparing file lists or version file
      // we store version in settings, but also check if any version folder has same content as current via VERSION file or file count
    }
  }catch{}
  for(const e of entries){
    if(e.startsWith('_') || e==='current' || e==='logs' || e==='_downloads') continue
    const full = path.join(root, e)
    try{
      const st = fs.statSync(full)
      if(!st.isDirectory()) continue
      const info = detectBackend(full)
      if(!info.hasCli && !info.hasServer) continue
      let sizeMB = 0
      try{
        const files = fs.readdirSync(full)
        // rough size: sum of top-level files size
        for(const f of files){
          try{ const s=fs.statSync(path.join(full,f)); if(s.isFile()) sizeMB+=s.size }catch{}
        }
        sizeMB = Math.round(sizeMB/1024/1024)
      }catch{}
      const isCurrent = currentVersion ? e===currentVersion : (()=>{ try{
        if(!fs.existsSync(currentPath)) return false
        const curFiles = fs.readdirSync(currentPath).sort().join(',')
        const verFiles = fs.readdirSync(full).sort().join(',')
        return curFiles===verFiles
      }catch{ return false }})()
      out.push({ version:e, path:full, isCurrent, hasCli:info.hasCli, hasServer:info.hasServer, sizeMB, mtime: st.mtimeMs, files: info.files.slice(0,8) })
    }catch{}
  }
  // also add current as separate entry if it exists and not matched
  if(fs.existsSync(currentPath)){
    const curInfo = detectBackend(currentPath)
    if(curInfo.hasCli || curInfo.hasServer){
      const st = fs.statSync(currentPath)
      const already = out.some(v=> v.isCurrent)
      if(!already){
        out.push({ version:'current', path: currentPath, isCurrent:true, hasCli:curInfo.hasCli, hasServer:curInfo.hasServer, sizeMB:0, mtime: st.mtimeMs, files: curInfo.files.slice(0,8) })
      }
    }
  }
  return out.sort((a,b)=> b.mtime - a.mtime)
}

export function selectBackend(dataRoot:string, version:string): {backendPath:string, version:string}{
  const root = path.join(dataRoot,'backend')
  const src = path.join(root, version)
  const dest = path.join(root,'current')
  if(!fs.existsSync(src)) throw new Error('Version not found: '+version)
  if(fs.existsSync(dest)) fs.rmSync(dest,{recursive:true,force:true})
  fs.cpSync(src, dest, {recursive:true})
  return {backendPath: dest, version}
}

export function deleteBackend(dataRoot:string, version:string){
  const root = path.join(dataRoot,'backend')
  if(version==='current') throw new Error('Cannot delete active current — select another version first or delete via version folder')
  const p = path.join(root, version)
  if(!fs.existsSync(p)) throw new Error('Not found: '+version)
  // safety: only allow deleting inside backend folder
  if(!p.startsWith(root)) throw new Error('Invalid path')
  fs.rmSync(p,{recursive:true,force:true})
}

export function runCliHelp(backendPath:string): Promise<string> {
  return new Promise((resolve,reject)=>{
    const bin = getBackendBin(backendPath,'cli')
    if (!bin) return reject(new Error('audiocpp_cli not found in backend'))
    cp.execFile(bin, ['--help'], { timeout: 5000 }, (err, stdout, stderr)=>{
      if (err && !stdout) return reject(new Error(stderr||err.message))
      resolve(stdout||stderr||'')
    })
  })
}

export async function testBackend(backendPath:string): Promise<{cli:{ok:boolean, code:number|null, out:string}, server:{ok:boolean, code:number|null, out:string}, hint:string}>{
  const cliBin = getBackendBin(backendPath,'cli')
  const srvBin = getBackendBin(backendPath,'server')
  const run = (bin:string|null): Promise<{ok:boolean, code:number|null, out:string}>=>{
    if(!bin) return Promise.resolve({ok:false, code:null, out:'not found'})
    return new Promise(res=>{
      cp.execFile(bin, ['--help'], {timeout:4000}, (err, stdout, stderr)=>{
        const out = (stdout||'') + (stderr||'')
        const code = (err as any)?.code ?? 0
        const ok = !err || !!stdout
        res({ok, code: typeof code==='number'? code: null, out: out.slice(0,2000) || (err? err.message: '')})
      })
    })
  }
  const [cli, server] = await Promise.all([run(cliBin), run(srvBin)])
  let hint=''
  const dllCode = 3221225781
  if(cli.code===dllCode || server.code===dllCode){
    const hasVCRuntime = fs.existsSync('C:\\Windows\\System32\\vcruntime140.dll')
    hint = hasVCRuntime ? 'DLL missing is likely CUDA (cudart) — you downloaded CUDA build but have no NVIDIA/CUDA. Pick CPU ZIP.' : 'vcruntime140.dll missing — install VC++ Redist https://aka.ms/vs/17/release/vc_redist.x64.exe'
  }
  return {cli, server, hint}
}

export function runServerHealth(host:string, port:number): Promise<boolean> {
  return new Promise(resolve=>{
    const http = require('http')
    const req = http.get(`http://${host}:${port}/health`, (res:any)=>{
      resolve(res.statusCode===200)
      res.resume()
    })
    req.on('error',()=> resolve(false))
    req.setTimeout(1500, ()=> { req.destroy(); resolve(false)})
  })
}

export interface GithubRelease {
  tag: string
  name: string
  publishedAt: string
  url: string
  zipAssets: Array<{name:string, url:string, size:number, downloads:number}>
}

export function fetchGithubReleases(limit=8): Promise<GithubRelease[]>{
  return new Promise((resolve,reject)=>{
    const https = require('https')
    const opts = { hostname:'api.github.com', path:`/repos/0xShug0/audio.cpp/releases?per_page=${limit}`, method:'GET', headers:{'User-Agent':'audio-cpp-studio','Accept':'application/vnd.github+json'} }
    const req = https.request(opts, (res:any)=>{
      let data=''
      res.on('data',(c:any)=> data+=c)
      res.on('end',()=>{
        if(res.statusCode !== 200) return reject(new Error(`GitHub ${res.statusCode}: ${data.slice(0,400)}`))
        try{
          const j = JSON.parse(data)
          const out: GithubRelease[] = j.map((r:any)=>({
            tag: r.tag_name,
            name: r.name || r.tag_name,
            publishedAt: r.published_at,
            url: r.html_url,
            zipAssets: (r.assets||[]).filter((a:any)=> /\.zip$/i.test(a.name)).map((a:any)=>({name:a.name, url:a.browser_download_url, size:a.size, downloads:a.download_count}))
          }))
          resolve(out)
        }catch(e){ reject(e)}
      })
    })
    req.on('error',reject)
    req.end()
  })
}

export function downloadBackendFromUrl(url:string, dataRoot:string, onProgress?:(pct:number, dl:number, total:number)=>void): Promise<{backendPath:string, version:string, zipPath:string}>{
  return new Promise((resolve,reject)=>{
    const https = require('https')
    const http = require('http')
    const tmpDir = path.join(dataRoot,'backend','_downloads')
    fs.mkdirSync(tmpDir,{recursive:true})
    const fileName = path.basename(new URL(url).pathname) || `backend_${Date.now()}.zip`
    const zipPath = path.join(tmpDir, fileName)
    const file = fs.createWriteStream(zipPath)
    const client = url.startsWith('https') ? https : http
    // follow redirects manually
    const doGet = (u:string)=>{
      client.get(u, (res:any)=>{
        if(res.statusCode>=300 && res.statusCode<400 && res.headers.location){
          res.resume()
          doGet(res.headers.location)
          return
        }
        if(res.statusCode!==200){ reject(new Error(`HTTP ${res.statusCode} for ${u}`)); return }
        const total = parseInt(res.headers['content-length']||'0',10)
        let dl=0
        res.on('data',(c:Buffer)=>{ dl+=c.length; if(total && onProgress) onProgress(Math.round(dl/total*100), dl, total)})
        res.pipe(file)
        file.on('finish', async ()=>{
          file.close(async ()=>{
            try{
              const r = await importBackendFromZip(zipPath, dataRoot)
              resolve({backendPath:r.backendPath, version:r.version, zipPath})
            }catch(e){ reject(e)}
          })
        })
        file.on('error',reject)
      }).on('error',reject)
    }
    doGet(url)
  })
}
