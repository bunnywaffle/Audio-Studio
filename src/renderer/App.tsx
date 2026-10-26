import React, { useEffect, useState, useRef } from 'react'
declare global { interface Window { api:any } }
type Tab = 'tts'|'music'|'asr'|'models'|'settings'

export default function App(){
  const [tab,setTab]=useState<Tab>('tts')
  const [settings,setSettings]=useState<any>(null)
  const [backend,setBackend]=useState<any>(null)
  const [server,setServer]=useState<any>(null)
  useEffect(()=>{(async()=>{
    const s=await window.api.getSettings(); setSettings(s)
    const b=await window.api.getBackendInfo(); setBackend(b)
    const st=await window.api.serverStatus(); setServer(st)
  })()},[])
  return (
    <div className="app">
      <div className="topbar">
        <div className="brand"><div className="logo">◉</div><div>audio.cpp Studio<br/><small>DARK • SLEEK • LOCAL</small></div><span className="badge">v0.2 • ggml</span></div>
        <span className={`pill ${backend?.hasCli?'live':''}`}>{backend?.hasCli?`● ${backend?.acceleration?.toUpperCase() || 'Backend'} ready`:'○ Backend missing'}</span>
        <span className={`pill ${server?.running?'live':''}`}>{server?.running?`● :${server.port}`:'○ Server off'}</span>
        <div className="right">
          <button
            className="btn ghost"
            style={{display:'inline-flex', alignItems:'center', gap:5, padding:'5px 9px', fontSize:12}}
            title="Launch audio.cpp native WebUI in your default browser"
            onClick={async()=>{
              try {
                await window.api.openWebUi()
                const st=await window.api.serverStatus(); setServer(st)
              } catch(e:any){ alert(e.message) }
            }}
          >
            <span style={{fontSize:13}}>🌐</span> WebUI ↗
          </button>
          <button className="btn ghost" onClick={async()=>{const s=await window.api.getBackendInfo(); setBackend(s); const st=await window.api.serverStatus(); setServer(st)}}>↻ Refresh</button>
          <button className="btn" onClick={()=> setTab('settings')}>⚙ Settings</button>
        </div>
      </div>

      <aside className="sidebar">
        <div style={{fontSize:10, color:'#5A6783', letterSpacing:.12+'em', margin:'2px 8px', fontWeight:700}}>WORKFLOWS</div>
        <nav className="nav">
          <button className={tab==='tts'?'active':''} onClick={()=> setTab('tts')}><span className="ico">🗣</span> Text → Speech <span style={{marginLeft:'auto'}} className="kbd">TTS</span></button>
          <button className={tab==='music'?'active':''} onClick={()=> setTab('music')}><span className="ico">♫</span> Music</button>
          <button className={tab==='asr'?'active':''} onClick={()=> setTab('asr')}><span className="ico">●</span> Speech → Text <span style={{marginLeft:'auto'}} className="kbd">ASR</span></button>
          <button className={tab==='models'?'active':''} onClick={()=> setTab('models')}><span className="ico">▦</span> Models</button>
          <button className={tab==='settings'?'active':''} onClick={()=> setTab('settings')}><span className="ico">◆</span> System</button>
        </nav>
        <div className="side-foot">
          <div style={{fontWeight:700, fontSize:13, display:'flex', alignItems:'center', gap:8}}><span style={{width:7,height:7,borderRadius:99,background:'#22C55E'}}></span> Data folder</div>
          <small style={{display:'block', marginTop:6, wordBreak:'break-all', lineHeight:1.4}}>{settings?.dataRoot || '…'}</small>
          <div style={{display:'flex', gap:8, marginTop:10}}>
            <button className="btn" style={{flex:1}} onClick={async()=>{const p=await window.api.chooseFolder(); if(p){ const ns=await window.api.saveSettings({dataRoot:p}); setSettings(ns); const b=await window.api.getBackendInfo(); setBackend(b)}}}>Change</button>
            <button className="btn ghost" onClick={()=> settings && window.api.openFolder(settings.dataRoot)}>Open</button>
          </div>
        </div>
      </aside>

      <main className="content">
        {tab==='tts' && <TTS />}
        {tab==='music' && <Music />}
        {tab==='asr' && <ASR />}
        {tab==='models' && <Models />}
        {tab==='settings' && <SettingsView settings={settings} setSettings={setSettings} backend={backend} setBackend={setBackend} server={server} setServer={setServer} />}
      </main>
    </div>
  )
}

function useModels(){
  const [models,setModels]=useState<any[]>([])
  const refresh=async()=> setModels(await window.api.listModels())
  useEffect(()=>{ refresh() },[])
  return {models, refresh}
}

