import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'
import * as http from 'http'
import * as cp from 'child_process'

export interface ModelCapabilities {
  supportsVoiceClone: boolean
  requiresVoiceClone: boolean
  requiresReferenceText: boolean
  supportsVoiceInstruct: boolean
  supportsPresetVoices: boolean
  presetVoices?: string[]
}

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
  primaryGguf?: string
  ggufFiles?: string[]
  capabilities?: ModelCapabilities
}

export interface DynamicModelSpec {
  family: string
  variant: string
  supportedTasks: string[]
  supportsSpeakerReference: boolean
  supportsStyleCondition: boolean
  supportsTimestamps: boolean
  languages: string[]
}

export function inspectModelWithCli(cliBin: string, modelGgufPath: string): DynamicModelSpec | null {
  if (!cliBin || !fs.existsSync(cliBin) || !modelGgufPath || !fs.existsSync(modelGgufPath)) return null
  try {
    const res = cp.spawnSync(cliBin, ['--model', modelGgufPath, '--inspect'], {
      timeout: 3500,
      encoding: 'utf-8',
      windowsHide: true
    })
    const out = (res.stdout || '') + (res.stderr || '')
    if (!out.includes('family=')) return null

    let family = ''
    let variant = ''
    const tasks: string[] = []
    let supportsSpeakerReference = false
    let supportsStyleCondition = false
    let supportsTimestamps = false
    let languages: string[] = []

    const lines = out.split(/\r?\n/)
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith('family=')) family = trimmed.slice(7).trim()
      else if (trimmed.startsWith('variant=')) variant = trimmed.slice(8).trim()
      else if (trimmed.startsWith('task=')) {
        const tMatch = trimmed.match(/^task=([a-z0-9_]+)/i)
        if (tMatch && !tasks.includes(tMatch[1])) tasks.push(tMatch[1])
      }
      else if (trimmed.startsWith('supports_speaker_reference=')) {
        supportsSpeakerReference = trimmed.includes('true')
      }
      else if (trimmed.startsWith('supports_style_condition=')) {
        supportsStyleCondition = trimmed.includes('true')
      }
      else if (trimmed.startsWith('supports_timestamps=')) {
        supportsTimestamps = trimmed.includes('true')
      }
      else if (trimmed.startsWith('languages=')) {
        languages = trimmed.slice(10).split(',').map(s => s.trim()).filter(Boolean)
      }
    }

    if (!family) return null
    return {
      family,
      variant,
      supportedTasks: tasks,
      supportsSpeakerReference,
      supportsStyleCondition,
      supportsTimestamps,
      languages
    }
  } catch {
    return null
  }
}

export function getModelCapabilities(family: string, modelId?: string, spec?: DynamicModelSpec | null): ModelCapabilities {
  const fam = (spec?.family || family || '').toLowerCase().trim()
  const id = (modelId || '').toLowerCase().trim()
  const variant = (spec?.variant || '').toLowerCase().trim()

  // Voice cloning (WAV sample / prompt)
  const supportsVoiceClone = spec ? (spec.supportsSpeakerReference || spec.supportedTasks.includes('clon')) : (
    [
      'pocket_tts', 'qwen3_tts', 'fish_audio', 'higgs_audio_tts', 'index_tts2',
      'chatterbox', 'dramabox', 'dots_tts', 'fireredtts3', 'firered_audio',
      'f5_tts', 'glm_tts', 'moss_tts_local', 'moss_tts_nano', 'omnivoice', 'voxcpm2'
    ].includes(fam) || id.includes('clone')
  )

  // Pure ICL voice clone models that REQUIRE a reference voice sample and will abort without one
  const requiresVoiceClone = spec
    ? (spec.supportsSpeakerReference && (variant.includes('base') || (fam === 'qwen3_tts' && !variant.includes('custom') && !variant.includes('design'))))
    : ((fam === 'qwen3_tts' && !id.includes('customvoice') && !id.includes('voicedesign')) || fam === 'glm_tts')

  // Requires exact reference transcript for ICL voice cloning
  const requiresReferenceText = spec
    ? (requiresVoiceClone || fam === 'qwen3_tts' || fam === 'glm_tts' || fam === 'fireredtts3')
    : ((fam === 'qwen3_tts' && !id.includes('customvoice') && !id.includes('voicedesign')) || fam === 'glm_tts' || fam === 'fireredtts3')

  // Supports natural language voice instructions
  const supportsVoiceInstruct = spec
    ? (variant.includes('design') || variant.includes('instruct') || spec.supportedTasks.includes('vdes'))
    : (['qwen3_tts', 'fireredtts3', 'irodori_tts', 'moss_voicegen', 'omnivoice', 'voxcpm2'].includes(fam) || id.includes('instruct') || id.includes('voicedesign'))

  // Supports named preset voices
  const supportsPresetVoices = ['supertonic', 'neutts', 'magpie_tts', 'pocket_tts', 'qwen3_tts', 'confucius4_tts'].includes(fam)

  let presetVoices: string[] | undefined
  if (fam === 'supertonic') presetVoices = ['alba', 'calm_male', 'calm_female', 'energetic', 'narrator']
  else if (fam === 'pocket_tts') presetVoices = ['speaker_1', 'speaker_2', 'speaker_3']
  else if (fam === 'magpie_tts') presetVoices = ['magpie_en_male', 'magpie_en_female']

  return {
    supportsVoiceClone,
    requiresVoiceClone,
    requiresReferenceText,
    supportsVoiceInstruct,
    supportsPresetVoices,
    presetVoices
  }
}

