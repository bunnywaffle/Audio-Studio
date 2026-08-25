import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'
import * as http from 'http'

export interface ModelEntry {
  id: string
  family: string
  label: string
  task: 'tts'|'clone'|'vc'|'asr'|'music'|'sep'|'vad'|'diar'|'codec'|'other'
  description: string
  language: string
  size: string
  runtime: string
  hfFolder?: string
  hfFile?: string
  hfRepo?: string
  installed?: boolean
  localPath?: string
}

export const CURATED_MODELS: ModelEntry[] = [
  { id:'pocket_tts', family:'pocket_tts', label:'PocketTTS 100M', task:'tts', description:'Fast multilingual TTS + cloning (en,de,it,pt,es)', language:'multi', size:'100M', runtime:'GGUF 16/Q8', hfFolder:'PocketTTS-GGUF' },
  { id:'qwen3_tts_0.6b', family:'qwen3_tts', label:'Qwen3-TTS 0.6B', task:'tts', description:'12Hz voice design + cloning', language:'zh,en,ja,ko...', size:'0.6B', runtime:'GGUF 16/Q8', hfFolder:'Qwen3-TTS-12Hz-0.6B-Base-GGUF' },
  { id:'qwen3_tts_1.7b', family:'qwen3_tts', label:'Qwen3-TTS 1.7B', task:'tts', description:'High fidelity multilingual', language:'10 langs', size:'1.7B', runtime:'GGUF 16/Q8', hfFolder:'Qwen3-TTS-12Hz-0.6B-Base-GGUF' },
  { id:'supertonic', family:'supertonic', label:'Supertonic 3', task:'tts', description:'Ultra fast ~200x RT, streaming', language:'32 langs', size:'?', runtime:'GGUF F32 Stream' },
  { id:'vibevoice_1.5b', family:'vibevoice', label:'VibeVoice 1.5B', task:'tts', description:'Long-form dialogue/podcast', language:'en,zh', size:'1.5B', runtime:'GGUF 16/Q8' },
  { id:'magpie_tts', family:'magpie_tts', label:'MagpieTTS 357M', task:'tts', description:'NVIDIA baked voices + NanoCodec', language:'13 langs', size:'357M', runtime:'GGUF Q8', hfFolder:'MagpieTTS-Multilingual-357M-GGUF' },
  { id:'fish_audio_s2', family:'fish_audio', label:'Fish Audio S2 Pro', task:'tts', description:'Expressive cloning', language:'zh,en', size:'?', runtime:'GGUF 16/Q8', hfFolder:'Fish-Audio-S2-Pro-GGUF' },
  { id:'higgs_audio', family:'higgs_audio_tts', label:'Higgs Audio v3 4B', task:'tts', description:'High quality cloning', language:'auto', size:'4B', runtime:'GGUF 16/Q8', hfFolder:'Higgs-Audio-v3-TTS-4B-GGUF' },
  { id:'index_tts2', family:'index_tts2', label:'IndexTTS2 / 2.5', task:'tts', description:'Emotion/style controlled', language:'zh,en,ja...', size:'?', runtime:'GGUF 16/Q8', hfFolder:'IndexTTS2-GGUF' },
  { id:'chatterbox', family:'chatterbox', label:'Chatterbox 0.5B', task:'tts', description:'18 lang TTS/VC', language:'multi', size:'0.5B', runtime:'GGUF 16/Q8', hfFolder:'Chatterbox-GGUF' },
  { id:'ace_step_turbo', family:'ace_step', label:'ACE-Step 1.5 Turbo', task:'music', description:'Text-to-music + lyrics + edit', language:'50+ langs', size:'1.7B', runtime:'GGUF 16', hfFolder:'ACE-Step1.5-GGUF' },
  { id:'stable_audio_small', family:'stable_audio', label:'Stable Audio 3 Small', task:'music', description:'Music & SFX', language:'en', size:'?', runtime:'GGUF 16/Q8' },
  { id:'minimax_music3', family:'minimax_music3', label:'MiniMax Music 3', task:'music', description:'Lyrics-conditioned music', language:'auto', size:'?', runtime:'GGUF Q4/Q8' },
  { id:'heartmula', family:'heartmula', label:'HeartMuLa 3B', task:'music', description:'Song generation', language:'zh,en,ja...', size:'3B', runtime:'GGUF 16/Q8', hfFolder:'HeartMuLa-GGUF' },
  { id:'qwen3_asr_0.6b', family:'qwen3_asr', label:'Qwen3-ASR 0.6B', task:'asr', description:'Fast streaming ASR', language:'30 langs', size:'0.6B', runtime:'GGUF 16/Q8 Stream', hfFolder:'Qwen3-ASR-0.6B-GGUF' },
  { id:'qwen3_asr_1.7b', family:'qwen3_asr', label:'Qwen3-ASR 1.7B', task:'asr', description:'High accuracy', language:'30 langs', size:'1.7B', runtime:'GGUF 16/Q8', hfFolder:'Qwen3-ASR-1.7B-GGUF' },
  { id:'parakeet_tdt', family:'parakeet_tdt', label:'Parakeet-TDT 0.6B v3', task:'asr', description:'Multilingual long-form', language:'25 langs', size:'0.6B', runtime:'GGUF F32/16/Q8 Stream', hfFolder:'Parakeet-TDT-0.6B-v3-GGUF' },
  { id:'fun_asr_nano', family:'fun_asr_nano', label:'Fun-ASR-Nano', task:'asr', description:'Auto zh/en/ja', language:'auto', size:'?', runtime:'GGUF 16/Q8', hfFolder:'Fun-ASR-Nano-2512-GGUF' },
  { id:'voxtral_realtime', family:'voxtral_realtime', label:'Voxtral Mini 4B Realtime', task:'asr', description:'Low latency realtime', language:'auto', size:'4B', runtime:'GGUF 16/Q8/Q4 Stream' },
  { id:'nemotron_asr', family:'nemotron_asr', label:'Nemotron 3.5 ASR 0.6B', task:'asr', description:'100+ prompt codes streaming', language:'100+', size:'0.6B', runtime:'GGUF 16/Q8 Stream', hfFolder:'Nemotron-3.5-ASR-Streaming-0.6B-GGUF' },
  { id:'sense_voice_small', family:'sense_asr', label:'SenseVoice Small', task:'asr', description:'Event/emotion tags', language:'auto', size:'?', runtime:'GGUF Q8 Stream' },
  { id:'silero_vad', family:'silero_vad', label:'Silero VAD', task:'vad', description:'Voice activity - bundled', language:'agnostic', size:'tiny', runtime:'Bundled Stream' },
  { id:'marblenet_vad', family:'marblenet_vad', label:'MarbleNet VAD', task:'vad', description:'Bundled', language:'agnostic', size:'tiny', runtime:'Bundled' },
  { id:'htdemucs', family:'htdemucs', label:'HTDemucs', task:'sep', description:'Source separation', language:'agnostic', size:'?', runtime:'GGUF 16/Q8', hfFolder:'HTDemucs-GGUF' },
]

