import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

export interface AppSettings {
  dataRoot: string
  backendPath: string | null // folder containing audiocpp_server / cli
  backendVersion: string | null
  serverPort: number
  serverHost: string
  theme: 'dark' | 'light'
  defaultLanguage: string
  autoStartServer: boolean
  customModels?: Record<string, { family?: string, task?: string, label?: string, description?: string }>
}

const DEFAULT_DATA_ROOT = path.join(app.getPath('documents'), 'audio.cpp Studio')

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json')
}

export function ensureDataDirs(dataRoot: string) {
  const dirs = [
    dataRoot,
    path.join(dataRoot, 'models'),
    path.join(dataRoot, 'backend'),
    path.join(dataRoot, 'outputs'),
    path.join(dataRoot, 'voices'),
  ]
  for (const d of dirs) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })
  }
}

export function loadSettings(): AppSettings {
  const p = getSettingsPath()
  let s: Partial<AppSettings> = {}
  if (fs.existsSync(p)) {
    try { s = JSON.parse(fs.readFileSync(p, 'utf-8')) } catch {}
  }
  const dataRoot = s.dataRoot && fs.existsSync(s.dataRoot) ? s.dataRoot : DEFAULT_DATA_ROOT
  ensureDataDirs(dataRoot)
  const merged: AppSettings = {
    dataRoot,
    backendPath: s.backendPath ?? null,
    backendVersion: s.backendVersion ?? null,
    serverPort: s.serverPort ?? 8080,
    serverHost: s.serverHost ?? '127.0.0.1',
    theme: s.theme ?? 'dark',
    defaultLanguage: s.defaultLanguage ?? 'en',
    autoStartServer: s.autoStartServer ?? true,
    customModels: s.customModels ?? {},
  }
  // auto-detect backend if not set but exists
  if (!merged.backendPath) {
    const candidate = path.join(dataRoot, 'backend', 'current')
    if (fs.existsSync(candidate)) merged.backendPath = candidate
  }
  return merged
}

export function saveSettings(settings: AppSettings) {
  ensureDataDirs(settings.dataRoot)
  fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf-8')
}

export function getDefaultDataRoot() { return DEFAULT_DATA_ROOT }
