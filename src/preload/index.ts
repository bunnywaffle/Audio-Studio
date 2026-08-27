import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  // settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (s:any) => ipcRenderer.invoke('settings:save', s),
  chooseFolder: () => ipcRenderer.invoke('dialog:chooseFolder'),
  chooseFile: (filters:any) => ipcRenderer.invoke('dialog:chooseFile', filters),
  openFolder: (p:string) => ipcRenderer.invoke('shell:openFolder', p),

  // backend
  getBackendInfo: () => ipcRenderer.invoke('backend:info'),
  importBackendZip: (zipPath:string) => ipcRenderer.invoke('backend:importZip', zipPath),
  runCliHelp: () => ipcRenderer.invoke('backend:cliHelp'),
  checkServerHealth: () => ipcRenderer.invoke('backend:health'),
  listReleases: () => ipcRenderer.invoke('backend:listReleases'),
  downloadRelease: (url:string) => ipcRenderer.invoke('backend:downloadRelease', url),
  testBackend: () => ipcRenderer.invoke('backend:test'),
  repairBackend: () => ipcRenderer.invoke('backend:repair'),
  listBackendVersions: () => ipcRenderer.invoke('backend:listVersions'),
  selectBackendVersion: (v:string) => ipcRenderer.invoke('backend:selectVersion', v),
  deleteBackendVersion: (v:string) => ipcRenderer.invoke('backend:deleteVersion', v),
  onBackendProgress: (cb:(data:any)=>void)=>{ const h=(_:any,d:any)=> cb(d); ipcRenderer.on('backend:downloadProgress',h); return ()=> ipcRenderer.removeListener('backend:downloadProgress',h) },

  // models
  listModels: () => ipcRenderer.invoke('models:list'),
  listAllModels: () => ipcRenderer.invoke('models:listAll'),
  listHfFolders: () => ipcRenderer.invoke('models:listHf'),
  getModelVariants: (id:string) => ipcRenderer.invoke('models:getVariants', id),
  deleteModel: (id:string) => ipcRenderer.invoke('models:delete', id),
  downloadModel: (id:string, url?:string) => ipcRenderer.invoke('models:download', id, url),
  importModel: (id:string, sourcePath:string, task?:string, family?:string) => ipcRenderer.invoke('models:import', id, sourcePath, task, family),
  downloadAllModel: (id:string) => ipcRenderer.invoke('models:downloadAll', id),
  updateCustomModel: (id:string, metadata:any) => ipcRenderer.invoke('models:updateCustom', id, metadata),
  testModel: (id:string) => ipcRenderer.invoke('models:test', id),
  onDownloadProgress: (cb:(data:any)=>void) => {
    const handler = (_:any, data:any)=> cb(data)
    ipcRenderer.on('models:downloadProgress', handler)
    return ()=> ipcRenderer.removeListener('models:downloadProgress', handler)
  },

  // server
  startServer: (models:any[]) => ipcRenderer.invoke('server:start', models),
  stopServer: () => ipcRenderer.invoke('server:stop'),
  serverStatus: () => ipcRenderer.invoke('server:status'),
  serverLog: () => ipcRenderer.invoke('server:log'),

  // generation (via CLI fallback / server)
  tts: (opts:any) => ipcRenderer.invoke('gen:tts', opts),
  music: (opts:any) => ipcRenderer.invoke('gen:music', opts),
  asr: (opts:any) => ipcRenderer.invoke('gen:asr', opts),

  // utils
  listOutputs: () => ipcRenderer.invoke('outputs:list'),
  revealOutput: (file:string) => ipcRenderer.invoke('outputs:reveal', file),
})