export const HF_REPO = 'audio-cpp/audio.cpp-gguf'
export const HF_BASE = `https://huggingface.co/${HF_REPO}/resolve/main`

export function getModelsDir(dataRoot:string){ return path.join(dataRoot,'models') }
export function getModelPath(dataRoot:string, id:string){ return path.join(getModelsDir(dataRoot), id) }

export function scanInstalled(dataRoot:string): ModelEntry[] {
  const dir = getModelsDir(dataRoot)
  if (!fs.existsSync(dir)) return CURATED_MODELS.map(m=>({...m, installed:false}))
  const installedIds = new Set(fs.readdirSync(dir))
  return CURATED_MODELS.map(m=>{
    const p = getModelPath(dataRoot, m.id)
    const installed = installedIds.has(m.id) && fs.existsSync(p) && fs.readdirSync(p).length>0
    return {...m, installed, localPath: installed ? p : undefined}
  })
}

export function deleteModel(dataRoot:string, id:string){
  const p = getModelPath(dataRoot,id)
  if (fs.existsSync(p)) fs.rmSync(p,{recursive:true,force:true})
}

export function downloadFile(url:string, dest:string, onProgress:(pct:number, downloaded:number, total:number)=>void): Promise<void> {
  return new Promise((resolve,reject)=>{
    const file = fs.createWriteStream(dest)
    const client = url.startsWith('https') ? https : http
    const doGet = (u:string)=>{
      client.get(u, {headers:{'User-Agent':'audio-cpp-studio'} as any}, (res:any)=>{
        if (res.statusCode && res.statusCode>=300 && res.statusCode<400 && res.headers.location){
          res.resume()
          doGet(res.headers.location)
          return
        }
        if (res.statusCode!==200){ reject(new Error(`HTTP ${res.statusCode} for ${u}`)); return }
        const total = parseInt(res.headers['content-length']||'0',10)
        let downloaded=0
        res.on('data', (chunk:Buffer)=>{
          downloaded+=chunk.length
          if (total) onProgress(Math.round(downloaded/total*100), downloaded, total)
          else onProgress(0, downloaded, total)
        })
        res.pipe(file)
        file.on('finish',()=> file.close(()=> resolve()))
        file.on('error', reject)
      }).on('error', reject)
    }
    doGet(url)
  })
}