export function ensureDefaultReferenceVoice(dataRoot: string): string {
  const voicesDir = path.join(dataRoot, 'voices')
  fs.mkdirSync(voicesDir, { recursive: true })
  const defaultWav = path.join(voicesDir, 'default_reference.wav')
  if (fs.existsSync(defaultWav) && fs.statSync(defaultWav).size > 1000) {
    return defaultWav
  }

  // Generate a valid 16kHz mono 16-bit PCM WAV (sine sweep tone, 2.5s)
  const sampleRate = 16000
  const durationSec = 2.5
  const numSamples = Math.floor(sampleRate * durationSec)
  const bytesPerSample = 2
  const dataSize = numSamples * bytesPerSample
  const buffer = Buffer.alloc(44 + dataSize)

  // RIFF header
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28)
  buffer.writeUInt16LE(bytesPerSample, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate
    const envelope = Math.sin((Math.PI * i) / numSamples)
    const val = 0.5 * Math.sin(2 * Math.PI * 220 * t) + 0.3 * Math.sin(2 * Math.PI * 440 * t) + 0.1 * Math.sin(2 * Math.PI * 880 * t)
    const sample = Math.floor(val * envelope * 20000)
    buffer.writeInt16LE(sample, 44 + i * 2)
  }

  try {
    fs.writeFileSync(defaultWav, buffer)
  } catch {}
  return defaultWav
}

export interface ResolvedInstalledModel {
  installed: boolean
  modelId: string
  modelDir: string
  ggufPath: string | null
  ggufDir: string | null
  family: string
  task: 'tts'|'clone'|'vc'|'asr'|'music'|'sep'|'vad'|'diar'|'codec'|'other'
  files: string[]
  primaryFileName: string | null
}

