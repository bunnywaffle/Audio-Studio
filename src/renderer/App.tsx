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
        <div className="brand"><div className="logo">◉</div><div>audio.cpp Studio<br/><small>DARK • SLEEK • LOCAL</small></div><span className="badge">v0.1 • ggml</span></div>
        <span className={`pill ${backend?.hasCli?'live':''}`}>{backend?.hasCli?'● Backend ready':'○ Backend missing'}</span>
        <span className={`pill ${server?.running?'live':''}`}>{server?.running?`● :${server.port}`:'○ Server off'}</span>
        <div className="right">
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

/* Sleek Model Picker */
function ModelPicker({models, value, onChange, placeholder="Choose model"}:{models:any[], value:string, onChange:(id:string)=>void, placeholder?:string}){
  const [open,setOpen]=useState(false)
  const [q,setQ]=useState('')
  const ref=useRef<HTMLDivElement>(null)
  const selected = models.find((m:any)=> m.id===value)
  const filtered = models.filter((m:any)=> !q || `${m.label} ${m.id} ${m.family} ${m.description}`.toLowerCase().includes(q.toLowerCase()))
  useEffect(()=>{
    const h=(e:MouseEvent)=>{ if(ref.current && !ref.current.contains(e.target as Node)) setOpen(false)}
    document.addEventListener('mousedown',h); return()=> document.removeEventListener('mousedown',h)
  },[])
  return (
    <div className="model-picker" ref={ref}>
      <button className="model-trigger" onClick={()=> setOpen(!open)}>
        <div className="opt-ico" style={{width:30,height:30,fontSize:13}}>{selected?.task==='tts'?'🗣':selected?.task==='music'?'♫':selected?.task==='asr'?'●':'▦'}</div>
        <div className="meta">
          <b>{selected ? `${selected.label} — ${selected.size}` : placeholder}</b>
          <span>{selected ? `${selected.family} • ${selected.runtime}${selected.installed?' • installed':''}` : 'No model selected'}</span>
        </div>
        <span className={selected?.installed?'badge-installed':'badge-missing'}>{selected?.installed?'● installed':'○ not installed'}</span>
        <span className="chev">{open?'▲':'▼'}</span>
      </button>
      {open && (
        <div className="model-dropdown">
          <div className="search"><input autoFocus placeholder="Search models…" value={q} onChange={e=> setQ(e.target.value)} /><span className="kbd">{filtered.length}</span></div>
          <div className="list">
            {filtered.map((m:any)=>(
              <div key={m.id} className={`model-option ${m.id===value?'active':''}`} onClick={()=>{ onChange(m.id); setOpen(false); setQ('')}}>
                <div className="opt-ico">{m.task==='tts'?'🗣':m.task==='music'?'♫':m.task==='asr'?'●':'▦'}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:'flex',gap:6,alignItems:'center'}}><b style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{m.label}</b><span className="kbd">{m.size}</span><span className={m.installed?'badge-installed':'badge-missing'} style={{marginLeft:'auto'}}>{m.installed?'installed':'get'}</span></div>
                  <div className="small mono" style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{m.family} • {m.runtime} • {m.language.slice(0,22)}</div>
                  <div className="small" style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{m.description}</div>
                </div>
              </div>
            ))}
            {filtered.length===0 && <div className="small" style={{padding:12,textAlign:'center'}}>No match</div>}
          </div>
        </div>
      )}
    </div>
  )
}

