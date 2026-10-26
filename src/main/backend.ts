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
  acceleration: 'cuda' | 'vulkan' | 'hip' | 'metal' | 'cpu'
  files: string[]
}

export function getBackendAccelerationType(backendPath: string | null, versionHint?: string | null): 'cuda' | 'vulkan' | 'hip' | 'metal' | 'cpu' {
  if (!backendPath || !fs.existsSync(backendPath)) {
    const v = (versionHint || '').toLowerCase()
    if (v.includes('cuda')) return 'cuda'
    if (v.includes('vulkan')) return 'vulkan'
    if (v.includes('hip') || v.includes('rocm')) return 'hip'
    if (v.includes('metal')) return 'metal'
    return 'cpu'
  }

  // 1. Direct ggml runtime DLLs
  if (fs.existsSync(path.join(backendPath, 'ggml-cuda.dll'))) return 'cuda'
  if (fs.existsSync(path.join(backendPath, 'ggml-vulkan.dll'))) return 'vulkan'
  if (fs.existsSync(path.join(backendPath, 'ggml-metal.dll'))) return 'metal'
  if (fs.existsSync(path.join(backendPath, 'ggml-hip.dll')) || fs.existsSync(path.join(backendPath, 'ggml-rocm.dll'))) return 'hip'

  // 2. VERSION file or version hint or folder name
  let version = versionHint || ''
  const vFile = path.join(backendPath, 'VERSION')
  if (fs.existsSync(vFile)) {
    try { version = fs.readFileSync(vFile, 'utf-8').trim() } catch {}
  }
  const combined = `${backendPath} ${version}`.toLowerCase()
  if (combined.includes('cuda')) return 'cuda'
  if (combined.includes('vulkan')) return 'vulkan'
  if (combined.includes('hip') || combined.includes('rocm')) return 'hip'
  if (combined.includes('metal')) return 'metal'

  // 3. Binary inspection via audiocpp_cli.exe --version
  try {
    const cliBin = getBackendBin(backendPath, 'cli')
    if (cliBin && fs.existsSync(cliBin)) {
      const out = cp.execFileSync(cliBin, ['--version'], { timeout: 2500, encoding: 'utf-8' })
      const lower = out.toLowerCase()
      if (lower.includes('backends:')) {
        if (lower.includes('cuda')) return 'cuda'
        if (lower.includes('vulkan')) return 'vulkan'
        if (lower.includes('hip') || lower.includes('rocm')) return 'hip'
        if (lower.includes('metal')) return 'metal'
      }
    }
  } catch {}

  return 'cpu'
}

