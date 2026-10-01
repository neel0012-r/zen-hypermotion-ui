const {
  Hotkey,
  windowUtils,
  SharedGlobal,
  Pref,
  FileSystem,
  restartApplication,
  startupFinished,
  createElement,
  createWidget,
  escapeXUL,
  loadURI,
  loaderModuleLink,
  showNotification
  } = ChromeUtils.importESModule("chrome://userchromejs/content/utils.sys.mjs");

export {
  FileSystem,
  Hotkey as Hotkeys,
  Pref as Prefs,
  SharedGlobal as SharedStorage,
  windowUtils as Windows
}

export const Runtime = Object.freeze({
  appVariant: loaderModuleLink.variant.THUNDERBIRD
    ? "Thunderbird"
    : "Firefox",
  brandName: loaderModuleLink.brandName,
  config: null,
  restart: restartApplication,
  startupFinished: startupFinished,
  loaderVersion: loaderModuleLink.version
});

export const Utils = Object.freeze({
  createElement: createElement,
  createWidget: createWidget,
  escapeXUL: escapeXUL,
  loadURI: loadURI
});

export const Scripts = Object.freeze({
  openScriptDir() {
    FileSystem.getScriptDir().showInFileManager()
  }
});

export const Notifications = Object.freeze({
  show(def){
    showNotification(def)
  }
});