function TTS(){
  const {models}=useModels()
  const ttsModels=models.filter((m:any)=> m.task==='tts')
  const [modelId,setModelId]=useState('')
  const [text,setText]=useState('Hello! audio.cpp Studio is running locally — no Python needed. Try cloning a voice!')
  const [voiceId,setVoiceId]=useState('')
  const [voiceRef,setVoiceRef]=useState('')
  const [drag,setDrag]=useState(false)
  const [language,setLanguage]=useState('en')
  const [busy,setBusy]=useState(false)
  const [result,setResult]=useState<any>(null)
  const [outputs,setOutputs]=useState<any[]>([])
  useEffect(()=>{ if(!modelId && ttsModels[0]) setModelId(ttsModels[0].id)},[ttsModels])
  useEffect(()=>{ window.api.listOutputs().then(setOutputs)},[result])
  const fileName = voiceRef ? voiceRef.split(/\\|\//).pop() : ''
  return (
    <div style={{display:'grid', gap:14, maxWidth:1140}}>
      <div className="hero">
        <div className="row" style={{justifyContent:'space-between'}}>
          <div><h2>Text to Speech</h2><p>Natural, instant, local. Clone any voice with a single sample — sleek dark studio, zero cloud.</p></div>
          <div className="wave"><i/><i/><i/><i/><i/></div>
        </div>
      </div>

      <div className="grid2" style={{alignItems:'start'}}>
        <div className="card">
          <h3><span className="dot"/> Script</h3>
          <label className="small" style={{fontWeight:700}}>Model — sleek picker</label>
          <ModelPicker models={ttsModels} value={modelId} onChange={setModelId} placeholder="Choose a TTS model" />
          <div className="small" style={{marginTop:6}}>{ttsModels.filter((m:any)=>m.installed).length} installed • open <b>Models</b> to add more</div>

          <div style={{marginTop:12}} className="grid2">
            <div><label className="small" style={{fontWeight:700}}>Language</label><select className="select" value={language} onChange={e=> setLanguage(e.target.value)}><option value="en">English</option><option value="es">Spanish</option><option value="zh">中文</option><option value="ja">日本語</option><option value="de">Deutsch</option><option value="fr">Français</option></select></div>
            <div><label className="small" style={{fontWeight:700}}>Preset voice</label><input className="input" placeholder="alba / calm_male — or use clone →" value={voiceId} onChange={e=> setVoiceId(e.target.value)} /></div>
          </div>

          <div style={{marginTop:12}}>
            <label className="small" style={{fontWeight:700}}>Text</label>
            <textarea className="textarea" value={text} onChange={e=> setText(e.target.value)} placeholder="Type what you want to hear — long text auto-splits" />
            <div className="row" style={{marginTop:8, justifyContent:'space-between'}}><span className="small mono">{text.length} chars • ~{Math.ceil(text.split(/\s+/).length/150)} min</span><span className="pill">long text → auto-merge</span></div>
          </div>

          <button className="btn primary" style={{width:'100%', justifyContent:'center', padding:'12px', marginTop:14, fontSize:14}} disabled={busy || !modelId || !text.trim()} onClick={async()=>{
            setBusy(true); setResult(null)
            try{ const r=await window.api.tts({ modelId, family: ttsModels.find((m:any)=> m.id===modelId)?.family, text, voiceRef: voiceRef||undefined, voiceId: voiceId||undefined, language }); setResult(r)}
            catch(e:any){ setResult({error:e.message}) }
            setBusy(false)
          }}>{busy?'Synthesizing…':'▶ Generate speech'}</button>

          {result && <div style={{marginTop:12, padding:12, background:'var(--panel2)', border:'1px solid var(--border)', borderRadius:10}}>
            {result.error ? <div style={{color:'#F87171', fontWeight:700}}>{result.error}</div> : <>
              <div className="small mono">via {result.via}</div>
              <div style={{fontWeight:700, wordBreak:'break-all', fontSize:12}}>{result.outFile}</div>
              {result.outFile?.endsWith('.wav') || result.outFile?.endsWith('.mp3') ? <audio controls src={`file://${result.outFile}`} style={{width:'100%', marginTop:8}}/> : null}
              <div className="row" style={{marginTop:8}}><button className="btn" onClick={()=> window.api.revealOutput(result.outFile)}>Show in folder</button><button className="btn ghost" onClick={()=> navigator.clipboard.writeText(result.outFile)}>Copy</button></div>
            </>}
          </div>}
        </div>

        <div style={{display:'grid', gap:12}}>
          <div className="voice-card">
            <div className="head"><span style={{width:28,height:28,borderRadius:8,display:'grid',placeItems:'center',background:'var(--text)',color:'var(--bg)',fontSize:13}}>◉</span><b>Clone voice</b><span className="badge-missing" style={{marginLeft:'auto'}}>clear & aesthetic</span></div>
            <div className="small" style={{marginBottom:10}}>Drop a clean <b>10–30s</b> sample. Mono, quiet, single speaker.</div>
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
            <div style={{marginTop:10, padding:'9px 10px', borderRadius:10, background:'var(--panel2)', border:'1px solid var(--border)', fontSize:11, lineHeight:1.5, color:'var(--muted)'}}>
              <b style={{color:'var(--text)'}}>Tip</b> — your own voice = instant host. No echo, no bgm.
            </div>
          </div>

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
  const musicModels=models.filter((m:any)=> m.task==='music')
  const [modelId,setModelId]=useState('')
  const [prompt,setPrompt]=useState('lofi hip hop, warm Rhodes, gentle drums, cozy night')
  const [lyrics,setLyrics]=useState('')
  const [duration,setDuration]=useState('30')
  const [busy,setBusy]=useState(false)
  const [result,setResult]=useState<any>(null)
  useEffect(()=>{ if(!modelId && musicModels[0]) setModelId(musicModels[0].id)},[musicModels])
  return (
    <div style={{display:'grid', gap:14, maxWidth:1020}}>
      <div className="hero"><h2>Music</h2><p>Text to song — describe a vibe, get a track.</p></div>
      <div className="card">
        <h3><span className="dot"/> Compose</h3>
        <label className="small" style={{fontWeight:700}}>Model</label>
        <ModelPicker models={musicModels} value={modelId} onChange={setModelId} placeholder="Choose music model" />
        <div style={{marginTop:10}}><label className="small" style={{fontWeight:700}}>Duration</label><select className="select" value={duration} onChange={e=> setDuration(e.target.value)}><option value="15">15s</option><option value="30">30s</option><option value="60">60s</option><option value="120">120s</option></select></div>
        <div style={{marginTop:12}}><label className="small" style={{fontWeight:700}}>Prompt</label><textarea className="textarea" style={{minHeight:80}} value={prompt} onChange={e=> setPrompt(e.target.value)} /></div>
        <div style={{marginTop:12}}><label className="small" style={{fontWeight:700}}>Lyrics <span style={{fontWeight:400}}>(optional)</span></label><textarea className="textarea" style={{minHeight:80}} value={lyrics} onChange={e=> setLyrics(e.target.value)} placeholder="Verse / chorus..." /></div>
        <div className="row" style={{marginTop:12, justifyContent:'end'}}><button className="btn primary" disabled={busy || !modelId || !prompt.trim()} onClick={async()=>{
          setBusy(true); setResult(null); try{ const r=await window.api.music({ modelId, family: musicModels.find((m:any)=> m.id===modelId)?.family, prompt, lyrics, duration }); setResult(r)}catch(e:any){ setResult({error:e.message})}; setBusy(false)
        }}>{busy?'Composing…':'♫ Generate music'}</button></div>
        {result && <div style={{marginTop:12, padding:12, background:'var(--panel2)', border:'1px solid var(--border)', borderRadius:10}}>
          {result.error ? <div style={{color:'#F87171'}}>{result.error}</div> : <><div className="small mono">via {result.via}</div><div style={{fontWeight:700, wordBreak:'break-all', fontSize:12}}>{result.outFile}</div>{result.outFile?.endsWith('.wav') && <audio controls src={`file://${result.outFile}`} style={{width:'100%', marginTop:8}}/>}<div className="row" style={{marginTop:8}}><button className="btn" onClick={()=> window.api.revealOutput(result.outFile)}>Show</button></div></>}
        </div>}
      </div>
    </div>
  )
}

function ASR(){
  const {models}=useModels()
  const asrModels=models.filter((m:any)=> m.task==='asr')
  const [modelId,setModelId]=useState('')
  const [audioPath,setAudioPath]=useState('')
  const [drag,setDrag]=useState(false)
  const [busy,setBusy]=useState(false)
  const [result,setResult]=useState<any>(null)
  useEffect(()=>{ if(!modelId && asrModels[0]) setModelId(asrModels[0].id)},[asrModels])
  return (
    <div style={{display:'grid', gap:14, maxWidth:1020}}>
      <div className="hero"><h2>Speech → Text</h2><p>Long meetings, podcasts — VAD chunking handles hours.</p></div>
      <div className="card">
        <h3><span className="dot" style={{background:'#22C55E'}}/> Transcribe</h3>
        <label className="small" style={{fontWeight:700}}>Model</label>
        <ModelPicker models={asrModels} value={modelId} onChange={setModelId} placeholder="Choose ASR model" />
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
          setBusy(true); setResult(null); try{ const r=await window.api.asr({ modelId, family: asrModels.find((m:any)=> m.id===modelId)?.family, audioPath }); setResult(r)}catch(e:any){ setResult({error:e.message})}; setBusy(false)
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
  const refresh=async()=>{
    try{
      const all = await window.api.listAllModels()
      setModels(all)
    }catch{ setModels(await window.api.listModels()) }
  }
  useEffect(()=>{ refresh(); const off=window.api.onDownloadProgress((d:any)=>{ setDownloading(prev=> ({...prev, [d.id]: d.pct})); if(d.done || d.error) setTimeout(refresh,400)}); return ()=> off && off() },[])
  const filtered=models.filter((m:any)=>{
    if(filter!=='all' && !m.task.includes(filter as any) && !(filter==='other' && !['tts','music','asr'].includes(m.task))) return false
    if(query && !`${m.label} ${m.family} ${m.description}`.toLowerCase().includes(query.toLowerCase())) return false
    return true
  })
  return (
    <div style={{display:'grid', gap:14}}>
      <div className="card">
        <div className="row" style={{justifyContent:'space-between'}}><h3 style={{margin:0}}><span className="dot"/> Models — {models.filter((m:any)=> m.installed).length} / {models.length}</h3><div className="row"><button className="btn ghost" onClick={()=> require('electron').shell.openExternal('https://huggingface.co/audio-cpp/audio.cpp-gguf/tree/main')}>Browse HF repo ↗</button><button className="btn" onClick={refresh}>↻ Refresh</button></div></div>
        <div className="row" style={{marginTop:10}}>
          <input className="input" placeholder="Search…" value={query} onChange={e=> setQuery(e.target.value)} style={{maxWidth:320}}/>
          <div className="row">{(['all','tts','music','asr','other'] as const).map(f=>(
            <button key={f} className={filter===f?'btn primary':'btn'} onClick={()=> setFilter(f)}>{f}</button>
          ))}</div>
        </div>
      </div>
      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(340px,1fr))', gap:10}}>
        {filtered.map((m:any)=>{
          const pct=downloading[m.id]; const isDl= pct!==undefined && pct<100
          return (
            <div key={m.id} className={`model-card ${m.installed?'installed':''}`}>
              <div className="row" style={{justifyContent:'space-between'}}><div style={{fontWeight:700, fontSize:13}}>{m.label}</div><span className="tag">{m.task.toUpperCase()} • {m.size}</span></div>
              <div className="small">{m.description}</div>
              <div className="small mono">{m.family} • {m.runtime}</div>
              {isDl && <div className="progress"><i style={{width:`${pct}%`}}></i></div>}
              <div className="row" style={{marginTop:6, flexWrap:'wrap'}}>
                {m.installed ? <><span className="badge-installed">● Installed</span><button className="btn ghost" onClick={async()=>{ await window.api.deleteModel(m.id); refresh()}}>Remove</button><button className="btn" onClick={()=> window.api.openFolder(m.localPath)}>Open</button></> : <><button className="btn primary" disabled={isDl} onClick={async()=>{ setDownloading(p=> ({...p,[m.id]:0})); try{ await window.api.downloadModel(m.id)}catch(e:any){ alert(e.message); setDownloading(p=>{const n={...p}; delete n[m.id]; return n})}}}>⬇ Download</button><button className="btn" onClick={async()=>{
                  const url=prompt('Direct GGUF/HF URL for '+m.id); if(url){ setDownloading(p=> ({...p,[m.id]:0})); await window.api.downloadModel(m.id, url)}
                }}>From URL</button></>}
                {m.hfFolder && <button className="btn ghost" onClick={()=> require('electron').shell.openExternal(`https://huggingface.co/audio-cpp/audio.cpp-gguf/tree/main/${m.hfFolder}`)}>HF ↗</button>}
              </div>
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
          <div className="small mono" style={{marginTop:4}}>Version: {backend?.version || settings.backendVersion || '—'} • Current → {backend?.path?.includes('current')?'auto-updates on download':''}</div>
          <div className="row" style={{marginTop:10, flexWrap:'wrap'}}>
            <button className="btn" onClick={async()=>{const f=await window.api.chooseFile([{name:'Backend ZIP', extensions:['zip']}]); if(f){ const r=await window.api.importBackendZip(f); setBackend(r.info); const ns=await window.api.getSettings(); setSettings(ns)}}}>📦 Import ZIP</button>
            <button className="btn" onClick={async()=>{ try{ const h=await window.api.runCliHelp(); alert(h.slice(0,700)) }catch(e:any){ alert(e.message)} }}>Test --help</button>
            <button className="btn ghost" onClick={()=> backend?.path && window.api.openFolder(backend.path)}>Open folder</button>
            {backend?.hasCli && <span className="small" style={{marginLeft:'auto'}}>Existing backend will be updated when you download a new release ↓</span>}
          </div>
        </div>

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
      <div className="small" style={{marginTop:6, padding:'6px 8px', background:'rgba(250,204,21,.06)', border:'1px solid rgba(250,204,21,.18)', borderRadius:8}}>No NVIDIA GPU? Pick the <b>CPU</b> ZIP. CUDA ZIP needs NVIDIA driver + CUDA 12 + <a href="#" onClick={e=>{e.preventDefault(); require('electron').shell.openExternal('https://aka.ms/vs/17/release/vc_redist.x64.exe')}}>VC++ Redist</a>.</div>
      {error && <div style={{marginTop:10, padding:10, background:'#1A0E0E', border:'1px solid #3A1F1F', borderRadius:8, color:'#F87171', fontSize:12}}>{error}</div>}
      {!releases && !loading && !error && <div className="small" style={{marginTop:10, padding:10, background:'#0E0E0F', border:'1px dashed var(--border)', borderRadius:8}}>Click <b>Fetch releases</b> to list latest ZIPs — no browser needed.</div>}
      {releases && <div style={{marginTop:12, display:'grid', gap:8, maxHeight:340, overflow:'auto'}}>
        {releases.map((r:any)=>(
          <div key={r.tag} style={{padding:10, background:'var(--panel2)', border:'1px solid var(--border)', borderRadius:10}}>
            <div className="row" style={{justifyContent:'space-between'}}><b style={{fontSize:13}}>{r.tag} — {r.name}</b><a className="small mono" href="#" onClick={e=>{e.preventDefault(); require('electron').shell.openExternal(r.url)}}>GitHub →</a></div>
            <div className="small mono">{new Date(r.publishedAt).toLocaleDateString()} • {r.zipAssets.length} ZIPs</div>
            <div style={{marginTop:8, display:'grid', gap:6}}>
              {r.zipAssets.map((a:any)=>{
                const pct=dl[a.url]
                const isDl=pct!==undefined && pct<100
                const lower=a.name.toLowerCase()
                const isCuda=lower.includes('cuda')
                const isCpu=lower.includes('cpu') || lower.includes('win-cpu')
                const badge = isCuda ? 'CUDA' : isCpu ? 'CPU' : lower.includes('vulkan') ? 'VULKAN' : 'ZIP'
                const badgeColor = isCuda ? 'rgba(56,189,248,.12)' : isCpu ? 'rgba(74,222,128,.12)' : 'rgba(255,255,255,.06)'
                return (
                  <div key={a.url} className="release-card">
                    <div style={{minWidth:0}}><div style={{display:'flex',gap:6,alignItems:'center'}}><span style={{fontSize:10,padding:'2px 6px',borderRadius:6,background:badgeColor,border:'1px solid var(--border)',fontWeight:700}}>{badge}</span><div style={{fontWeight:600, fontSize:12, wordBreak:'break-all'}}>{a.name}</div></div><div className="small mono">{(a.size/1024/1024).toFixed(1)} MB • {a.downloads} downloads</div>{isDl && <div className="progress" style={{marginTop:6}}><i style={{width:`${pct}%`}}></i></div>}</div>
                    <button className="btn primary" disabled={isDl} style={{flexShrink:0}} onClick={async()=>{
                      setDl(p=> ({...p,[a.url]:0}))
                      try{ const res=await window.api.downloadRelease(a.url); setBackend(res.info); alert(`Backend ${res.version} installed — now using ${res.backendPath}\nIf Start still fails with 3221225781, run Test backend above.`)}
                      catch(e:any){ alert(e.message); setDl(p=> {const n={...p}; delete n[a.url]; return n})}
                    }}>{isDl?`${pct}%`:(backend?.hasCli?'Update →':'Download')}</button>
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