export function detectBackend(backendPath: string | null): BackendInfo {
  if (!backendPath || !fs.existsSync(backendPath)) {
    return { path: null, hasCli: false, hasServer: false, hasModelManager: false, version: null, acceleration: 'cpu', files: [] }
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
  const acceleration = getBackendAccelerationType(backendPath, version)
  return { path: backendPath, hasCli, hasServer, hasModelManager, version, acceleration, files: list.slice(0,40) }
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
  
  // write VERSION file
  try { fs.writeFileSync(path.join(dest, 'VERSION'), version) } catch {}

  // If CUDA backend, check if a companion cudart runtime zip exists in _downloads
  const acc = getBackendAccelerationType(dest, version)
  if (acc === 'cuda') {
    const dlDir = path.join(targetRoot, '_downloads')
    if (fs.existsSync(dlDir)) {
      const zips = fs.readdirSync(dlDir).filter(f => f.endsWith('.zip'))
      const cudaMatch = version.match(/cuda(\d+(\.\d+)?)/i)?.[0] || 'cuda12.4'
      const cudartZip = zips.find(z => new RegExp(`cudart.*${cudaMatch}`, 'i').test(z)) ||
                        zips.find(z => /cudart.*cuda12\.4/i.test(z)) ||
                        zips.find(z => /cudart/i.test(z) || /cuda-runtime/i.test(z))
      if (cudartZip) {
        try {
          const cz = new AdmZip(path.join(dlDir, cudartZip))
          cz.extractAllTo(dest, true)
        } catch {}
      }
    }
  }

  // also update current copy
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

  // If CUDA backend, ensure companion runtime DLLs are present
  const acc = getBackendAccelerationType(dest, version)
  if (acc === 'cuda') {
    const files = fs.readdirSync(dest)
    const hasCudart = files.some(f => /cudart64_.*\.dll/i.test(f))
    const dlDir = path.join(root, '_downloads')
    if (!hasCudart && fs.existsSync(dlDir)) {
      const zips = fs.readdirSync(dlDir).filter(f => f.endsWith('.zip'))
      const cudaMatch = version.match(/cuda(\d+(\.\d+)?)/i)?.[0] || 'cuda12.4'
      const cudartZip = zips.find(z => new RegExp(`cudart.*${cudaMatch}`, 'i').test(z)) ||
                        zips.find(z => /cudart.*cuda12\.4/i.test(z)) ||
                        zips.find(z => /cudart/i.test(z) || /cuda-runtime/i.test(z))
      if (cudartZip) {
        try {
          const cz = new AdmZip(path.join(dlDir, cudartZip))
          cz.extractAllTo(dest, true)
          cz.extractAllTo(src, true)
        } catch {}
      }
    }
  }

  // Write VERSION file
  try {
    fs.writeFileSync(path.join(dest, 'VERSION'), version)
  } catch {}

  return {backendPath: dest, version}
}

export function deleteBackend(dataRoot:string, version:string){
  const root = path.join(dataRoot,'backend')
  if(version==='current') throw new Error('Cannot delete active current — select another version first or delete via version folder')
  const p = path.join(root, version)
  if(!fs.existsSync(p)) throw new Error('Not found: '+version)
  if(!p.startsWith(root)) throw new Error('Invalid path')
  fs.rmSync(p,{recursive:true,force:true})
}

export async function repairBackend(dataRoot:string, onProgress?:(pct:number, dl:number, total:number)=>void): Promise<{backendPath:string, version:string, repaired:boolean, details:string}>{
  const root = path.join(dataRoot,'backend')
  const current = path.join(root,'current')
  if(!fs.existsSync(current)){
    throw new Error('No backend folder installed yet. Go to Settings → Fetch releases and download a backend ZIP.')
  }

  let currentVersion: string | null = null
  try{
    const settingsPath = path.join(require('electron').app.getPath('userData'), 'settings.json')
    if(fs.existsSync(settingsPath)){
      const s = JSON.parse(fs.readFileSync(settingsPath,'utf-8'))
      currentVersion = s.backendVersion || null
    }
  }catch{}
  if(!currentVersion){
    try{ currentVersion = fs.readFileSync(path.join(current,'VERSION'),'utf-8').trim() }catch{}
  }
  if(!currentVersion){
    currentVersion = 'current'
  }

  const cliBin = getBackendBin(current, 'cli')
  const srvBin = getBackendBin(current, 'server')
  const missing: string[] = []
  if (!cliBin || !fs.existsSync(cliBin) || fs.statSync(cliBin).size < 1024*10) missing.push('audiocpp_cli.exe')
  if (!srvBin || !fs.existsSync(srvBin) || fs.statSync(srvBin).size < 1024*10) missing.push('audiocpp_server.exe')

  const accType = getBackendAccelerationType(current, currentVersion)
  const isCuda = accType === 'cuda'
  let missingCudaDlls = false
  if (isCuda) {
    const files = fs.existsSync(current) ? fs.readdirSync(current) : []
    const hasCudart = files.some(f => /cudart64_.*\.dll/i.test(f))
    const hasCublas = files.some(f => /cublas64_.*\.dll/i.test(f))
    if (!hasCudart || !hasCublas) {
      missingCudaDlls = true
      missing.push('CUDA runtime DLLs (cudart64_*.dll / cublas64_*.dll)')
    }
  }

  if (missing.length === 0) {
    if (cliBin) {
      try {
        cp.execFileSync(cliBin, ['--help'], { timeout: 3000 })
      } catch (e: any) {
        const code = e.status || e.code
        if (code === -1073741795 || code === 3221225501 || String(e).includes('0xc000001d')) {
          missing.push('Compatible CPU instruction build (detected 0xc000001d illegal instruction - AVX-512 not supported on this CPU)')
        }
      }
    }
  }

  if (missing.length === 0) {
    return { backendPath: current, version: currentVersion || 'current', repaired: false, details: `Backend is healthy (${accType.toUpperCase()} mode).` }
  }

  let details = `Detected issues: ${missing.join(', ')}. `

  const dlDir = path.join(root, '_downloads')
  fs.mkdirSync(dlDir, { recursive: true })

  // 1. If CUDA DLLs are missing, look for cudart zip in _downloads first
  if (missingCudaDlls) {
    const existingZips = fs.existsSync(dlDir) ? fs.readdirSync(dlDir).filter(f => f.endsWith('.zip')) : []
    const cudaMatch = currentVersion.match(/cuda(\d+(\.\d+)?)/i)?.[0] || 'cuda12.4'
    let cudartCandidate = existingZips.find(z => new RegExp(`cudart.*${cudaMatch}`, 'i').test(z)) ||
                          existingZips.find(z => /cudart.*cuda12\.4/i.test(z)) ||
                          existingZips.find(z => /cudart/i.test(z) || /cuda-runtime/i.test(z))

    if (cudartCandidate) {
      try {
        const zipPath = path.join(dlDir, cudartCandidate)
        const zip = new AdmZip(zipPath)
        zip.extractAllTo(current, true)
        if (currentVersion && currentVersion !== 'current') {
          const verDir = path.join(root, currentVersion)
          if (fs.existsSync(verDir)) zip.extractAllTo(verDir, true)
        }
        return {
          backendPath: current,
          version: currentVersion,
          repaired: true,
          details: details + `Successfully restored CUDA runtime DLLs from local archive ${cudartCandidate}.`
        }
      } catch (e: any) {
        details += `Local cudart extract failed: ${e.message}. `
      }
    }

    // Try GitHub download for companion cudart
    try {
      const releases = await fetchGithubReleases(10)
      for (const rel of releases) {
        let cudartAsset = rel.zipAssets.find(a => new RegExp(`cudart.*${cudaMatch}`, 'i').test(a.name)) ||
                            rel.zipAssets.find(a => /cudart.*cuda12\.4|cuda-runtime/i.test(a.name))
        if (cudartAsset) {
          const cudartZip = path.join(dlDir, cudartAsset.name)
          if (!fs.existsSync(cudartZip)) {
            await downloadFile(cudartAsset.url, cudartZip, onProgress)
          }
          const zip = new AdmZip(cudartZip)
          zip.extractAllTo(current, true)
          if (currentVersion && currentVersion !== 'current') {
            const verDir = path.join(root, currentVersion)
            if (fs.existsSync(verDir)) zip.extractAllTo(verDir, true)
          }
          return {
            backendPath: current,
            version: currentVersion,
            repaired: true,
            details: details + `Downloaded and installed companion CUDA runtime (${cudartAsset.name}).`
          }
        }
      }
    } catch (e: any) {
      details += `Online CUDA runtime fetch failed: ${e.message}. `
    }
  }

  // 2. If binaries are missing/corrupted or CPU illegal instruction:
  const existingZips = fs.existsSync(dlDir) ? fs.readdirSync(dlDir).filter(f => f.endsWith('.zip')) : []
  let zipCandidate: string | null = null

  if (missing.some(m => m.includes('illegal instruction'))) {
    zipCandidate = existingZips.find(z => /cuda12\.4.*bin.*windows/i.test(z)) ||
                   existingZips.find(z => /vulkan-portable/i.test(z)) ||
                   existingZips.find(z => /cpu-portable/i.test(z)) || null
    if (zipCandidate) {
      details += `Found compatible portable/CUDA archive ${zipCandidate}. `
    }
  }

  if (!zipCandidate && currentVersion) {
    zipCandidate = existingZips.find(z => z.includes(currentVersion) && !z.includes('cudart') && !z.includes('lib-')) || null
  }
  if (!zipCandidate) {
    zipCandidate = existingZips.find(z => /cuda12\.4.*bin.*windows/i.test(z)) ||
                   existingZips.find(z => /bin.*windows/i.test(z) && !z.includes('cudart') && !z.includes('lib-')) || null
  }

  if (zipCandidate) {
    const fullZip = path.join(dlDir, zipCandidate)
    try {
      const r = await importBackendFromZip(fullZip, dataRoot)
      if (/cuda/i.test(zipCandidate)) {
        const czCandidate = existingZips.find(z => /cudart/i.test(z))
        if (czCandidate) {
          const cz = new AdmZip(path.join(dlDir, czCandidate))
          cz.extractAllTo(r.backendPath, true)
        }
      }
      return {
        backendPath: r.backendPath,
        version: r.version,
        repaired: true,
        details: details + `Repaired by extracting ${zipCandidate}.`
      }
    } catch (e: any) {
      details += `Extraction failed: ${e.message}. `
    }
  }

  // Fallback: try GitHub
  try {
    const releases = await fetchGithubReleases(10)
    for (const rel of releases) {
      const targetAsset = rel.zipAssets.find(a => /bin-windows-x64-cuda12\.4/i.test(a.name)) ||
                          rel.zipAssets.find(a => /bin-windows-x64-vulkan-portable/i.test(a.name)) ||
                          rel.zipAssets.find(a => /bin-windows-x64-cpu-portable/i.test(a.name))
      if (targetAsset) {
        const dlRes = await downloadBackendFromUrl(targetAsset.url, dataRoot, onProgress)
        return {
          backendPath: dlRes.backendPath,
          version: dlRes.version,
          repaired: true,
          details: details + `Re-downloaded and installed ${targetAsset.name} from GitHub (${rel.tag}).`
        }
      }
    }
  } catch (e: any) {
    details += `GitHub download failed: ${e.message}. `
  }

  throw new Error(details + 'Could not auto-repair. In Settings → Fetch releases, select "CUDA 12.4" or "Vulkan (Portable)".')
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
        const code = (err as any)?.code ?? (err ? (err as any)?.status || 1 : 0)
        const ok = !err && (stdout.length > 0 || out.includes('audiocpp'))
        res({ok, code: typeof code==='number'? code: (err ? 1 : 0), out: out.slice(0,2000) || (err? err.message: '')})
      })
    })
  }
  const [cli, server] = await Promise.all([run(cliBin), run(srvBin)])
  let hint=''
  const dllCode = 3221225781
  const illegalInstructionCode = -1073741795 // 0xC000001D

  if (cli.code === illegalInstructionCode || server.code === illegalInstructionCode ||
      cli.out.includes('0xc000001d') || server.out.includes('0xc000001d')) {
    hint = 'Illegal instruction (0xC000001D): The active build was compiled with AVX-512 instructions not supported by your CPU (such as AMD Ryzen 5000 / Zen 3). Switch to the Vulkan-Portable or CUDA backend in Settings.'
  } else if(cli.code===dllCode || server.code===dllCode){
    const acc = getBackendAccelerationType(backendPath)
    if (acc === 'cuda') {
      const files = fs.existsSync(backendPath) ? fs.readdirSync(backendPath) : []
      const hasCudart = files.some(f => /cudart64_.*\.dll/i.test(f))
      const hasCublas = files.some(f => /cublas64_.*\.dll/i.test(f))
      if (!hasCudart || !hasCublas) {
        hint = 'CUDA runtime DLLs (cudart / cublas) are missing from the backend folder. Click "Repair backend" in Settings to auto-restore them, or select CUDA 12.4.'
      } else {
        hint = 'Missing system dependency (exit 3221225781). Install Microsoft VC++ 2015-2022 Redistributable: https://aka.ms/vs/17/release/vc_redist.x64.exe'
      }
    } else {
      const hasVCRuntime = fs.existsSync('C:\\Windows\\System32\\vcruntime140.dll')
      hint = hasVCRuntime ? 'DLL missing. If running CUDA, click "Repair backend" to install CUDA runtime DLLs. If running Vulkan, check your graphics driver.' : 'vcruntime140.dll missing — install VC++ Redist https://aka.ms/vs/17/release/vc_redist.x64.exe'
    }
  } else if (cli.ok && server.ok) {
    const acc = getBackendAccelerationType(backendPath)
    hint = `Backend verified: ${acc.toUpperCase()} hardware acceleration is ready.`
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
    const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy
    let agent: any = undefined
    if (proxy) {
      try {
        const { HttpsProxyAgent } = require('https-proxy-agent')
        agent = new HttpsProxyAgent(proxy)
      } catch {}
    }
    const opts = {
      hostname: 'api.github.com',
      path: `/repos/0xShug0/audio.cpp/releases?per_page=${limit}`,
      method: 'GET',
      headers: { 'User-Agent': 'audio-cpp-studio', 'Accept': 'application/vnd.github+json' },
      agent
    }
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

function downloadFile(url:string, dest:string, onProgress?:(pct:number, dl:number, total:number)=>void): Promise<void>{
  return new Promise((resolve,reject)=>{
    const https = require('https')
    const http = require('http')
    const file = fs.createWriteStream(dest)
    const client = url.startsWith('https') ? https : http
    const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy
    let agent: any = undefined
    if (proxy) {
      try {
        const { HttpsProxyAgent } = require('https-proxy-agent')
        agent = new HttpsProxyAgent(proxy)
      } catch {}
    }

    const doGet = (u:string)=>{
      const parsed = new URL(u)
      const options: any = {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: { 'User-Agent': 'audio-cpp-studio' },
        agent: u.startsWith('https') ? agent : undefined
      }
      client.get(options, (res:any)=>{
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
        file.on('finish', ()=> file.close(()=> resolve()))
        file.on('error', reject)
      }).on('error',reject)
    }
    doGet(url)
  })
}

export async function downloadBackendFromUrl(url:string, dataRoot:string, onProgress?:(pct:number, dl:number, total:number)=>void): Promise<{backendPath:string, version:string, zipPath:string}>{
  const tmpDir = path.join(dataRoot,'backend','_downloads')
  fs.mkdirSync(tmpDir,{recursive:true})
  const fileName = path.basename(new URL(url).pathname) || `backend_${Date.now()}.zip`
  const zipPath = path.join(tmpDir, fileName)

  if (!fs.existsSync(zipPath) || fs.statSync(zipPath).size === 0) {
    await downloadFile(url, zipPath, onProgress)
  }
  const r = await importBackendFromZip(zipPath, dataRoot)

  // If this is a CUDA backend zip, also auto-download/extract companion cudart runtime
  if (/cuda/i.test(fileName)) {
    const cudaMatch = fileName.match(/cuda(\d+(\.\d+)?)/i)?.[0] || 'cuda12.4'
    const dlZips = fs.existsSync(tmpDir) ? fs.readdirSync(tmpDir).filter(f => f.endsWith('.zip')) : []
    let localCudart = dlZips.find(z => new RegExp(`cudart.*${cudaMatch}`, 'i').test(z)) ||
                      dlZips.find(z => /cudart.*cuda12\.4/i.test(z)) ||
                      dlZips.find(z => /cudart/i.test(z) || /cuda-runtime/i.test(z))

    if (!localCudart) {
      try {
        const releases = await fetchGithubReleases(10)
        for (const rel of releases) {
          const cudartAsset = rel.zipAssets.find(a => new RegExp(`cudart.*${cudaMatch}`, 'i').test(a.name)) ||
                              rel.zipAssets.find(a => /cudart.*cuda12\.4|cuda-runtime/i.test(a.name))
          if (cudartAsset) {
            const targetZip = path.join(tmpDir, cudartAsset.name)
            if (!fs.existsSync(targetZip)) {
              await downloadFile(cudartAsset.url, targetZip)
            }
            localCudart = cudartAsset.name
            break
          }
        }
      } catch {}
    }

    if (localCudart) {
      try {
        const cz = new AdmZip(path.join(tmpDir, localCudart))
        cz.extractAllTo(r.backendPath, true)
        const verDir = path.join(dataRoot, 'backend', r.version)
        if (fs.existsSync(verDir)) cz.extractAllTo(verDir, true)
      } catch {}
    }
  }

  return { backendPath: r.backendPath, version: r.version, zipPath }
}