export function fetchHfFolderFiles(folder:string): Promise<Array<{path:string, size:number}>>{
  const fetchOne = (p:string): Promise<Array<{path:string,size:number, type:string}>>=>{
    return new Promise((resolve,reject)=>{
      const url = `https://huggingface.co/api/models/${HF_REPO}/tree/main/${encodeURIComponent(p)}`
      https.get(url, {headers:{'User-Agent':'audio-cpp-studio'} as any}, (res:any)=>{
        let data=''
        res.on('data',(c:any)=> data+=c)
        res.on('end',()=>{
          if(res.statusCode!==200) return reject(new Error(`HF API ${res.statusCode}: ${data.slice(0,300)}`))
          try{ resolve(JSON.parse(data)) }catch(e){ reject(e) }
        })
      }).on('error',reject)
    })
  }
  const collect = async (p:string, depth=0):Promise<Array<{path:string,size:number}>>=>{
    if(depth>3) return []
    const entries:any[] = await fetchOne(p)
    const files = entries.filter(x=> x.type==='file' && x.path.endsWith('.gguf')).map(x=>({path:x.path, size:x.size||0}))
    const dirs = entries.filter(x=> x.type==='directory')
    if(dirs.length===0) return files
    const nested = await Promise.all(dirs.map(d=> collect(d.path, depth+1)))
    return files.concat(...nested)
  }
  return collect(folder)
}

export async function resolveHfDownloadUrl(modelId:string): Promise<{url:string, fileName:string, size?:number}>{
  const entry = CURATED_MODELS.find(m=> m.id===modelId)
  if(entry && entry.hfFile){
    const p = entry.hfFile.startsWith(entry.hfFolder||'') ? entry.hfFile : `${entry.hfFolder}/${entry.hfFile}`
    return {url:`${HF_BASE}/${p}`, fileName: path.basename(p)}
  }
  if(entry && entry.hfFolder){
    const files = await fetchHfFolderFiles(entry.hfFolder)
    if(files.length===0) throw new Error(`No .gguf found in ${entry.hfFolder} — browse https://huggingface.co/${HF_REPO}/tree/main/${entry.hfFolder}`)
    const q8 = files.find(f=> /q8/i.test(f.path))
    const chosen = q8 || files.sort((a,b)=> a.size-b.size)[0]
    return {url:`${HF_BASE}/${chosen.path}`, fileName: path.basename(chosen.path), size: chosen.size}
  }
  // Fallback: treat modelId as raw HF folder name (for dynamic HF models)
  if(!entry){
    const folder = modelId // id is folder name like PocketTTS-GGUF
    const files = await fetchHfFolderFiles(folder)
    if(files.length===0) throw new Error(`No .gguf in ${folder}`)
    const q8 = files.find(f=> /q8/i.test(f.path))
    const chosen = q8 || files.sort((a,b)=> a.size-b.size)[0]
    return {url:`${HF_BASE}/${chosen.path}`, fileName: path.basename(chosen.path), size: chosen.size}
  }
  throw new Error(`Model ${modelId} has no HF mapping — check https://huggingface.co/${HF_REPO}/tree/main`)
}

export function fetchAllHfFolders(): Promise<Array<{folder:string}>>{
  return new Promise((resolve,reject)=>{
    const url = `https://huggingface.co/api/models/${HF_REPO}/tree/main`
    https.get(url, {headers:{'User-Agent':'audio-cpp-studio'} as any}, (res:any)=>{
      let data=''
      res.on('data',(c:any)=> data+=c)
      res.on('end',()=>{
        if(res.statusCode!==200) return reject(new Error(`HF API ${res.statusCode}: ${data.slice(0,500)}`))
        try{
          const j = JSON.parse(data)
          const dirs = j.filter((x:any)=> x.type==='directory').map((x:any)=>({folder: x.path}))
          resolve(dirs)
        }catch(e){ reject(e)}
      })
    }).on('error',reject)
  })
}
