const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  listDataset: (folder) => ipcRenderer.invoke('list-dataset', folder),
  getThumbnail: (imagePath, size) => ipcRenderer.invoke('get-thumbnail', imagePath, size),
  getImageData: (imagePath) => ipcRenderer.invoke('get-image-data', imagePath),
  readJson: (jsonPath) => ipcRenderer.invoke('read-json', jsonPath),
  writeJson: (jsonPath, data) => ipcRenderer.invoke('write-json', jsonPath, data),
  writeJsonAtomic: (folder, base, data) => ipcRenderer.invoke('write-json-atomic', folder, base, data),
  checkPath: (p) => ipcRenderer.invoke('check-path', p),
  getPathForFile: (file) => {
    try {
      const { webUtils } = require('electron');
      return webUtils.getPathForFile(file);
    } catch { return file.path || ''; }
  },
  // models
  listModels: () => ipcRenderer.invoke('list-models'),
  uploadModel: (srcPath) => ipcRenderer.invoke('upload-model', srcPath),
  deleteModel: (name) => ipcRenderer.invoke('delete-model', name),
  setActiveModel: (name, mmproj) => ipcRenderer.invoke('set-active-model', name, mmproj),
  getActiveModel: () => ipcRenderer.invoke('get-active-model'),
  selectModelFile: () => ipcRenderer.invoke('select-model-file'),
  // inference
  generateOne: (opts) => ipcRenderer.invoke('generate-one', opts),
  cancelGenerate: () => ipcRenderer.invoke('cancel-generate'),
  getInferenceStatus: () => ipcRenderer.invoke('get-inference-status'),
  restartServer: () => ipcRenderer.invoke('restart-server'),
  testModel: () => ipcRenderer.invoke('test-model'),
  // prompt
  getPrompt: () => ipcRenderer.invoke('get-prompt'),
  savePrompt: (text) => ipcRenderer.invoke('save-prompt', text),
  restorePrompt: () => ipcRenderer.invoke('restore-prompt'),
  // events
  onBatchProgress: (cb) => {
    const h = (_e, p) => cb(p);
    ipcRenderer.on('batch-progress', h);
    return () => ipcRenderer.removeListener('batch-progress', h);
  },
  onGenerateProgress: (cb) => {
    const h = (_e, p) => cb(p);
    ipcRenderer.on('generate-progress', h);
    return () => ipcRenderer.removeListener('generate-progress', h);
  }
});