export const CURATED_MODELS: ModelEntry[] = [
  { id:'pocket_tts', family:'pocket_tts', label:'PocketTTS 100M', task:'tts', description:'Fast multilingual TTS + cloning (en,de,it,pt,es)', language:'multi', size:'100M', runtime:'GGUF 16/Q8', hfFolder:'PocketTTS-GGUF' },
  { id:'qwen3_tts_0.6b', family:'qwen3_tts', label:'Qwen3-TTS 0.6B', task:'tts', description:'12Hz voice design + cloning', language:'zh,en,ja,ko...', size:'0.6B', runtime:'GGUF 16/Q8', hfFolder:'Qwen3-TTS-12Hz-0.6B-Base-GGUF' },
  { id:'qwen3_tts_1.7b', family:'qwen3_tts', label:'Qwen3-TTS 1.7B', task:'tts', description:'High fidelity multilingual', language:'10 langs', size:'1.7B', runtime:'GGUF 16/Q8', hfFolder:'Qwen3-TTS-12Hz-1.7B-Base-GGUF' },
  { id:'supertonic', family:'supertonic', label:'Supertonic 3', task:'tts', description:'Ultra fast ~200x RT, streaming', language:'32 langs', size:'?', runtime:'GGUF F32 Stream', hfFolder:'Supertonic-3-GGUF' },
  { id:'vibevoice_1.5b', family:'vibevoice', label:'VibeVoice 1.5B', task:'tts', description:'Long-form dialogue/podcast', language:'en,zh', size:'1.5B', runtime:'GGUF 16/Q8', hfFolder:'VibeVoice-1.5B-GGUF' },
  { id:'magpie_tts', family:'magpie_tts', label:'MagpieTTS 357M', task:'tts', description:'NVIDIA baked voices + NanoCodec', language:'13 langs', size:'357M', runtime:'GGUF Q8', hfFolder:'MagpieTTS-Multilingual-357M-GGUF' },
  { id:'fish_audio_s2', family:'fish_audio', label:'Fish Audio S2 Pro', task:'tts', description:'Expressive cloning', language:'zh,en', size:'?', runtime:'GGUF 16/Q8', hfFolder:'Fish-Audio-S2-Pro-GGUF' },
  { id:'higgs_audio', family:'higgs_audio_tts', label:'Higgs Audio v3 4B', task:'tts', description:'High quality cloning', language:'auto', size:'4B', runtime:'GGUF 16/Q8', hfFolder:'Higgs-Audio-v3-TTS-4B-GGUF' },
  { id:'index_tts2', family:'index_tts2', label:'IndexTTS2 / 2.5', task:'tts', description:'Emotion/style controlled', language:'zh,en,ja...', size:'?', runtime:'GGUF 16/Q8', hfFolder:'IndexTTS2-GGUF' },
  { id:'chatterbox', family:'chatterbox', label:'Chatterbox 0.5B', task:'tts', description:'18 lang TTS/VC', language:'multi', size:'0.5B', runtime:'GGUF 16/Q8', hfFolder:'Chatterbox-GGUF' },
  { id:'ace_step_turbo', family:'ace_step', label:'ACE-Step 1.5 Turbo', task:'music', description:'Text-to-music + lyrics + edit', language:'50+ langs', size:'1.7B', runtime:'GGUF 16', hfFolder:'ACE-Step1.5-GGUF' },
  { id:'stable_audio_small', family:'stable_audio', label:'Stable Audio 3 Small Music', task:'music', description:'Music generation', language:'en', size:'?', runtime:'GGUF 16/Q8', hfFolder:'Stable-Audio-3-Small-Music-GGUF' },
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

/**
 * Recursively search for all .gguf files inside a directory (up to maxDepth)
 */
export function findAllGgufFiles(dirPath: string, maxDepth = 4): string[] {
  if (!fs.existsSync(dirPath)) return []
  try {
    const stat = fs.statSync(dirPath)
    if (stat.isFile()) {
      return dirPath.toLowerCase().endsWith('.gguf') ? [dirPath] : []
    }
  } catch { return [] }

  const results: string[] = []
  function walk(current: string, depth: number) {
    if (depth > maxDepth) return
    try {
      const entries = fs.readdirSync(current)
      for (const e of entries) {
        const full = path.join(current, e)
        try {
          const st = fs.statSync(full)
          if (st.isDirectory()) {
            walk(full, depth + 1)
          } else if (st.isFile() && e.toLowerCase().endsWith('.gguf')) {
            results.push(full)
          }
        } catch {}
      }
    } catch {}
  }
  walk(dirPath, 0)
  return results
}

/**
 * Automatically resolve family name for audio.cpp CLI
 */
export function resolveModelFamily(modelId: string, userFamily?: string, localPath?: string): string {
  if (userFamily && userFamily.trim() && userFamily !== 'other') {
    return userFamily.trim()
  }

  const curated = CURATED_MODELS.find(m => m.id === modelId)
  if (curated && curated.family) return curated.family

  const combined = `${modelId} ${localPath ? path.basename(localPath) : ''}`.toLowerCase()

  // Music / Generation
  if (combined.includes('ace_step') || combined.includes('acestep') || combined.includes('ace-step')) return 'ace_step'
  if (combined.includes('stable_audio') || combined.includes('stable-audio') || combined.includes('stableaudio')) return 'stable_audio'
  if (combined.includes('minimax') || combined.includes('minimax_music') || combined.includes('minimax-music')) return 'minimax_music3'
  if (combined.includes('heartmula') || combined.includes('heart_mula') || combined.includes('heart-mula')) return 'heartmula'
  if (combined.includes('dramabox')) return 'dramabox'
  if (combined.includes('controlfoley')) return 'controlfoley'
  if (combined.includes('audiosr')) return 'audiosr'

  // TTS
  if (combined.includes('pocket_tts') || combined.includes('pocket-tts') || combined.includes('pockettts')) return 'pocket_tts'
  if (combined.includes('qwen3_tts') || combined.includes('qwen3-tts') || combined.includes('qwen_tts')) return 'qwen3_tts'
  if (combined.includes('supertonic')) return 'supertonic'
  if (combined.includes('vibevoice') || combined.includes('vibe_voice') || combined.includes('vibe-voice')) return 'vibevoice'
  if (combined.includes('magpie')) return 'magpie_tts'
  if (combined.includes('fish_audio') || combined.includes('fish-audio') || combined.includes('fishaudio')) return 'fish_audio'
  if (combined.includes('higgs')) return 'higgs_audio_tts'
  if (combined.includes('index_tts') || combined.includes('index-tts') || combined.includes('indextts')) return 'index_tts2'
  if (combined.includes('chatterbox')) return 'chatterbox'
  if (combined.includes('confucius')) return 'confucius4_tts'
  if (combined.includes('dots_tts') || combined.includes('dot_tts') || combined.includes('dottts')) return 'dots_tts'

  // ASR
  if (combined.includes('qwen3_asr') || combined.includes('qwen3-asr') || combined.includes('qwen_asr')) return 'qwen3_asr'
  if (combined.includes('parakeet')) return 'parakeet_tdt'
  if (combined.includes('fun_asr') || combined.includes('fun-asr') || combined.includes('funasr')) return 'fun_asr_nano'
  if (combined.includes('nemotron')) return 'nemotron_asr'
  if (combined.includes('voxtral')) return 'voxtral_realtime'
  if (combined.includes('sense_voice') || combined.includes('sensevoice') || combined.includes('sense_asr')) return 'sense_asr'
  if (combined.includes('citrinet')) return 'citrinet_asr'

  // Separation / VAD
  if (combined.includes('htdemucs') || combined.includes('demucs')) return 'htdemucs'
  if (combined.includes('roformer') || combined.includes('bs_roformer')) return 'bs_roformer'
  if (combined.includes('silero')) return 'silero_vad'
  if (combined.includes('marblenet')) return 'marblenet_vad'
  if (combined.includes('miocodec')) return 'miocodec'

  // Clean fallback: sanitize id
  return modelId.replace(/[-_](gguf|turbo|base|0\.6b|1\.7b|1\.5b|3b|4b|v3|small|orig|q8_0|q4_k)$/i, '').replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || modelId
}

/**
 * Automatically resolve task for a model
 */
export function resolveModelTask(modelId: string, family?: string, userTask?: string, localPath?: string): 'tts'|'clone'|'vc'|'asr'|'music'|'sep'|'vad'|'diar'|'codec'|'other' {
  if (userTask && ['tts','clone','vc','asr','music','sep','vad','diar','codec','other'].includes(userTask)) {
    return userTask as any
  }
  const curated = CURATED_MODELS.find(m => m.id === modelId)
  if (curated && curated.task) return curated.task

  const fam = (family || resolveModelFamily(modelId, undefined, localPath)).toLowerCase()
  if (['ace_step', 'stable_audio', 'minimax_music3', 'heartmula', 'dramabox', 'controlfoley'].includes(fam)) return 'music'
  if (['pocket_tts', 'qwen3_tts', 'supertonic', 'vibevoice', 'magpie_tts', 'fish_audio', 'higgs_audio_tts', 'higgs_tts', 'index_tts2', 'chatterbox', 'confucius4_tts', 'dots_tts'].includes(fam)) return 'tts'
  if (['qwen3_asr', 'parakeet_tdt', 'fun_asr_nano', 'nemotron_asr', 'voxtral_realtime', 'sense_asr', 'citrinet_asr'].includes(fam)) return 'asr'
  if (['htdemucs', 'bs_roformer'].includes(fam)) return 'sep'
  if (['silero_vad', 'marblenet_vad'].includes(fam)) return 'vad'

  const text = `${modelId} ${localPath || ''}`.toLowerCase()
  if (text.includes('music') || text.includes('song') || text.includes('step') || text.includes('audio_gen')) return 'music'
  if (text.includes('tts') || text.includes('voice') || text.includes('speech') || text.includes('speak')) return 'tts'
  if (text.includes('asr') || text.includes('whisper') || text.includes('transcri') || text.includes('listen')) return 'asr'
  if (text.includes('sep') || text.includes('demucs') || text.includes('vocal')) return 'sep'
  if (text.includes('vad')) return 'vad'

  return 'other'
}

/**
 * Resolve the exact installed model and primary .gguf file path on disk
 */
export function resolveInstalledModel(dataRoot: string, modelId: string, preferredVariant?: string): ResolvedInstalledModel {
  const modelDir = getModelPath(dataRoot, modelId)
  const empty: ResolvedInstalledModel = {
    installed: false,
    modelId,
    modelDir,
    ggufPath: null,
    ggufDir: null,
    family: resolveModelFamily(modelId),
    task: resolveModelTask(modelId),
    files: [],
    primaryFileName: null,
  }

  if (!fs.existsSync(modelDir)) {
    // check if modelId is an absolute path to a file or dir directly
    if (fs.existsSync(modelId)) {
      const allFiles = findAllGgufFiles(modelId)
      if (allFiles.length > 0) {
        const top = allFiles[0]
        return {
          installed: true,
          modelId: path.basename(modelId),
          modelDir: fs.statSync(modelId).isDirectory() ? modelId : path.dirname(modelId),
          ggufPath: top,
          ggufDir: path.dirname(top),
          family: resolveModelFamily(modelId, undefined, top),
          task: resolveModelTask(modelId, undefined, undefined, top),
          files: allFiles,
          primaryFileName: path.basename(top),
        }
      }
    }
    return empty
  }

  const allFiles = findAllGgufFiles(modelDir)
  if (allFiles.length === 0) {
    return { ...empty, installed: false }
  }

  let selected = allFiles[0]
  if (preferredVariant) {
    const match = allFiles.find(f => f.toLowerCase().includes(preferredVariant.toLowerCase()))
    if (match) selected = match
  } else if (allFiles.length > 1) {
    // score variants against model id/label
    const scored = allFiles.map(f => ({
      file: f,
      score: scoreVariant(modelId, path.basename(f), f)
    }))
    scored.sort((a, b) => b.score - a.score)
    selected = scored[0].file
  }

  const family = resolveModelFamily(modelId, undefined, selected)
  const task = resolveModelTask(modelId, family, undefined, selected)

  return {
    installed: true,
    modelId,
    modelDir,
    ggufPath: selected,
    ggufDir: path.dirname(selected),
    family,
    task,
    files: allFiles,
    primaryFileName: path.basename(selected),
  }
}

export function scanInstalled(dataRoot: string, customModels?: Record<string, any>): ModelEntry[] {
  const dir = getModelsDir(dataRoot)
  if (!fs.existsSync(dir)) {
    return CURATED_MODELS.map(m=>({
      ...m,
      installed: false,
      capabilities: getModelCapabilities(m.family, m.id)
    }))
  }
  const entries = fs.readdirSync(dir)

  const base = CURATED_MODELS.map(m=>{
    const p = getModelPath(dataRoot, m.id)
    const resolved = resolveInstalledModel(dataRoot, m.id)
    const installed = resolved.installed
    const custom = customModels?.[m.id]
    const family = custom?.family || m.family
    return {
      ...m,
      task: (custom?.task as any) || m.task,
      family,
      label: custom?.label || m.label,
      description: custom?.description || m.description,
      installed,
      localPath: installed ? p : undefined,
      primaryGguf: resolved.primaryFileName || undefined,
      ggufFiles: resolved.files.map(f => path.basename(f)),
      capabilities: getModelCapabilities(family, m.id)
    }
  })

  // include custom imported folders or dynamic HF folders not in curated
  const curatedIds = new Set(CURATED_MODELS.map(m=> m.id))
  for(const e of entries){
    if(curatedIds.has(e)) continue
    const p = path.join(dir, e)
    try{
      const st = fs.statSync(p)
      if(!st.isDirectory()) continue
      const resolved = resolveInstalledModel(dataRoot, e)
      if(!resolved.installed) continue

      const custom = customModels?.[e]
      const family = custom?.family || resolved.family
      const task = (custom?.task as any) || resolved.task
      const label = custom?.label || e.replace(/[_-]+/g,' ')
      const description = custom?.description || `Local GGUF (${resolved.files.length} file${resolved.files.length > 1 ? 's' : ''})`

      base.push({
        id: e,
        family,
        label,
        task,
        description,
        language: 'auto',
        size: '?',
        runtime: 'GGUF',
        installed: true,
        localPath: p,
        primaryGguf: resolved.primaryFileName || undefined,
        ggufFiles: resolved.files.map(f => path.basename(f)),
        capabilities: getModelCapabilities(family, e)
      })
    }catch{}
  }
  return base
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

export async function resolveHfDownloadUrl(modelId:string): Promise<{url:string, fileName:string, size?:number, relPath?:string}>{
  const entry = CURATED_MODELS.find(m=> m.id===modelId)
  if(entry && entry.hfFile){
    const p = entry.hfFile.startsWith(entry.hfFolder||'') ? entry.hfFile : `${entry.hfFolder}/${entry.hfFile}`
    return {url:`${HF_BASE}/${p}`, fileName: path.basename(p), relPath: entry.hfFile}
  }
  // keyword-scored best match (turbo vs base, 1.7b vs 0.6b, music vs sfx...)
  const variants = await getModelVariants(modelId)
  if(variants.length===0) throw new Error(`No .gguf found for ${modelId} — browse https://huggingface.co/${HF_REPO}/tree/main`)
  const best = variants[0] // already sorted by score desc
  const folderPrefix = (entry?.hfFolder || modelId) + '/'
  const relPath = best.path.startsWith(folderPrefix) ? best.path.slice(folderPrefix.length) : best.fileName
  return {url: best.url, fileName: best.fileName, size: best.size, relPath}
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

// Score a variant file against model id/label — prefers matching variant keywords (turbo/base/1.7b/...)
export function scoreVariant(modelId:string, label:string, filePath:string): number{
  const p = filePath.toLowerCase()
  const tokens = `${modelId} ${label}`.toLowerCase().replace(/[^a-z0-9.]+/g,' ').split(/\s+/).filter(t=> t.length>1 && !['tts','asr','gguf','the','and','pro','small','v3','1.5'].includes(t))
  let score = 0
  for(const t of tokens){ if(p.includes(t)) score += 20 }
  if(/q8/i.test(p)) score += 5
  else if(/q6|q5|q4/i.test(p)) score += 3
  else if(/bf16|f16|orig/i.test(p)) score += 1
  return score
}

export async function getModelVariants(modelId:string): Promise<Array<{fileName:string, url:string, size:number, precision:string, path:string, recommended:boolean}>>{
  const entry = CURATED_MODELS.find(m=> m.id===modelId)
  const folder = entry?.hfFolder || modelId
  let targetFolder = folder
  if(!entry){
    try{
      const all = await fetchAllHfFolders()
      const sanitized = (s:string)=> s.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'')
      const found = all.find(f=> sanitized(f.folder)===modelId)
      if(found) targetFolder = found.folder
    }catch{}
  }
  const files = await fetchHfFolderFiles(targetFolder)
  const label = entry?.label || modelId
  const variants = files.map(f=>{
    const fileName = path.basename(f.path)
    const m = fileName.match(/(q8_0|q4_k|q5_k|q6_k|q8|q4|q2_k|q3_k|bf16|f16|f32|orig|int8)/i)
    let precision = m ? m[0].toLowerCase() : 'gguf'
    return {fileName, url: `${HF_BASE}/${f.path}`, size: f.size, precision, path: f.path, recommended:false, score: scoreVariant(modelId, label, f.path)}
  })
  // mark recommended = highest score, tie-break smallest
  if(variants.length>0){
    const best = variants.reduce((a,b)=> b.score>a.score ? b : (b.score===a.score && b.size<a.size ? b : a))
    best.recommended = true
  }
  return variants.sort((a,b)=> b.score - a.score || a.size - b.size).map(({score, ...rest}:any)=> rest)
}