/* Sleek Universal Model Picker */
function ModelPicker({
  models,
  value,
  onChange,
  defaultTask = 'all',
  placeholder = "Choose model"
}: {
  models: any[],
  value: string,
  onChange: (id: string) => void,
  defaultTask?: string,
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [taskFilter, setTaskFilter] = useState<string>(defaultTask)
  const ref = useRef<HTMLDivElement>(null)
  const selected = models.find((m: any) => m.id === value)

  const taskOptions = ['all', 'tts', 'music', 'asr', 'other']

  const filtered = models.filter((m: any) => {
    if (taskFilter !== 'all') {
      if (taskFilter === 'other' && ['tts', 'music', 'asr'].includes(m.task)) return false
      if (taskFilter !== 'other' && m.task !== taskFilter) return false
    }
    if (!q) return true
    return `${m.label} ${m.id} ${m.family} ${m.description} ${m.task} ${m.primaryGguf || ''}`.toLowerCase().includes(q.toLowerCase())
  })

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const getTaskIcon = (task: string) => {
    switch (task) {
      case 'tts': return '🗣'
      case 'music': return '♫'
      case 'asr': return '●'
      case 'sep': return '✂'
      case 'vad': return '🎙'
      default: return '▦'
    }
  }

  return (
    <div className="model-picker" ref={ref}>
      <button className="model-trigger" onClick={() => setOpen(!open)}>
        <div className="opt-ico" style={{ width: 30, height: 30, fontSize: 13 }}>
          {getTaskIcon(selected?.task || defaultTask)}
        </div>
        <div className="meta">
          <b>{selected ? `${selected.label} — ${selected.size || 'GGUF'}` : placeholder}</b>
          <span>
            {selected
              ? `${selected.family} • ${selected.task?.toUpperCase() || 'TASK'}${selected.primaryGguf ? ` • ${selected.primaryGguf}` : ''}${selected.installed ? ' • installed' : ''}`
              : 'No model selected'}
          </span>
        </div>
        <span className={selected?.installed ? 'badge-installed' : 'badge-missing'}>
          {selected?.installed ? '● installed' : '○ not installed'}
        </span>
        <span className="chev">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="model-dropdown">
          <div className="search">
            <input autoFocus placeholder="Search models, families, ggufs…" value={q} onChange={e => setQ(e.target.value)} />
            <span className="kbd">{filtered.length}</span>
          </div>
          <div style={{ display: 'flex', gap: 4, padding: '4px 8px', background: 'var(--panel2)', borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
            {taskOptions.map(t => (
              <button
                key={t}
                type="button"
                className={`btn ${taskFilter === t ? 'primary' : 'ghost'}`}
                style={{ padding: '2px 8px', fontSize: 11, textTransform: 'uppercase' }}
                onClick={() => setTaskFilter(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="list">
            {filtered.map((m: any) => (
              <div key={m.id} className={`model-option ${m.id === value ? 'active' : ''}`} onClick={() => { onChange(m.id); setOpen(false); setQ('') }}>
                <div className="opt-ico">{getTaskIcon(m.task)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <b style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.label}</b>
                    <span className="tag" style={{ fontSize: 9 }}>{m.task?.toUpperCase()}</span>
                    <span className="kbd">{m.size || 'GGUF'}</span>
                    <span className={m.installed ? 'badge-installed' : 'badge-missing'} style={{ marginLeft: 'auto' }}>
                      {m.installed ? 'installed' : 'get'}
                    </span>
                  </div>
                  <div className="small mono" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {m.family} • {m.primaryGguf ? `GGUF: ${m.primaryGguf}` : m.runtime}
                  </div>
                  <div className="small" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {m.description}
                  </div>
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="small" style={{ padding: 14, textAlign: 'center' }}>
                No matching models found in filter. Switch tab above to <b>ALL</b> or download from Models tab.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function TTS(){
  const {models}=useModels()
  const installedModels = models.filter((m:any)=> m.installed)
  const ttsModels = installedModels.filter((m:any)=> m.task==='tts')
  const defaultList = ttsModels.length > 0 ? ttsModels : installedModels
  const hasAnyInstalled = installedModels.length > 0

  const [modelId,setModelId]=useState('')
  const [text,setText]=useState('Hello! audio.cpp Studio is running locally — no Python needed. Fast, high-fidelity native audio inference.')
  const [voiceId,setVoiceId]=useState('')
  const [instruct,setInstruct]=useState('')
  const [voiceRef,setVoiceRef]=useState('')
  const [referenceText,setReferenceText]=useState('')
  const [drag,setDrag]=useState(false)
  const [language,setLanguage]=useState('en')
  const [busy,setBusy]=useState(false)
  const [result,setResult]=useState<any>(null)
  const [outputs,setOutputs]=useState<any[]>([])

  useEffect(()=>{
    if(!modelId && defaultList[0]) setModelId(defaultList[0].id)
  },[models])
  useEffect(()=>{ window.api.listOutputs().then(setOutputs)},[result])
  const fileName = voiceRef ? voiceRef.split(/\\|\//).pop() : ''

  const selectedModel = models.find((m:any)=> m.id===modelId)
  const fam = (selectedModel?.family || '').toLowerCase()
  const id = (selectedModel?.id || '').toLowerCase()

  const capabilities = selectedModel?.capabilities || {
    supportsVoiceClone: ['pocket_tts', 'qwen3_tts', 'fish_audio', 'higgs_audio_tts', 'index_tts2',
      'chatterbox', 'dramabox', 'dots_tts', 'fireredtts3', 'firered_audio',
      'f5_tts', 'glm_tts', 'moss_tts_local', 'moss_tts_nano', 'omnivoice', 'voxcpm2'].includes(fam) || id.includes('clone'),
    requiresReferenceText: (fam === 'qwen3_tts' && !id.includes('customvoice') && !id.includes('voicedesign')) || fam === 'glm_tts' || fam === 'fireredtts3',
    supportsVoiceInstruct: ['qwen3_tts', 'fireredtts3', 'irodori_tts', 'moss_voicegen', 'omnivoice', 'voxcpm2'].includes(fam) || id.includes('instruct') || id.includes('voicedesign'),
    supportsPresetVoices: ['supertonic', 'neutts', 'magpie_tts', 'pocket_tts', 'qwen3_tts', 'confucius4_tts'].includes(fam),
    presetVoices: fam === 'supertonic' ? ['alba', 'calm_male', 'calm_female', 'energetic', 'narrator'] : undefined
  }

  return (
    <div style={{display:'grid', gap:14, maxWidth:1140}}>
      <div className="hero">
        <div className="row" style={{justifyContent:'space-between'}}>
          <div><h2>Text to Speech</h2><p>Natural, instant, local audio inference — pure C++ GGUF engine, zero Python dependencies.</p></div>
          <div className="wave"><i/><i/><i/><i/><i/></div>
        </div>
      </div>

      <div className="grid2" style={{alignItems:'start'}}>
        <div className="card">
          <h3><span className="dot"/> Script</h3>
          <label className="small" style={{fontWeight:700}}>Model — installed</label>
          {hasAnyInstalled ? (
            <ModelPicker models={installedModels} value={modelId} onChange={setModelId} defaultTask="tts" placeholder="Choose an installed TTS model" />
          ) : (
            <div style={{padding:'12px', background:'rgba(250,204,21,.08)', border:'1px solid rgba(250,204,21,.2)', borderRadius:8, fontSize:12}}>
              No models installed yet — go to <b>Models</b> tab to download PocketTTS, Qwen3-TTS, or Supertonic.
            </div>
          )}
          <div className="small mono" style={{marginTop:6, display:'flex', gap:6, flexWrap:'wrap', alignItems:'center'}}>
            {selectedModel ? (
              <>
                <span className="tag">Family: {selectedModel.family}</span>
                {capabilities.supportsVoiceClone ? (
                  <span className="pill" style={{background:'rgba(16,185,129,0.15)', color:'#34D399', border:'1px solid rgba(16,185,129,0.3)'}}>Voice Clone Ready</span>
                ) : (
                  <span className="pill" style={{background:'rgba(59,130,246,0.15)', color:'#60A5FA', border:'1px solid rgba(59,130,246,0.3)'}}>Preset Voices Only</span>
                )}
                {selectedModel.primaryGguf && <span className="kbd">{selectedModel.primaryGguf}</span>}
              </>
            ) : `${installedModels.length} installed models`}
          </div>

          <div style={{marginTop:12}} className="grid2">
            <div>
              <label className="small" style={{fontWeight:700}}>Language</label>
              <select className="select" value={language} onChange={e=> setLanguage(e.target.value)}>
                <option value="en">English</option>
                <option value="es">Spanish</option>
                <option value="zh">中文</option>
                <option value="ja">日本語</option>
                <option value="de">Deutsch</option>
                <option value="fr">Français</option>
                <option value="ko">한국어</option>
                <option value="it">Italiano</option>
                <option value="pt">Português</option>
              </select>
            </div>
            <div>
              <label className="small" style={{fontWeight:700}}>Preset voice / Speaker ID</label>
              {capabilities.presetVoices && capabilities.presetVoices.length > 0 ? (
                <div style={{display:'flex', gap:6}}>
                  <select className="select" value={voiceId} onChange={e=> setVoiceId(e.target.value)} style={{flex:1}}>
                    <option value="">Default Voice</option>
                    {capabilities.presetVoices.map((v: string) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
              ) : (
                <input className="input" placeholder={capabilities.supportsVoiceClone ? "Optional speaker name / ID" : "e.g. alba / calm_male"} value={voiceId} onChange={e=> setVoiceId(e.target.value)} />
              )}
            </div>
          </div>

          {capabilities.supportsVoiceInstruct && (
            <div style={{marginTop:12}}>
              <label className="small" style={{fontWeight:700}}>Voice Design / Style Prompt <span style={{fontWeight:400, color:'var(--muted)'}}>(Instruct model)</span></label>
              <input className="input" placeholder='e.g. "Warm radio host with soft British accent", "Energetic cheerful narrator"' value={instruct} onChange={e=> setInstruct(e.target.value)} />
            </div>
          )}

          <div style={{marginTop:12}}>
            <label className="small" style={{fontWeight:700}}>Text</label>
            <textarea className="textarea" value={text} onChange={e=> setText(e.target.value)} placeholder="Type what you want to hear — long text auto-splits" />
            <div className="row" style={{marginTop:8, justifyContent:'space-between'}}><span className="small mono">{text.length} chars • ~{Math.ceil(text.split(/\s+/).length/150)} min</span><span className="pill">long text → auto-merge</span></div>
          </div>

          <button className="btn primary" style={{width:'100%', justifyContent:'center', padding:'12px', marginTop:14, fontSize:14}} disabled={busy || !modelId || !text.trim()} onClick={async()=>{
            setBusy(true); setResult(null)
            try{
              const r = await window.api.tts({
                modelId,
                family: selectedModel?.family,
                text,
                voiceRef: capabilities.supportsVoiceClone ? (voiceRef || undefined) : undefined,
                voiceId: voiceId || undefined,
                instruct: instruct || undefined,
                referenceText: (capabilities.supportsVoiceClone && voiceRef) ? (referenceText || undefined) : undefined,
                language
              })
              setResult(r)
            }
            catch(e:any){ setResult({error:e.message}) }
            setBusy(false)
          }}>{busy?'Synthesizing…':'▶ Generate speech'}</button>

          {result && <div style={{marginTop:12, padding:12, background:'var(--panel2)', border:'1px solid var(--border)', borderRadius:10}}>
            {result.error ? <div style={{color:'#F87171', fontWeight:700, whiteSpace:'pre-wrap'}}>{result.error}</div> : <>
              <div className="small mono">via {result.via}</div>
              <div style={{fontWeight:700, wordBreak:'break-all', fontSize:12, marginTop:4}}>{result.outFile}</div>
              {result.outFile?.endsWith('.wav') || result.outFile?.endsWith('.mp3') ? <audio controls src={`file://${result.outFile}`} style={{width:'100%', marginTop:8}}/> : null}
              <div className="row" style={{marginTop:8}}><button className="btn" onClick={()=> window.api.revealOutput(result.outFile)}>Show in folder</button><button className="btn ghost" onClick={()=> navigator.clipboard.writeText(result.outFile)}>Copy</button></div>
            </>}
          </div>}
        </div>

        <div style={{display:'grid', gap:12}}>
          {capabilities.supportsVoiceClone ? (
            <div className="voice-card">
              <div className="head">
                <span style={{width:28,height:28,borderRadius:8,display:'grid',placeItems:'center',background:'var(--text)',color:'var(--bg)',fontSize:13}}>◉</span>
                <b>Clone voice</b>
                <span className="badge-missing" style={{marginLeft:'auto'}}>
                  {capabilities.requiresReferenceText ? 'ICL Clone' : 'Acoustic Clone'}
                </span>
              </div>
              <div className="small" style={{marginBottom:10}}>
                {capabilities.requiresReferenceText
                  ? 'Drop a clean 10–30s voice sample with transcript below for Qwen3 / GLM ICL cloning.'
                  : 'Drop a clean 10–30s voice sample. Mono, quiet, single speaker (no transcript required).'}
              </div>
              <div className={`audio-drop ${drag?'drag':''}`} onDragOver={e=>{e.preventDefault(); setDrag(true)}} onDragLeave={()=> setDrag(false)} onDrop={async e=>{
                e.preventDefault(); setDrag(false); const f=(e.dataTransfer.files[0] as any)?.path; if(f) setVoiceRef(f)
              }} onClick={async()=>{
                const f=await window.api.chooseFile([{name:'Audio', extensions:['wav','mp3','m4a','flac','ogg']}]); if(f) setVoiceRef(f)
              }}>
                <div className="icon">◎</div>
                <div style={{fontWeight:700, fontSize:13}}>{voiceRef ? 'Voice ready' : 'Drop voice here or click'}</div>
                {!voiceRef && <div className="small" style={{textAlign:'center'}}>wav / mp3 / m4a / flac<br/>10–30s, no music, no echo</div>}
                {voiceRef && <div className="pill mono" style={{maxWidth:'100%', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{fileName}</div>}
                <div className="row" style={{justifyContent:'center'}}><span className="kbd">16kHz mono</span>{voiceRef && <button className="btn ghost" style={{padding:'4px 8px', fontSize:11}} onClick={e=>{e.stopPropagation(); setVoiceRef('')}}>✕ Clear</button>}</div>
              </div>
              {voiceRef && <audio controls src={`file://${voiceRef}`} style={{width:'100%', marginTop:10}}/>}
              <div className="row" style={{marginTop:10}}>
                <input className="input mono" value={voiceRef} onChange={e=> setVoiceRef(e.target.value)} placeholder="or paste full path" style={{flex:1, fontSize:11}} />
                <button className="btn" onClick={async()=>{const f=await window.api.chooseFile([{name:'Audio', extensions:['wav','mp3','flac','ogg','m4a']}]); if(f) setVoiceRef(f)}}>Browse</button>
              </div>

              {capabilities.requiresReferenceText ? (
                <div style={{marginTop:10}}>
                  <label className="small" style={{fontWeight:700}}>
                    Reference transcript <span style={{fontWeight:400, color: voiceRef ? '#F59E0B' : 'var(--muted)'}}>
                      ({voiceRef ? 'Required for Qwen3 / GLM clone' : 'Required when voice sample is attached'})
                    </span>
                  </label>
                  <textarea
                    className="textarea"
                    style={{minHeight:56, fontSize:12, borderColor: (voiceRef && !referenceText.trim()) ? 'rgba(245,158,11,0.5)' : undefined}}
                    value={referenceText}
                    onChange={e=> setReferenceText(e.target.value)}
                    placeholder='Exact transcript of reference audio (e.g. "Some call me nature. Others call me Mother Nature..."). Required for Qwen3 ICL mode.'
                  />
                  <div className="small" style={{marginTop:4, color:'var(--muted)'}}>
                    Paste the exact spoken words in your reference audio file so the ICL model matches the voice timbre accurately.
                  </div>
                </div>
              ) : (
                <div style={{marginTop:10, padding:'8px 10px', borderRadius:8, background:'var(--panel2)', border:'1px solid var(--border)', fontSize:11, color:'var(--muted)'}}>
                  <b style={{color:'var(--text)'}}>Note:</b> {selectedModel?.label || selectedModel?.family} performs direct acoustic voice cloning from the WAV file. <b>No reference transcript is required.</b>
                </div>
              )}

              <div style={{marginTop:10, padding:'9px 10px', borderRadius:10, background:'var(--panel2)', border:'1px solid var(--border)', fontSize:11, lineHeight:1.5, color:'var(--muted)'}}>
                <b style={{color:'var(--text)'}}>Tip</b> — Clear the voice box anytime to generate standard voice without cloning.
              </div>
            </div>
          ) : (
            <div className="voice-card" style={{borderStyle:'dashed'}}>
              <div className="head">
                <span style={{width:28,height:28,borderRadius:8,display:'grid',placeItems:'center',background:'rgba(59,130,246,0.2)',color:'#60A5FA',fontSize:13}}>ℹ</span>
                <b>Preset Voice Model</b>
                <span className="pill" style={{marginLeft:'auto', background:'rgba(59,130,246,0.15)', color:'#60A5FA', border:'1px solid rgba(59,130,246,0.3)'}}>Preset Only</span>
              </div>
              <div className="small" style={{marginTop:8, lineHeight:1.6}}>
                <b>{selectedModel?.label || selectedModel?.family}</b> is optimized for ultra-fast synthesis with built-in speaker presets.
                <div style={{marginTop:10, padding:'10px 12px', background:'var(--panel2)', borderRadius:8, border:'1px solid var(--border)', fontSize:12}}>
                  ✓ <b>No cloning sample or reference transcript needed!</b><br/>
                  Select a preset voice (e.g. <code>{capabilities.presetVoices?.join(', ') || 'alba, calm_male'}</code>) on the left and click <b>Generate speech</b>.
                </div>
                <div style={{marginTop:10, color:'var(--muted)'}}>
                  To clone a custom voice, select <b>PocketTTS</b>, <b>Qwen3-TTS</b>, or <b>Fish Audio</b> from the model picker.
                </div>
              </div>
            </div>
          )}

          <div className="card">
            <h3><span className="dot" style={{background:'var(--muted)'}}/> Recent</h3>
            <div className="list">
              {outputs.slice(0,6).map((o:any)=>(
                <div key={o.path} className="out-item">
                  <div><div style={{fontWeight:600, fontSize:12}}>{o.name}</div><div className="small mono">{(o.size/1024).toFixed(1)} KB</div></div>
                  <button className="btn" onClick={()=> window.api.revealOutput(o.path)}>Open</button>
                </div>
              ))}
              {outputs.length===0 && <div className="small">No outputs yet — generate and they appear here.</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Music(){
  const {models}=useModels()
  const installedModels = models.filter((m:any)=> m.installed)
  const musicModels = installedModels.filter((m:any)=> m.task==='music')
  const defaultList = musicModels.length > 0 ? musicModels : installedModels
  const hasAnyInstalled = installedModels.length > 0

  const [modelId,setModelId]=useState('')
  const [prompt,setPrompt]=useState('lofi hip hop, warm Rhodes, gentle drums, cozy night')
  const [lyrics,setLyrics]=useState('')
  const [duration,setDuration]=useState('30')
  const [steps,setSteps]=useState('16')
  const [timeoutSec,setTimeoutSec]=useState('900')
  const [customFamily,setCustomFamily]=useState('')
  const [showOptions,setShowOptions]=useState(false)
  const [busy,setBusy]=useState(false)
  const [liveLog,setLiveLog]=useState('')
  const [result,setResult]=useState<any>(null)

  useEffect(()=>{
    if(!modelId && defaultList[0]) setModelId(defaultList[0].id)
  },[models])

  useEffect(()=>{
    if(modelId && (modelId.toLowerCase().includes('turbo') || selectedModel?.primaryGguf?.toLowerCase().includes('turbo'))){
      setSteps('8')
    }
  },[modelId])

  useEffect(()=>{
    const off = window.api.onGenProgress?.((d:any)=>{
      if(d && d.text){
        setLiveLog(prev => (prev + d.text).slice(-2000))
      }
    })
    return ()=> off && off()
  },[])

  const selectedModel = models.find((m:any)=> m.id===modelId)

  return (
    <div style={{display:'grid', gap:14, maxWidth:1020}}>
      <div className="hero"><h2>Music & Audio Generation</h2><p>Text to song, instrumental vibe, or sound effects — pure C++ GGUF inference.</p></div>
      <div className="card">
        <h3><span className="dot"/> Compose</h3>
        <label className="small" style={{fontWeight:700}}>Model — installed</label>
        {hasAnyInstalled ? (
          <ModelPicker models={installedModels} value={modelId} onChange={setModelId} defaultTask="music" placeholder="Choose an installed music / gen model" />
        ) : (
          <div style={{padding:'12px', background:'rgba(250,204,21,.08)', border:'1px solid rgba(250,204,21,.2)', borderRadius:8, fontSize:12}}>
            No models installed yet — download ACE-Step 1.5, Stable Audio, or HeartMuLa in <b>Models</b> tab, or import a custom GGUF.
          </div>
        )}
        
        {selectedModel && (
          <div className="small mono" style={{marginTop:6, display:'flex', gap:8, alignItems:'center', flexWrap:'wrap'}}>
            <span className="tag">Family: {customFamily || selectedModel.family}</span>
            <span className="tag">Task: {selectedModel.task.toUpperCase()}</span>
            {selectedModel.primaryGguf && <span className="kbd">{selectedModel.primaryGguf}</span>}
            <button className="btn ghost" style={{padding:'2px 6px', fontSize:10, marginLeft:'auto'}} onClick={()=> setShowOptions(!showOptions)}>
              {showOptions ? 'Hide options' : '⚙ Performance & Steps'}
            </button>
          </div>
        )}

        <div className="grid2" style={{marginTop:12}}>
          <div>
            <label className="small" style={{fontWeight:700}}>Duration</label>
            <select className="select" value={duration} onChange={e=> setDuration(e.target.value)}>
              <option value="15">15 seconds (fast preview)</option>
              <option value="30">30 seconds (standard)</option>
              <option value="60">60 seconds (1 minute)</option>
              <option value="120">120 seconds (2 minutes)</option>
            </select>
          </div>
          <div>
            <label className="small" style={{fontWeight:700}}>Inference Steps (Speed vs Quality)</label>
            <select className="select" value={steps} onChange={e=> setSteps(e.target.value)}>
              <option value="8">8 steps (Ultra Fast / Turbo)</option>
              <option value="12">12 steps (Fast preview)</option>
              <option value="16">16 steps (Recommended for Turbo)</option>
              <option value="25">25 steps (Balanced quality)</option>
              <option value="40">40 steps (High quality)</option>
              <option value="50">50 steps (Maximum detail)</option>
            </select>
          </div>
        </div>

        {showOptions && (
          <div style={{marginTop:10, padding:10, background:'var(--panel2)', border:'1px solid var(--border)', borderRadius:8}}>
            <div className="grid2">
              <div>
                <label className="small" style={{fontWeight:700}}>Override Family (e.g. ace_step, stable_audio, minimax_music3)</label>
                <input className="input mono" placeholder={selectedModel?.family || 'ace_step'} value={customFamily} onChange={e=> setCustomFamily(e.target.value)} style={{marginTop:4, fontSize:12}} />
              </div>
              <div>
                <label className="small" style={{fontWeight:700}}>Timeout Limit</label>
                <select className="select" value={timeoutSec} onChange={e=> setTimeoutSec(e.target.value)} style={{marginTop:4}}>
                  <option value="300">5 minutes</option>
                  <option value="600">10 minutes</option>
                  <option value="900">15 minutes (Default)</option>
                  <option value="1800">30 minutes (Large CPU jobs)</option>
                </select>
              </div>
            </div>
          </div>
        )}

        <div style={{marginTop:12}}>
          <label className="small" style={{fontWeight:700}}>Prompt (Music style, instruments, mood)</label>
          <textarea className="textarea" style={{minHeight:80}} value={prompt} onChange={e=> setPrompt(e.target.value)} placeholder="e.g. upbeat electro pop with energetic synth riffs, clear drums, inspiring melody..." />
        </div>

        <div style={{marginTop:12}}>
          <label className="small" style={{fontWeight:700}}>Lyrics <span style={{fontWeight:400, color:'var(--muted)'}}>(optional — for models supporting singing/lyrics)</span></label>
          <textarea className="textarea" style={{minHeight:70}} value={lyrics} onChange={e=> setLyrics(e.target.value)} placeholder="[Verse 1]&#10;Night falls over the city glow...&#10;&#10;[Chorus]&#10;We run under the starlight..." />
        </div>

        <div className="row" style={{marginTop:14, justifyContent:'space-between', alignItems:'center'}}>
          {busy ? (
            <button className="btn ghost" style={{color:'#F87171', borderColor:'rgba(248,113,113,0.3)'}} onClick={async()=>{
              try { await window.api.cancelGen?.() } catch {}
              setBusy(false)
            }}>
              ✕ Cancel Generation
            </button>
          ) : <div/>}

          <button className="btn primary" disabled={busy || !modelId || !prompt.trim()} onClick={async()=>{
            setBusy(true); setResult(null); setLiveLog('Starting engine inference...\n');
            try{
              const r = await window.api.music({
                modelId,
                family: customFamily || selectedModel?.family,
                prompt,
                lyrics,
                duration,
                steps,
                timeout: timeoutSec
              })
              setResult(r)
            } catch(e:any){
              setResult({ error: e.message })
            }
            setBusy(false)
          }}>
            {busy ? 'Composing track…' : '♫ Generate music'}
          </button>
        </div>

        {busy && (
          <div style={{marginTop:12, padding:10, background:'var(--bg)', border:'1px solid var(--border)', borderRadius:8}}>
            <div className="row" style={{justifyContent:'space-between', marginBottom:6}}>
              <span className="small mono" style={{fontWeight:700}}>Live Engine Output</span>
              <span className="tag">Running ({steps} steps)</span>
            </div>
            <pre className="mono small" style={{maxHeight:120, overflow:'auto', whiteSpace:'pre-wrap', margin:0, color:'var(--muted)'}}>
              {liveLog || 'Awaiting output from audiocpp_cli...'}
            </pre>
          </div>
        )}

        {result && (
          <div style={{marginTop:12, padding:12, background:'var(--panel2)', border:'1px solid var(--border)', borderRadius:10}}>
            {result.error ? (
              <div style={{color:'#F87171', whiteSpace:'pre-wrap', lineHeight:1.5}}>
                <b>Generation error:</b>
                <div style={{marginTop:4, fontSize:12, background:'var(--bg)', padding:10, borderRadius:8, border:'1px solid rgba(248,113,113,0.2)'}}>{result.error}</div>
              </div>
            ) : (
              <>
                <div className="small mono">via {result.via}</div>
                <div style={{fontWeight:700, wordBreak:'break-all', fontSize:12, marginTop:4}}>{result.outFile}</div>
                {result.outFile?.endsWith('.wav') && <audio controls src={`file://${result.outFile}`} style={{width:'100%', marginTop:8}}/>}
                <div className="row" style={{marginTop:8}}>
                  <button className="btn" onClick={()=> window.api.revealOutput(result.outFile)}>Show in folder</button>
                  <button className="btn ghost" onClick={()=> navigator.clipboard.writeText(result.outFile)}>Copy path</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ASR(){
  const {models}=useModels()
  const installedModels = models.filter((m:any)=> m.installed)
  const asrModels = installedModels.filter((m:any)=> m.task==='asr')
  const defaultList = asrModels.length > 0 ? asrModels : installedModels
  const hasAnyAsr = installedModels.length > 0

  const [modelId,setModelId]=useState('')
  const [audioPath,setAudioPath]=useState('')
  const [drag,setDrag]=useState(false)
  const [busy,setBusy]=useState(false)
  const [result,setResult]=useState<any>(null)

  useEffect(()=>{
    if(!modelId && defaultList[0]) setModelId(defaultList[0].id)
  },[models])

  const selectedModel = models.find((m:any)=> m.id===modelId)

  return (
    <div style={{display:'grid', gap:14, maxWidth:1020}}>
      <div className="hero"><h2>Speech → Text</h2><p>Long meetings, podcasts — VAD chunking handles hours.</p></div>
      <div className="card">
        <h3><span className="dot" style={{background:'#22C55E'}}/> Transcribe</h3>
        <label className="small" style={{fontWeight:700}}>Model — installed</label>
        {hasAnyAsr ? (
          <ModelPicker models={installedModels} value={modelId} onChange={setModelId} defaultTask="asr" placeholder="Choose an installed ASR model" />
        ) : (
          <div style={{padding:'12px', background:'rgba(250,204,21,.08)', border:'1px solid rgba(250,204,21,.2)', borderRadius:8, fontSize:12}}>
            No ASR models installed — download Qwen3-ASR or Parakeet in <b>Models</b> tab.
          </div>
        )}
        <div style={{marginTop:12}} className={`audio-drop ${drag?'drag':''}`} onDragOver={e=>{e.preventDefault(); setDrag(true)}} onDragLeave={()=> setDrag(false)} onDrop={async e=>{
          e.preventDefault(); setDrag(false); const f=(e.dataTransfer.files[0] as any)?.path; if(f) setAudioPath(f)
        }} onClick={async()=>{
          const f=await window.api.chooseFile([{name:'Audio', extensions:['wav','mp3','m4a','flac','ogg','mp4']}]); if(f) setAudioPath(f)
        }}>
          <div className="icon">●</div>
          <div style={{fontWeight:700, fontSize:13}}>{audioPath ? audioPath.split(/\\|\//).pop() : 'Drop audio here'}</div>
          <div className="small">{audioPath || 'wav / mp3 / m4a'}</div>
          {audioPath && <audio controls src={`file://${audioPath}`} style={{width:'100%', maxWidth:480, marginTop:6}}/>}
        </div>
        <button className="btn primary" style={{width:'100%', justifyContent:'center', marginTop:12}} disabled={busy || !audioPath || !modelId} onClick={async()=>{
          setBusy(true); setResult(null);
          try{
            const r=await window.api.asr({ modelId, family: selectedModel?.family, audioPath });
            setResult(r)
          }catch(e:any){ setResult({error:e.message})};
          setBusy(false)
        }}>{busy?'Transcribing…':'Transcribe'}</button>
        {result && <div style={{marginTop:12, padding:12, background:'var(--panel2)', border:'1px solid var(--border)', borderRadius:10}}>
          {result.error ? <div style={{color:'#F87171'}}>{result.error}</div> : <><div className="small mono">via {result.via}</div><div style={{whiteSpace:'pre-wrap', lineHeight:1.6, marginTop:6, background:'var(--bg)', padding:10, borderRadius:8, border:'1px solid var(--border)', fontSize:13}}>{result.text}</div><div className="row" style={{marginTop:8}}><button className="btn" onClick={()=> navigator.clipboard.writeText(result.text)}>Copy</button><button className="btn ghost" onClick={()=>{
            const blob=new Blob([result.text],{type:'text/plain'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='transcript.txt'; a.click()
          }}>Download</button></div></>}
        </div>}
      </div>
    </div>
  )
}

function Models(){
  const [models,setModels]=useState<any[]>([])
  const [filter,setFilter]=useState<'all'|'tts'|'music'|'asr'|'other'>('all')
  const [downloading,setDownloading]=useState<Record<string,number>>({})
  const [query,setQuery]=useState('')
  const [expanded,setExpanded]=useState<string|null>(null)
  const [variants,setVariants]=useState<Record<string,any[]>>({})
  const [loadingV,setLoadingV]=useState<Record<string,boolean>>({})
  const [editingId,setEditingId]=useState<string|null>(null)
  const [editTask,setEditTask]=useState('tts')
  const [editFamily,setEditFamily]=useState('')
  const [editLabel,setEditLabel]=useState('')
  const [testResult,setTestResult]=useState<Record<string,string>>({})

  const refresh=async()=>{
    try{
      const all = await window.api.listAllModels()
      setModels(all)
    }catch{ setModels(await window.api.listModels()) }
  }
  useEffect(()=>{
    refresh();
    const off=window.api.onDownloadProgress((d:any)=>{
      setDownloading(prev=> ({...prev, [d.id]: d.pct, [d.id+'_note']: d.note||''}));
      if(d.done || d.error) setTimeout(refresh,400)
    });
    return ()=> off && off()
  },[])

  const filtered=models.filter((m:any)=>{
    if(filter!=='all' && !m.task.includes(filter as any) && !(filter==='other' && !['tts','music','asr'].includes(m.task))) return false
    if(query && !`${m.label} ${m.family} ${m.description} ${m.primaryGguf||''}`.toLowerCase().includes(query.toLowerCase())) return false
    return true
  })
  const fmtSize=(b:number)=> b>1024*1024*1024 ? `${(b/1024/1024/1024).toFixed(2)} GB` : b>1024*1024 ? `${(b/1024/1024).toFixed(0)} MB` : `${(b/1024).toFixed(0)} KB`
  const loadVariants=async(id:string)=>{
    if(variants[id]){ setExpanded(expanded===id?null:id); return }
    setLoadingV(p=>({...p,[id]:true}))
    try{
      const v = await window.api.getModelVariants(id)
      setVariants(p=>({...p,[id]:v}))
      setExpanded(id)
    }catch(e:any){ alert(e.message) }
    setLoadingV(p=>({...p,[id]:false}))
  }

  const startEdit = (m:any) => {
    setEditingId(m.id)
    setEditTask(m.task || 'tts')
    setEditFamily(m.family || m.id)
    setEditLabel(m.label || m.id)
  }

  const saveEdit = async (id:string) => {
    try {
      await window.api.updateCustomModel(id, { task: editTask, family: editFamily, label: editLabel })
      setEditingId(null)
      refresh()
    } catch(e:any){ alert(e.message) }
  }

  const testModelRun = async (id:string) => {
    try {
      setTestResult(p=>({...p, [id]: 'Testing…'}))
      const r = await window.api.testModel(id)
      if (r.ok) {
        setTestResult(p=>({...p, [id]: `✓ Model OK: ${r.resolved?.primaryFileName || 'GGUF verified'}`}))
      } else {
        setTestResult(p=>({...p, [id]: `✗ Test failed: ${r.error}`}))
      }
    } catch(e:any){
      setTestResult(p=>({...p, [id]: `✗ Error: ${e.message}`}))
    }
  }

  return (
    <div style={{display:'grid', gap:14}}>
      <div className="card">
        <div className="row" style={{justifyContent:'space-between'}}>
          <h3 style={{margin:0}}><span className="dot"/> Models — {models.filter((m:any)=> m.installed).length} installed / {models.length} total</h3>
          <div className="row">
            <button className="btn ghost" onClick={async()=>{
              const f=await window.api.chooseFile([{name:'GGUF', extensions:['gguf']}])
              if(f){
                const suggested = f.split(/\\|\//).pop()?.replace(/\.gguf$/i,'').toLowerCase().replace(/[^a-z0-9]+/g,'_') || 'custom_model'
                const id = prompt('Import as model ID (folder name):', suggested)
                if(id){
                  const taskPrompt = prompt('Task (tts, music, asr, sep, vad, other):', 'music') || 'other'
                  const familyPrompt = prompt('Family (ace_step, stable_audio, pocket_tts, qwen3_tts, etc.):', id) || id
                  try{
                    await window.api.importModel(id.trim(), f, taskPrompt.trim(), familyPrompt.trim());
                    refresh();
                    alert(`Imported ${f} → models/${id}`)
                  }catch(e:any){ alert(e.message)}
                }
              }
            }}>Import GGUF</button>

            <button className="btn ghost" onClick={async()=>{
              const d=await window.api.chooseFolder()
              if(d){
                const suggested = d.split(/\\|\//).pop()?.toLowerCase().replace(/[^a-z0-9]+/g,'_') || 'custom_model'
                const id = prompt('Import folder as model ID:', suggested)
                if(id){
                  const taskPrompt = prompt('Task (tts, music, asr, sep, vad, other):', 'music') || 'other'
                  const familyPrompt = prompt('Family (ace_step, stable_audio, pocket_tts, etc.):', id) || id
                  try{
                    await window.api.importModel(id.trim(), d, taskPrompt.trim(), familyPrompt.trim());
                    refresh();
                    alert(`Imported folder ${d} → models/${id}`)
                  }catch(e:any){ alert(e.message)}
                }
              }
            }}>Import Folder</button>

            <button className="btn ghost" onClick={()=> require('electron').shell.openExternal('https://huggingface.co/audio-cpp/audio.cpp-gguf/tree/main')}>Browse HF ↗</button>
            <button className="btn" onClick={refresh}>↻ Refresh</button>
          </div>
        </div>

        <div className="row" style={{marginTop:10}}>
          <input className="input" placeholder="Search models, files, families…" value={query} onChange={e=> setQuery(e.target.value)} style={{maxWidth:320}}/>
          <div className="row">{(['all','tts','music','asr','other'] as const).map(f=>(
            <button key={f} className={filter===f?'btn primary':'btn'} onClick={()=> setFilter(f)}>{f.toUpperCase()}</button>
          ))}</div>
        </div>
        <div className="small" style={{marginTop:8}}>Audio models run natively in C++. Click <b>Versions</b> to select quantized GGUF variants (Q8 / Q4 / BF16).</div>
      </div>

      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(360px,1fr))', gap:10}}>
        {filtered.map((m:any)=>{
          const pct=downloading[m.id]; const isDl= pct!==undefined && pct<100
          const isExpanded = expanded===m.id
          const vlist = variants[m.id] || []
          const isEditing = editingId===m.id

          return (
            <div key={m.id} className={`model-card ${m.installed?'installed':''}`}>
              <div className="row" style={{justifyContent:'space-between'}}>
                <div style={{fontWeight:700, fontSize:13}}>{m.label}</div>
                <span className="tag">{m.task?.toUpperCase()} • {m.size || 'GGUF'}</span>
              </div>
              <div className="small">{m.description}</div>
              <div className="small mono">
                Family: {m.family} • {m.primaryGguf ? `File: ${m.primaryGguf}` : m.runtime} {m.hfFolder && `• ${m.hfFolder}`}
              </div>

              {testResult[m.id] && (
                <div className="small mono" style={{marginTop:4, padding:'4px 8px', borderRadius:6, background:'var(--panel2)', border:'1px solid var(--border)'}}>
                  {testResult[m.id]}
                </div>
              )}

              {isDl && <div className="progress"><i style={{width:`${pct}%`}}></i></div>}
              {isDl && <div className="small mono">{pct}% {downloading[m.id+'_note']||''}</div>}

              {isEditing ? (
                <div style={{marginTop:8, padding:8, background:'var(--bg)', border:'1px solid var(--border)', borderRadius:8}}>
                  <div className="small" style={{fontWeight:700, marginBottom:4}}>Edit Model Metadata</div>
                  <div style={{display:'grid', gap:6}}>
                    <input className="input" placeholder="Display Label" value={editLabel} onChange={e=> setEditLabel(e.target.value)} />
                    <div style={{display:'flex', gap:6}}>
                      <select className="select" value={editTask} onChange={e=> setEditTask(e.target.value)} style={{flex:1}}>
                        <option value="tts">TTS (Speech)</option>
                        <option value="music">Music / Gen</option>
                        <option value="asr">ASR (Transcribe)</option>
                        <option value="sep">Separation</option>
                        <option value="vad">VAD</option>
                        <option value="other">Other</option>
                      </select>
                      <input className="input mono" placeholder="Family (e.g. ace_step)" value={editFamily} onChange={e=> setEditFamily(e.target.value)} style={{flex:1}} />
                    </div>
                    <div className="row" style={{justifyContent:'end', marginTop:4}}>
                      <button className="btn ghost" onClick={()=> setEditingId(null)}>Cancel</button>
                      <button className="btn primary" onClick={()=> saveEdit(m.id)}>Save</button>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="row" style={{marginTop:6, flexWrap:'wrap'}}>
                {m.installed ? (
                  <>
                    <span className="badge-installed">● Installed</span>
                    <button className="btn" onClick={()=> testModelRun(m.id)}>Test</button>
                    <button className="btn ghost" onClick={()=> startEdit(m)}>Edit</button>
                    <button className="btn ghost" onClick={async()=>{ await window.api.deleteModel(m.id); refresh()}}>Remove</button>
                    <button className="btn" onClick={()=> window.api.openFolder(m.localPath)}>Open</button>
                    <button className="btn ghost" onClick={async()=>{
                      const f=await window.api.chooseFile([{name:'GGUF', extensions:['gguf']}])
                      if(f){ try{ await window.api.importModel(m.id, f); refresh(); alert(`Re-imported → ${m.id}`)}catch(e:any){ alert(e.message)}}
                    }}>Import</button>
                  </>
                ) : (
                  <>
                    <button className="btn" disabled={loadingV[m.id]} onClick={()=> loadVariants(m.id)}>{loadingV[m.id]?'Loading…': isExpanded ? 'Hide' : 'Versions'}</button>
                    <button className="btn primary" disabled={isDl} onClick={async()=>{ setDownloading(p=> ({...p,[m.id]:0})); try{ await window.api.downloadModel(m.id)}catch(e:any){ alert(e.message); setDownloading(p=>{const n={...p}; delete n[m.id]; return n})}}}>⬇ Best match</button>
                    <button className="btn" disabled={isDl} onClick={async()=>{ setDownloading(p=> ({...p,[m.id]:0})); try{ await window.api.downloadAllModel(m.id)}catch(e:any){ alert(e.message); setDownloading(p=>{const n={...p}; delete n[m.id]; return n})}}}>⬇ All files</button>
                    <button className="btn" onClick={async()=>{
                      const url=prompt('Direct GGUF/HF URL for '+m.id); if(url){ setDownloading(p=> ({...p,[m.id]:0})); await window.api.downloadModel(m.id, url)}
                    }}>URL</button>
                    <button className="btn" onClick={async()=>{
                      const f=await window.api.chooseFile([{name:'GGUF', extensions:['gguf']}])
                      if(f){ try{ await window.api.importModel(m.id, f); refresh(); alert(`Imported → ${m.id}`)}catch(e:any){ alert(e.message)}}
                    }}>Import</button>
                  </>
                )}
                {m.hfFolder && <button className="btn ghost" onClick={()=> require('electron').shell.openExternal(`https://huggingface.co/audio-cpp/audio.cpp-gguf/tree/main/${m.hfFolder}`)}>HF ↗</button>}
              </div>

              {isExpanded && (
                <div style={{marginTop:8, padding:8, background:'var(--bg)', border:'1px solid var(--border)', borderRadius:8}}>
                  <div className="small" style={{fontWeight:700, marginBottom:6}}>Available GGUF versions — {vlist.length} files</div>
                  {vlist.length===0 && <div className="small">No .gguf found or HF API failed.</div>}
                  <div style={{display:'grid', gap:6, maxHeight:220, overflow:'auto'}}>
                    {vlist.map((v:any)=>(
                      <div key={v.path} className="release-card" style={{padding:'8px 10px'}}>
                        <div style={{minWidth:0, flex:1}}>
                          <div style={{fontWeight:600, fontSize:11, wordBreak:'break-all'}}>{v.fileName}</div>
                          <div className="small mono"><span style={{padding:'2px 6px', borderRadius:6, background:'var(--panel2)', border:'1px solid var(--border)', fontWeight:700}}>{v.precision.toUpperCase()}</span> • {fmtSize(v.size)} • {v.path}</div>
                        </div>
                        <button className="btn primary" style={{flexShrink:0, padding:'6px 10px', fontSize:11}} disabled={isDl} onClick={async()=>{
                          setDownloading(p=> ({...p,[m.id]:0}))
                          try{ await window.api.downloadModel(m.id, v.url)}catch(e:any){ alert(e.message); setDownloading(p=>{const n={...p}; delete n[m.id]; return n})}
                        }}>⬇ {v.precision.toUpperCase()}</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SettingsView({settings,setSettings,backend,setBackend,server,setServer}:any){
  const [saving,setSaving]=useState(false)
  if(!settings) return <div className="card">Loading…</div>
  return (
    <div style={{display:'grid', gap:14, maxWidth:880}}>
      <div className="hero"><h2>System</h2><p>Dark, sleek, self-contained. Your data, your drive.</p></div>
      <div className="card">
        <h3><span className="dot"/> Data folder</h3>
        <div className="row" style={{marginTop:8}}>
          <input className="input mono" value={settings.dataRoot} readOnly style={{flex:1, fontSize:12}} />
          <button className="btn" onClick={async()=>{const p=await window.api.chooseFolder(); if(p){ const ns=await window.api.saveSettings({dataRoot:p}); setSettings(ns); const b=await window.api.getBackendInfo(); setBackend(b)}}}>Choose</button>
          <button className="btn ghost" onClick={()=> window.api.openFolder(settings.dataRoot)}>Open</button>
        </div>
      </div>
      <div className="card">
        <h3><span className="dot"/> Backend — audio.cpp</h3>
        <div style={{padding:12, background:'var(--panel2)', border:'1px solid var(--border)', borderRadius:10}}>
          <div className="row" style={{justifyContent:'space-between'}}><div style={{fontWeight:700, fontSize:13, wordBreak:'break-all'}}>{backend?.path || 'No backend installed'}</div><span className={`pill ${backend?.hasCli?'live':''}`}>{backend?.hasCli?'● CLI ready':'○ missing'}</span></div>
          <div className="small mono" style={{marginTop:4}}>Version: {backend?.version || settings.backendVersion || '—'} • Mode: <b style={{color: backend?.acceleration==='cuda'?'#38BDF8':backend?.acceleration==='vulkan'?'#A855F7':'#4ADE80'}}>{backend?.acceleration?.toUpperCase() || 'CPU'} ACCELERATION</b> • {backend?.path?.includes('current')?'current active':''}</div>
          <div className="row" style={{marginTop:10, flexWrap:'wrap'}}>
            <button className="btn" onClick={async()=>{const f=await window.api.chooseFile([{name:'Backend ZIP', extensions:['zip']}]); if(f){ const r=await window.api.importBackendZip(f); setBackend(r.info); const ns=await window.api.getSettings(); setSettings(ns)}}}>📦 Import ZIP</button>
            <button className="btn" onClick={async()=>{ try{ const h=await window.api.runCliHelp(); alert(h.slice(0,700)) }catch(e:any){ alert(e.message)} }}>Test --help</button>
            <button className="btn" onClick={async()=>{
              if(!confirm('Repair backend? This will check for missing/corrupt files (audiocpp_cli.exe, server, DLLs) and re-extract or re-download the current version if needed. Continue?')) return
              try{
                const r:any = await window.api.repairBackend()
                setBackend(r.info)
                alert((r.repaired ? '✓ Repaired! ' : 'Info: ') + r.details)
                const s=await window.api.getSettings(); setSettings(s)
              }catch(e:any){ alert('Repair failed: '+e.message) }
            }}>Repair</button>
            <button className="btn ghost" onClick={()=> backend?.path && window.api.openFolder(backend.path)}>Open folder</button>
            {backend?.hasCli && <span className="small" style={{marginLeft:'auto'}}>Existing backend will be updated when you download a new release ↓</span>}
          </div>
        </div>

        <BackendVersions backend={backend} setBackend={setBackend} setSettings={setSettings} />

        <BackendReleases backend={backend} setBackend={setBackend} setSettings={setSettings} />
        <div className="divider" />
        <div className="grid2">
          <div><label className="small" style={{fontWeight:700}}>Host</label><input className="input mono" value={settings.serverHost} onChange={e=> setSettings({...settings, serverHost:e.target.value})} /></div>
          <div><label className="small" style={{fontWeight:700}}>Port</label><input className="input mono" type="number" value={settings.serverPort} onChange={e=> setSettings({...settings, serverPort: parseInt(e.target.value)||8080})} /></div>
        </div>
        <label className="row" style={{marginTop:10, cursor:'pointer', userSelect:'none', gap:8, padding:'8px 10px', background:'var(--panel2)', border:'1px solid var(--border)', borderRadius:8}}>
          <input type="checkbox" checked={!!settings.autoStartServer} onChange={e=> setSettings({...settings, autoStartServer:e.target.checked})} />
          <span className="small" style={{fontWeight:700, color:'var(--text)'}}>Auto-start server on Generate</span>
          <span className="small">— if off, falls back to CLI. Recommended ON.</span>
        </label>
        <div className="row" style={{marginTop:10}}>
          <button className="btn" disabled={!backend?.hasServer} onClick={async()=>{
            try{ const st=await window.api.startServer([]); setServer(st)}catch(e:any){ alert(e.message + '\n\nTip: If code 3221225781, see hint above — likely missing VC++ or CUDA. Use Test backend →') }
          }}>▶ Start</button>
          <button className="btn ghost" onClick={async()=>{ const st=await window.api.stopServer(); setServer(st)}}>■ Stop</button>
          <button
            className="btn ghost"
            disabled={!backend?.hasServer}
            title="Launch audio.cpp WebUI in your default browser"
            onClick={async()=>{
              try{
                await window.api.openWebUi()
                const st=await window.api.serverStatus()
                setServer(st)
              } catch(e:any){ alert(e.message) }
            }}
          >
            🌐 Open WebUI ↗
          </button>
          <button className="btn" onClick={async()=>{
            try{
              const r=await window.api.testBackend()
              const msg = `CLI: ${r.cli.ok?'✓ ok':'✗ FAIL'} code=${r.cli.code}\nServer: ${r.server.ok?'✓ ok':'✗ FAIL'} code=${r.server.code}\n${r.hint?'\nHint: '+r.hint:''}\n\n--- CLI ---\n${r.cli.out.slice(0,700)}\n\n--- Server ---\n${r.server.out.slice(0,700)}`
              alert(msg)
              if(r.cli.code===3221225781 || r.server.code===3221225781){
                if(confirm('Missing DLL detected (0xC0000135). Open VC++ Redist installer page?')) require('electron').shell.openExternal('https://aka.ms/vs/17/release/vc_redist.x64.exe')
              }
            }catch(e:any){ alert(e.message) }
          }}>Test backend</button>
          <span className="small mono" style={{marginLeft:'auto'}}>{server?.running?`pid ${server.pid}`:'stopped'}</span>
          <button className="btn ghost" onClick={async()=>{ const s=await window.api.serverLog(); alert((s.log||'no log').slice(-1500) || 'no log yet') }}>View log</button>
        </div>
        <div className="row" style={{marginTop:8}}>
          <button className="btn ghost" style={{fontSize:11}} onClick={()=> require('electron').shell.openExternal('https://aka.ms/vs/17/release/vc_redist.x64.exe')}>Install VC++ 2022 Redist ↗</button>
          <span className="small">3221225781 = STATUS_DLL_NOT_FOUND — usually VC++ or CUDA DLL missing. For no NVIDIA, pick CPU ZIP.</span>
        </div>
        {server?.log && <div className="small mono" style={{marginTop:8, padding:8, background:'var(--panel2)', border:'1px solid var(--border)', borderRadius:8, maxHeight:120, overflow:'auto', whiteSpace:'pre-wrap'}}>{server.log.slice(-900)}</div>}
        <div className="row" style={{marginTop:10}}><button className="btn primary" disabled={saving} onClick={async()=>{ setSaving(true); await window.api.saveSettings(settings); setSaving(false)}}>{saving?'Saving…':'Save'}</button></div>
      </div>
    </div>
  )
}

function BackendVersions({backend,setBackend,setSettings}:any){
  const [versions,setVersions]=useState<any[]>([])
  const refresh=async()=>{ try{ setVersions(await window.api.listBackendVersions()) }catch{} }
  useEffect(()=>{ refresh() },[backend])
  if(versions.length===0) return (
    <div className="card">
      <div className="row" style={{justifyContent:'space-between'}}><h3 style={{margin:0}}><span className="dot" style={{background:'#9CA3AF'}}/> Installed backends</h3><button className="btn" onClick={refresh}>↻ Refresh</button></div>
      <div className="small" style={{marginTop:8}}>No versioned backends yet — download from Releases or Import ZIP. Versions appear here and you can switch/delete.</div>
    </div>
  )
  return (
    <div className="card">
      <div className="row" style={{justifyContent:'space-between'}}><h3 style={{margin:0}}><span className="dot" style={{background:'#9CA3AF'}}/> Installed backends — select or delete</h3><button className="btn" onClick={refresh}>↻ Refresh</button></div>
      <div style={{marginTop:8, display:'grid', gap:6}}>
        {versions.map((v:any)=>(
          <div key={v.version} className="release-card" style={{borderColor: v.isCurrent ? '#22C55E' : undefined, background: v.isCurrent ? 'rgba(34,197,94,.06)' : undefined}}>
            <div style={{minWidth:0}}>
              <div style={{display:'flex',gap:6,alignItems:'center'}}><b style={{fontSize:12}}>{v.version}</b>{v.isCurrent && <span className="badge-installed">● active</span>}<span className="small mono">{v.hasCli?'CLI':'no CLI'} • {v.hasServer?'Server':'no server'} • {v.sizeMB} MB</span></div>
              <div className="small mono" style={{wordBreak:'break-all'}}>{v.path}</div>
            </div>
            <div className="row" style={{flexShrink:0}}>
              {!v.isCurrent ? <button className="btn" onClick={async()=>{ try{ const r=await window.api.selectBackendVersion(v.version); setBackend(r.info); const s=await window.api.getSettings(); setSettings(s)}catch(e:any){ alert(e.message)}}}>Select</button> : <span className="pill live">● Current</span>}
              {v.version!=='current' && <button className="btn ghost" onClick={async()=>{ if(confirm(`Delete backend ${v.version}?`)){ try{ const nv=await window.api.deleteBackendVersion(v.version); setVersions(nv); const b=await window.api.getBackendInfo(); setBackend(b)}catch(e:any){ alert(e.message)}}}}>Delete</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function BackendReleases({backend,setBackend,setSettings}:any){
  const [releases,setReleases]=useState<any[]|null>(null)
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState<string|null>(null)
  const [dl,setDl]=useState<Record<string,number>>({})
  const fetchReleases=async()=>{
    setLoading(true); setError(null)
    try{ const r=await window.api.listReleases(); setReleases(r)}catch(e:any){ setError(e.message)}
    setLoading(false)
  }
  useEffect(()=>{
    const off=window.api.onBackendProgress((d:any)=>{
      if(d.pct!==undefined) setDl(prev=> ({...prev, [d.url]: d.pct}))
      if(d.done){ setTimeout(async()=>{
        const b=await window.api.getBackendInfo(); setBackend(b); const s=await window.api.getSettings(); setSettings(s)
      },400)}
    })
    return ()=> off && off()
  },[])
  return (
    <div className="card">
      <div className="row" style={{justifyContent:'space-between'}}><h3 style={{margin:0}}><span className="dot" style={{background:'#FFFFFF'}}/> GitHub Releases — download & update</h3>
        <button className="btn" disabled={loading} onClick={fetchReleases}>{loading?'Fetching…':'↻ Fetch releases'}</button>
      </div>
      <div className="small" style={{marginTop:6}}>Pulls from <span className="mono">0xShug0/audio.cpp</span> releases. ZIPs → <span className="mono">backend/_downloads</span> → <span className="mono">backend/&lt;version&gt;</span> + <span className="mono">current</span> (updates).</div>
      <div className="small" style={{marginTop:6, padding:'6px 8px', background:'rgba(250,204,21,.06)', border:'1px solid rgba(250,204,21,.18)', borderRadius:8}}>
        • <b>NVIDIA GPUs:</b> Pick <b>CUDA 12.4</b> (CUDA companion runtime DLLs are auto-installed).<br/>
        • <b>AMD / Intel GPUs / CPUs without AVX-512:</b> Pick <b>VULKAN (PORTABLE)</b>. (Non-portable Vulkan requires AVX-512 and will crash on AMD Ryzen 5000 / Zen 3).
      </div>
      {error && <div style={{marginTop:10, padding:10, background:'#1A0E0E', border:'1px solid #3A1F1F', borderRadius:8, color:'#F87171', fontSize:12}}>{error}</div>}
      {!releases && !loading && !error && <div className="small" style={{marginTop:10, padding:10, background:'#0E0E0F', border:'1px dashed var(--border)', borderRadius:8}}>Click <b>Fetch releases</b> to list latest ZIPs — no browser needed.</div>}
      {releases && <div style={{marginTop:12, display:'grid', gap:8, maxHeight:340, overflow:'auto'}}>
        {releases.map((r:any)=>(
          <div key={r.tag} style={{padding:10, background:'var(--panel2)', border:'1px solid var(--border)', borderRadius:10}}>
            <div className="row" style={{justifyContent:'space-between'}}><b style={{fontSize:13}}>{r.tag} — {r.name}</b><a className="small mono" href="#" onClick={e=>{e.preventDefault(); require('electron').shell.openExternal(r.url)}}>GitHub →</a></div>
            <div className="small mono">{new Date(r.publishedAt).toLocaleDateString()} • {r.zipAssets.length} ZIPs</div>
            <div style={{marginTop:8, display:'grid', gap:6}}>
              {r.zipAssets.filter((a:any) => !a.name.toLowerCase().includes('-lib-') && !a.name.toLowerCase().includes('server-config')).map((a:any)=>{
                const pct=dl[a.url]
                const isDl=pct!==undefined && pct<100
                const lower=a.name.toLowerCase()
                const isCuda=lower.includes('cuda')
                const isCpu=lower.includes('cpu')
                const isVulkan=lower.includes('vulkan')
                const isPortable=lower.includes('portable')
                const isCudart=lower.includes('cudart')

                let badge = 'ZIP'
                let badgeColor = 'rgba(255,255,255,.06)'
                let note = ''

                if (isCudart) {
                  badge = 'CUDART'
                  badgeColor = 'rgba(56,189,248,.12)'
                  note = 'Companion CUDA runtime (auto-installed when downloading CUDA)'
                } else if (isCuda) {
                  const ver = lower.includes('13') ? '13.3' : '12.4'
                  badge = `CUDA ${ver} ⭐`
                  badgeColor = 'rgba(56,189,248,.18)'
                  note = 'NVIDIA GPU Acceleration (Auto-installs CUDA runtime)'
                } else if (isVulkan) {
                  badge = isPortable ? 'VULKAN (PORTABLE) ⭐' : 'VULKAN (AVX-512)'
                  badgeColor = isPortable ? 'rgba(168,85,247,.22)' : 'rgba(168,85,247,.10)'
                  note = isPortable ? 'Compatible with all GPUs & AMD Ryzen / Intel CPUs' : 'Requires AVX-512 (AMD Zen 4+ / Intel 10th+ gen)'
                } else if (isCpu) {
                  badge = isPortable ? 'CPU (PORTABLE) ⭐' : 'CPU (AVX-512)'
                  badgeColor = isPortable ? 'rgba(74,222,128,.18)' : 'rgba(74,222,128,.10)'
                  note = isPortable ? 'Universal CPU baseline' : 'High-end AVX-512 CPU'
                }

                return (
                  <div key={a.url} className="release-card">
                    <div style={{minWidth:0}}>
                      <div style={{display:'flex',gap:6,alignItems:'center'}}>
                        <span style={{fontSize:10,padding:'2px 6px',borderRadius:6,background:badgeColor,border:'1px solid var(--border)',fontWeight:700}}>{badge}</span>
                        <div style={{fontWeight:600, fontSize:12, wordBreak:'break-all'}}>{a.name}</div>
                      </div>
                      {note && <div className="small" style={{color:'#94A3B8', marginTop:2}}>{note}</div>}
                      <div className="small mono">{(a.size/1024/1024).toFixed(1)} MB • {a.downloads} downloads</div>
                      {isDl && <div className="progress" style={{marginTop:6}}><i style={{width:`${pct}%`}}></i></div>}
                    </div>
                    <button className="btn primary" disabled={isDl} style={{flexShrink:0}} onClick={async()=>{
                      setDl(p=> ({...p,[a.url]:0}))
                      try{
                        const res=await window.api.downloadRelease(a.url)
                        setBackend(res.info)
                        alert(`Backend ${res.version} installed — now active at ${res.backendPath}\nHardware mode: ${(res.info?.acceleration||'ready').toUpperCase()}`)
                      }
                      catch(e:any){ alert(e.message); setDl(p=> {const n={...p}; delete n[a.url]; return n})}
                    }}>{isDl?`${pct}%`:(backend?.hasCli?'Install / Switch →':'Download')}</button>
                  </div>
                )
              })}
              {r.zipAssets.length===0 && <div className="small">No ZIP assets in this release.</div>}
            </div>
          </div>
        ))}
      </div>}
    </div>
  )
}
