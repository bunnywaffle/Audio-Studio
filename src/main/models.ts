import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'
import * as http from 'http'

// Curated registry — mirrors audio.cpp model_specs, subset for UI
export interface ModelEntry {
  id: string
  family: string
  label: string
  task: 'tts'|'clone'|'vc'|'asr'|'music'|'sep'|'vad'|'diar'|'codec'|'other'
  description: string
  language: string
  size: string // e.g. "357M"
  runtime: string // GGUF 16 Q8 etc
  hfRepo?: string
  hfFile?: string
  installed?: boolean
  localPath?: string
}

export const CURATED_MODELS: ModelEntry[] = [
  // TTS
  { id:'pocket_tts', family:'pocket_tts', label:'PocketTTS 100M', task:'tts', description:'Fast multilingual TTS + cloning (en,de,it,pt,es)', language:'multi', size:'100M', runtime:'GGUF 16/Q8', hfRepo:'audio-cpp/audio.cpp-gguf', hfFile:'pocket_tts/pocket_tts_q8.gguf' },
  { id:'qwen3_tts_0.6b', family:'qwen3_tts', label:'Qwen3-TTS 0.6B', task:'tts', description:'12Hz voice design + cloning', language:'zh,en,ja,ko...', size:'0.6B', runtime:'GGUF 16/Q8' },
  { id:'qwen3_tts_1.7b', family:'qwen3_tts', label:'Qwen3-TTS 1.7B', task:'tts', description:'High fidelity multilingual', language:'10 langs', size:'1.7B', runtime:'GGUF 16/Q8' },
  { id:'supertonic', family:'supertonic', label:'Supertonic 3', task:'tts', description:'Ultra fast ~200x RT, streaming', language:'32 langs', size:'?', runtime:'GGUF F32 Stream' },
  { id:'vibevoice_1.5b', family:'vibevoice', label:'VibeVoice 1.5B', task:'tts', description:'Long-form dialogue/podcast', language:'en,zh', size:'1.5B', runtime:'GGUF 16/Q8' },
  { id:'magpie_tts', family:'magpie_tts', label:'MagpieTTS 357M', task:'tts', description:'NVIDIA baked voices + NanoCodec', language:'13 langs', size:'357M', runtime:'GGUF Q8' },
  { id:'fish_audio_s2', family:'fish_audio', label:'Fish Audio S2 Pro', task:'tts', description:'Expressive cloning', language:'zh,en', size:'?', runtime:'GGUF 16/Q8' },
  { id:'higgs_audio', family:'higgs_audio_tts', label:'Higgs Audio v3 4B', task:'tts', description:'High quality cloning', language:'auto', size:'4B', runtime:'GGUF 16/Q8' },
  { id:'index_tts2', family:'index_tts2', label:'IndexTTS2 / 2.5', task:'tts', description:'Emotion/style controlled', language:'zh,en,ja...', size:'?', runtime:'GGUF 16/Q8' },
  { id:'chatterbox', family:'chatterbox', label:'Chatterbox 0.5B', task:'tts', description:'18 lang TTS/VC', language:'multi', size:'0.5B', runtime:'GGUF 16/Q8' },
  // Music
  { id:'ace_step_turbo', family:'ace_step', label:'ACE-Step 1.5 Turbo', task:'music', description:'Text-to-music + lyrics + edit', language:'50+ langs', size:'1.7B', runtime:'GGUF 16' },
  { id:'stable_audio_small', family:'stable_audio', label:'Stable Audio 3 Small', task:'music', description:'Music & SFX', language:'en', size:'?', runtime:'GGUF 16/Q8' },
  { id:'minimax_music3', family:'minimax_music3', label:'MiniMax Music 3', task:'music', description:'Lyrics-conditioned music', language:'auto', size:'?', runtime:'GGUF Q4/Q8' },
  { id:'heartmula', family:'heartmula', label:'HeartMuLa 3B', task:'music', description:'Song generation', language:'zh,en,ja...', size:'3B', runtime:'GGUF 16/Q8' },
  // ASR
  { id:'qwen3_asr_0.6b', family:'qwen3_asr', label:'Qwen3-ASR 0.6B', task:'asr', description:'Fast streaming ASR', language:'30 langs', size:'0.6B', runtime:'GGUF 16/Q8 Stream' },
  { id:'qwen3_asr_1.7b', family:'qwen3_asr', label:'Qwen3-ASR 1.7B', task:'asr', description:'High accuracy', language:'30 langs', size:'1.7B', runtime:'GGUF 16/Q8' },
  { id:'parakeet_tdt', family:'parakeet_tdt', label:'Parakeet-TDT 0.6B v3', task:'asr', description:'Multilingual long-form', language:'25 langs', size:'0.6B', runtime:'GGUF F32/16/Q8 Stream' },
  { id:'fun_asr_nano', family:'fun_asr_nano', label:'Fun-ASR-Nano', task:'asr', description:'Auto zh/en/ja', language:'auto', size:'?', runtime:'GGUF 16/Q8' },
  { id:'voxtral_realtime', family:'voxtral_realtime', label:'Voxtral Mini 4B Realtime', task:'asr', description:'Low latency realtime', language:'auto', size:'4B', runtime:'GGUF 16/Q8/Q4 Stream' },
  { id:'nemotron_asr', family:'nemotron_asr', label:'Nemotron 3.5 ASR 0.6B', task:'asr', description:'100+ prompt codes streaming', language:'100+', size:'0.6B', runtime:'GGUF 16/Q8 Stream' },
  { id:'sense_voice_small', family:'sense_asr', label:'SenseVoice Small', task:'asr', description:'Event/emotion tags', language:'auto', size:'?', runtime:'GGUF Q8 Stream' },
  // VAD / other
  { id:'silero_vad', family:'silero_vad', label:'Silero VAD', task:'vad', description:'Voice activity - bundled', language:'agnostic', size:'tiny', runtime:'Bundled Stream' },
  { id:'marblenet_vad', family:'marblenet_vad', label:'MarbleNet VAD', task:'vad', description:'Bundled', language:'agnostic', size:'tiny', runtime:'Bundled' },
  { id:'htdemucs', family:'htdemucs', label:'HTDemucs', task:'sep', description:'Source separation', language:'agnostic', size:'?', runtime:'GGUF 16/Q8' },
]

export function getModelsDir(dataRoot:string){ return path.join(dataRoot,'models') }
export function getModelPath(dataRoot:string, id:string){ return path.join(getModelsDir(dataRoot), id) }

export function scanInstalled(dataRoot:string): ModelEntry[] {
  const dir = getModelsDir(dataRoot)
  if (!fs.existsSync(dir)) return []
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

// Simple download helper with progress callback — downloads single file into model folder
export function downloadFile(url:string, dest:string, onProgress:(pct:number, downloaded:number, total:number)=>void): Promise<void> {
  return new Promise((resolve,reject)=>{
    const file = fs.createWriteStream(dest)
    const client = url.startsWith('https') ? https : http
    client.get(url, res=>{
      if (res.statusCode && res.statusCode>=300 && res.statusCode<400 && res.headers.location){
        file.close(); fs.unlinkSync(dest)
        downloadFile(res.headers.location, dest, onProgress).then(resolve).catch(reject); return
      }
      if (res.statusCode!==200){ reject(new Error(`HTTP ${res.statusCode} for ${url}`)); return }
      const total = parseInt(res.headers['content-length']||'0',10)
      let downloaded=0
      res.on('data', (chunk:Buffer)=>{
        downloaded+=chunk.length
        if (total) onProgress(Math.round(downloaded/total*100), downloaded, total)
      })
      res.pipe(file)
      file.on('finish',()=> file.close(()=> resolve()))
      file.on('error', reject)
    }).on('error', reject)
  })
}
