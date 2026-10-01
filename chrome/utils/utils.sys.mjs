import { FileSystem } from "chrome://userchromejs/content/fs.sys.mjs";
export { FileSystem };
export const SharedGlobal = {};
ChromeUtils.defineLazyGetter(SharedGlobal,"widgetCallbacks",() => {return new Map()});
const lazy = {
  startupPromises: new Set()
};

function defineModuleGettersWithFallback(target, description){
  for(let [name, value] of Object.entries(description)){
    const { url, fallback } = value;
    Object.defineProperty(target,name,{
      get: () => {
        let module;
        try{
          module = ChromeUtils.importESModule(url);
        }catch(e){
          console.warn(e);
          module = ChromeUtils.importESModule(fallback);
        }
        Object.defineProperty(target,name,{ value: module[name], configurable: false });
        return module[name]
      },
      configurable: true
    })
  }
}

defineModuleGettersWithFallback(lazy,{
  CustomizableUI: {
    url: "moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs",
    fallback: "resource:///modules/CustomizableUI.sys.mjs"
  }
});

export class Hotkey{
  #matchingSelector;
  constructor(hotkeyDetails,commandDetails){
    this.command = commandDetails;
    this.trigger = hotkeyDetails;
    this.#matchingSelector = null;
  }
  get matchingSelector(){
    if(!this.#matchingSelector){
      let trigger = this.trigger;
      this.#matchingSelector = `key[modifiers="${trigger.modifiers}"][${trigger.key?'key="'+trigger.key:'keycode="'+trigger.keycode}"]`
    }
    return this.#matchingSelector
  }
  async autoAttach(opt){
    const suppress = opt?.suppressOriginal || false;
    await startupFinished();
    for (let window of windowUtils.getAll()){
      if(window.document.getElementById(this.trigger.id)){
        continue
      }
      this.attachToWindow(window,{suppressOriginal: suppress})
    }
    windowUtils.onCreated(win => {
      windowUtils.isBrowserWindow(win) && this.attachToWindow(win,{suppressOriginal: suppress})
    })
  }
  async attachToWindow(window,opt = {}){
    await windowUtils.waitWindowLoading(window);
    if(opt.suppressOriginal){
      this.suppressOriginalKey(window)
    }
    Hotkey.#createKey(window.document,this.trigger);
    if(this.command){
      Hotkey.#createCommand(window.document,this.command);
    }
  }
  suppressOriginalKey(window){
    let oldKey = window.document.querySelector(this.matchingSelector);
    if(oldKey){
      oldKey.setAttribute("disabled","true")
    }
  }
  restoreOriginalKey(window){
    let oldKey = window.document.querySelector(this.matchingSelector);
    oldKey.removeAttribute("disabled");
  }
  static #createKey(doc,details){
    let keySet = doc.getElementById("ucKeySet");
    if(!keySet){
      keySet = createElement(doc,"keyset",{id:"ucKeySet"});
      doc.body.appendChild(keySet);
    }
    
    let key = createElement(doc,"key",details);
    keySet.appendChild(key);
    return
  }
  static #createCommand(doc,details){
    let commandSet = doc.getElementById("ucCommandSet");
    if(!commandSet){
      commandSet = createElement(doc,"commandset",{id:"ucCommandSet"});
      doc.body.insertBefore(commandSet,doc.body.firstChild);
    }
    if(doc.getElementById(details.id)){
      console.warn("Fx-autoconfig: command with id '"+details.id+"' already exists");
      return
    }
    let command = createElement(doc,"command",{id: details.id});
    commandSet.insertBefore(command,commandSet.firstChild||null);
    const fun = details.command;
    command.addEventListener("command",ev => fun(ev.view,ev))
    return
  }
  static ERR_KEY = 0;
  static NORMAL_KEY = 1;
  static FUN_KEY = 2;
  static VK_KEY = 4;
  
  static #getKeyCategory(key){
    return (/^[\w-]$/).test(key)
          ? Hotkey.NORMAL_KEY
          : (/^VK_[A-Z]+/).test(key)
            ? Hotkey.VK_KEY
            : (/^F(?:1[0,1,2]|[1-9])$/).test(key)
              ? Hotkey.FUN_KEY
              : Hotkey.ERR_KEY
  }
  
  static define(desc){
    let keyCategory = Hotkey.#getKeyCategory(desc.key);
    if(keyCategory === Hotkey.ERR_KEY){
      throw new Error("Provided key '"+desc.key+"' is invalid")
    }
    let commandType = typeof desc.command;
    if(!(commandType === "string" || commandType === "function")){
      throw new Error("command must be either a string or function")
    }
    if(commandType === "function" && !desc.id){
      throw new Error("command id must be specified when callback is a function")
    }
    const validMods = ["accel","alt","ctrl","meta","shift"];
    const mods = desc.modifiers?.toLowerCase().split(" ").filter(a => validMods.includes(a));
    if(keyCategory === Hotkey.NORMAL_KEY && !(mods && mods.length > 0)){
      throw new Error("Registering a hotkey with no modifiers is not supported, except for function keys F1-F12")
    }
    let keyDetails = {
      id: desc.id,
      modifiers: mods?.join(",").replace("ctrl","accel") ?? "",
      command: commandType === "string"
                ? desc.command
                : `cmd_${desc.id}`
    };
    if(desc.reserved){
      keyDetails.reserved = "true"
    }
    if(keyCategory === Hotkey.NORMAL_KEY){
      keyDetails.key = desc.key.toUpperCase();
    }else{
      keyDetails.keycode = keyCategory === Hotkey.FUN_KEY ? `VK_${desc.key}` : desc.key;
    }
    return new Hotkey(
      keyDetails,
      commandType === "function"
        ? { id: keyDetails.command, command: desc.command }
        : null
      )
  }
}

export class Pref{
  #type;
  #name;
  #observerCallbacks;
  constructor(pref,type,value){
    if(!(this instanceof Pref)){
      return Pref.fromName(pref)
    }
    this.#name = pref;
    this.#type = type;
  }
  exists(){
    return this.#type > 0;
  }
  get name(){
    return this.#name
  }
  get value(){
    try{
      return Pref.getPrefOfType(this.#name,this.#type)
    }catch(ex){
      this.#type = 0
    }
    return null
  }
  set value(some){
    this.setTo(some);
  }
  defaultTo(value){
    if(this.#type > 0){
      return false
    }
    this.setTo(value);
    return true
  }
  hasUserValue(){
    return this.#type > 0 && Services.prefs.prefHasUserValue(this.#name)
  }
  get type(){
    if(this.#type === 32)
      return "string"
    if(this.#type === 64)
      return "number"
    if(this.#type === 128)
      return "boolean"
    return "invalid"
  }
  setTo(some){
    const someType = Pref.getTypeof(some);
    if(someType > 0 && someType === this.#type || this.#type === 0){
      return Pref.setPrefOfType(this.#name,someType,some);
    }
    throw new Error("Can't set pref to a different type")
  }
  reset(){
    if(this.#type !== 0){
      Services.prefs.clearUserPref(this.#name)
    }
    this.#type = Services.prefs.getPrefType(this.#name);
  }
  orFallback(some){
    return this.#type > 0
      ? this.value
      : some
  }
  observe(_, topic, data) {
    if(topic !== "nsPref:changed"){
      console.warn("Somehow pref observer got topic:",topic);
      return
    }
    const newType = Services.prefs.getPrefType(this.#name);
    const needsTypeRefresh = this.#type > 0 && this.#type != newType;
    if(needsTypeRefresh){
      Services.prefs.removeObserver(this.#name,this);
    }
    this.#type = newType;
    for(let cb of this.#getObserverCallbacks()){
      try{
        cb(this)
      }catch(ex){
        console.error(ex)
      }
    }
    if(needsTypeRefresh){
      this.#observerCallbacks?.clear();
    }
  }
  forget(){
    Services.prefs.removeObserver(this.#name,this);
    this.#observerCallbacks?.clear();
  }
  #getObserverCallbacks(){
    if(!this.#observerCallbacks){
      this.#observerCallbacks = new Set();
    }
    return this.#observerCallbacks
  }
  addListener(callback){
    let callbacks = this.#getObserverCallbacks();
    if(callbacks.size === 0){
      Services.prefs.addObserver(this.#name,this);
    }
    callbacks.add(callback);
    return this
  }
  removeListener(callback){
    let callbacks = this.#getObserverCallbacks();
    callbacks.delete(callback);
    if(callbacks.size === 0){
      Services.prefs.removeObserver(this.#name,this)
    }
  }
  static fromName(some){
    return new Pref(some,Services.prefs.getPrefType(some))
  }
  static getPrefOfType(pref,type){
    if(type === 32)
      return Services.prefs.getStringPref(pref)
    if(type === 64)
      return Services.prefs.getIntPref(pref)
    if(type === 128)
      return Services.prefs.getBoolPref(pref);
    return null;
  }
  static getTypeof(some){
    const someType = typeof some;
    if(someType === "string")
      return 32
    if(someType === "number")
      return 64
    if(someType === "boolean")
      return 128
    return 0
  }
  static setPrefOfType(pref,type,value){
    if(type === 32)
      return Services.prefs.setCharPref(pref,value);
    if(type === 64)
      return Services.prefs.setIntPref(pref,value);
    if(type === 128)
      return Services.prefs.setBoolPref(pref,value);
    throw new Error(`Unknown pref type: {type}`);
  }
  static setIfUnset(pref,value){
    if(Services.prefs.getPrefType(pref) === 0){
      Pref.setPrefOfType(pref,Pref.getTypeof(value),value);
      return true
    }
    return false
  }
  static get(prefPath){
    return Pref.fromName(prefPath)
  }
  static set(prefName, value){
    Pref.fromName(prefName).setTo(value)
  }
  static addListener(a,b){
    let o = (q,w,e) => b(Pref.fromName(e),e);
    Services.prefs.addObserver(a,o);
    return {pref:a, observer:o}
  }
  static removeListener(a){
    Services.prefs.removeObserver(a.pref,a.observer)
  }
}

// This stores data we need to link from the loader module
export const loaderModuleLink = new (function(){
  let sessionRestored = false;
  let variant = {
    THUNDERBIRD: Services.appinfo.name === "Thunderbird",
    FIREFOX: Services.appinfo.name !== "Thunderbird"
  };
  let brandName = Services.appinfo.name;

  Object.defineProperty(this,"variant",{ get: () => {
    if (variant === null) {
      let is_tb = Services.appinfo.name === "Thunderbird";
      variant = {
        THUNDERBIRD: is_tb,
        FIREFOX: !is_tb
      }
    }
    return variant;
  }});
  Object.defineProperty(this,"brandName",{ get: () => {
    if (brandName === null) {
      brandName = Services.appinfo.name;
    }
    return brandName;
  }});
  this.setSessionRestored = () => { sessionRestored = true };
  this.sessionRestored = () => sessionRestored;
  return this
})();

// getScriptData() returns these types of objects
export class ScriptInfo{
  constructor(enabled){
    this.isEnabled = enabled
  }
  asFile(){
    return FileSystem.getEntry(FileSystem.convertChromeURIToFileURI(this.chromeURI)).entry()
  }
  static fromScript(aScript, isEnabled){
    let info = new ScriptInfo(isEnabled);
    Object.assign(info,aScript);
    info.regex = aScript.regex ? new RegExp(aScript.regex.source, aScript.regex.flags) : null;
    info.chromeURI = aScript.chromeURI.spec;
    info.referenceURI = aScript.referenceURI.spec;
    info.isRunning = aScript.isRunning;
    info.injectionFailed = aScript.injectionFailed;
    return info
  }
}

export class windowUtils{
  constructor(){
    if(new.target){
      throw new TypeError("windowUtils is not a constructor")
    }
  }
  static onCreated(fun){
    if(!lazy.windowOpenedCallbacks){
      Services.obs.addObserver(windowUtils.#observe, 'domwindowopened', false);
      lazy.windowOpenedCallbacks = new Set();
    }
    lazy.windowOpenedCallbacks.add(fun)
  }
  static #observe(aSubject) {
    aSubject.addEventListener(
      'DOMContentLoaded',
      windowUtils.#onDOMContent,
      {once:true});
  }
  static getCreatedCallbacks(){
    return lazy.windowOpenedCallbacks
  }
  static #onDOMContent(ev){
    const window = ev.originalTarget.defaultView;
    for(let f of lazy.windowOpenedCallbacks){
      try{
        f(window)
      }catch(e){
        console.error(e)
      }
    }
  }
  static getLastFocused(windowType){
    return Services.wm.getMostRecentWindow(windowType === undefined ? windowUtils.mainWindowType : windowType)
  }
  static getAll(onlyBrowsers = true){
    let windows = Services.wm.getEnumerator(onlyBrowsers ? windowUtils.mainWindowType : null);
    let wins = [];
    while (windows.hasMoreElements()) {
      wins.push(windows.getNext());
    }
    return wins
  }
  static forEach(fun, onlyBrowsers = true){
    let wins = windowUtils.getAll(onlyBrowsers);
    wins.forEach((w) => fun(w.document,w))
  }
  static isBrowserWindow(window){
    return window.document.documentElement.getAttribute("windowtype") === windowUtils.mainWindowType
  }
  static mainWindowType = loaderModuleLink.variant.FIREFOX ? "navigator:browser" : "mail:3pane";
  
  static waitWindowLoading(win){
    if(win && win.isChromeWindow){
      if(loaderModuleLink.variant.FIREFOX){
        if(win.gBrowserInit.delayedStartupFinished){
          return Promise.resolve(win);
        }
      }else{ // APP_VARIANT = THUNDERBIRD
        if(win.gMailInit.delayedStartupFinished){
          return Promise.resolve(win);
        }
      }
      return new Promise(resolve => {
        let observer = (subject) => {
          if(subject === win){
            Services.obs.removeObserver(observer, "browser-delayed-startup-finished");
            resolve(win)
          }
        };
        Services.obs.addObserver(observer, "browser-delayed-startup-finished");
      });
    }
    return Promise.reject(new Error("reference is not a window"))
  }
}

export function createElement(doc,tag,props,isHTML = false){
  let el = isHTML ? doc.createElement(tag) : doc.createXULElement(tag);
  for(let prop in props){
    el.setAttribute(prop,props[prop])
  }
  return el
}

export function createWidget(desc){
  if(!desc || !desc.id ){
    throw new Error("custom widget description is missing 'id' property");
  }
  if(!(desc.type === "toolbarbutton" || desc.type === "toolbaritem")){
    throw new Error(`custom widget has unsupported type: '${desc.type}'`);
  }
  const CUI = lazy.CustomizableUI;
  
  if(CUI.getWidget(desc.id)?.hasOwnProperty("source")){
    // very likely means that the widget with this id already exists
    // There isn't a very reliable way to 'really' check if it exists or not
    throw new Error(`Widget with ID: '${desc.id}' already exists`);
  }
  // This is pretty ugly but makes onBuild much cleaner.
  let itemStyle = "";
  if(desc.image){
    if(desc.type==="toolbarbutton"){
      itemStyle += "list-style-image:";
    }else{
      itemStyle += "background: transparent center no-repeat ";
    }
    itemStyle += /^chrome:\/\/|resource:\/\//.test(desc.image)
      ? `url(${desc.image});`
      : `url(chrome://userChrome/content/${desc.image});`;
    itemStyle += desc.style || "";
  }
  const callback = desc.callback;
  if(typeof callback === "function"){
    SharedGlobal.widgetCallbacks.set(desc.id,callback);
  }
  return CUI.createWidget({
    id: desc.id,
    type: 'custom',
    defaultArea: desc.area || CUI.AREA_NAVBAR,
    onBuild: function(aDocument) {
      let toolbaritem = aDocument.createXULElement(desc.type);
      let props = {
        id: desc.id,
        class: `toolbarbutton-1 chromeclass-toolbar-additional ${desc.class?desc.class:""}`,
        overflows: !!desc.overflows,
        label: desc.label || desc.id,
        tooltiptext: desc.tooltip || desc.id,
        style: itemStyle
      };
      for (let p in props){
        toolbaritem.setAttribute(p, props[p]);
      }
      
      if(typeof callback === "function"){
        const allEvents = !!desc.allEvents;
        toolbaritem.addEventListener("click",(ev) => {
          allEvents || ev.button === 0 && SharedGlobal.widgetCallbacks.get(ev.target.id)(ev,ev.target.ownerGlobal)
        })
      }
      for (let attr in desc){
        if(attr != "callback" && !(attr in props)){
          toolbaritem.setAttribute(attr,desc[attr])
        }
      }
      return toolbaritem;
    }
  });
}

export function escapeXUL(markup) {
  return markup.replace(/[<>&'"]/g, (char) => {
    switch (char) {
      case `<`:
        return "&lt;";
      case `>`:
        return "&gt;";
      case `&`:
        return "&amp;";
      case `'`:
        return "&apos;";
      case '"':
        return "&quot;";
    }
  });
}

export function loadURI(win,desc){
  if(loaderModuleLink.variant.THUNDERBIRD){
    console.warn("loadURI() is not supported on Thunderbird");
    return false
  }
  if(    !win
      || !desc 
      || !desc.url 
      || typeof desc.url !== "string"
      || !(["tab","tabshifted","window","current"]).includes(desc.where)
    ){
    return false
  }
  const isJsURI = desc.url.slice(0,11) === "javascript:";
  try{
    win.openTrustedLinkIn(
      desc.url,
      desc.where,
      { "allowPopups":isJsURI,
        "inBackground":false,
        "allowInheritPrincipal":false,
        "private":!!desc.private,
        "userContextId":desc.url.startsWith("http")?desc.userContextId:null});
  }catch(e){
    console.error(e);
    return false
  }
  return true
}

export function restartApplication(clearCache){
  clearCache && Services.appinfo.invalidateCachesOnRestart();
  let cancelQuit = Cc["@mozilla.org/supports-PRBool;1"].createInstance(Ci.nsISupportsPRBool);
  Services.obs.notifyObservers(
    cancelQuit,
    "quit-application-requested",
    "restart"
  );
  if (!cancelQuit.data) {
    Services.startup.quit(
      Services.startup.eAttemptQuit | Services.startup.eRestart
    );
    return true
  }
  return false
}

export async function showNotification(description){
  if(loaderModuleLink.variant.THUNDERBIRD){
    console.warn('showNotification() is not supported on Thunderbird\nNotification label was: "'+description.label+'"');
    return
  }
  await startupFinished();
  let window = description.window;
  if(!(window && window.isChromeWindow)){
    window = Services.wm.getMostRecentBrowserWindow();
  }
  let aNotificationBox = window.gNotificationBox;
  if(description.tab){
    let aBrowser = description.tab.linkedBrowser;
    if(!aBrowser){ return }
    aNotificationBox = window.gBrowser.getNotificationBox(aBrowser);
  }
  if(!aNotificationBox){ return }
  let type = description.type || "default";
  let priority = aNotificationBox.PRIORITY_INFO_HIGH;
  switch (description.priority){
    case "system":
      priority = aNotificationBox.PRIORITY_SYSTEM;
      break;
    case "critical":
      priority = aNotificationBox.PRIORITY_CRITICAL_HIGH;
      break;
    case "warning":
      priority = aNotificationBox.PRIORITY_WARNING_HIGH;
      break;
  }
  aNotificationBox.appendNotification(
    type,
    {
      label: description.label || "fx-autoconfig message",
      image: "chrome://browser/skin/notification-icons/popup.svg",
      priority: priority,
      eventCallback: typeof description.callback === "function" ? description.callback : null
    },
    description.buttons
  );
}

export function startupFinished(){
  if(loaderModuleLink.sessionRestored() || lazy.startupPromises === null){
    return Promise.resolve();
  }
  if(lazy.startupPromises.size === 0){
    const obs_topic = loaderModuleLink.variant.FIREFOX
        ? "sessionstore-windows-restored"
        : "browser-delayed-startup-finished";
    const startupObserver = () => {
      Services.obs.removeObserver(startupObserver, obs_topic);
      loaderModuleLink.setSessionRestored();
      for(let f of lazy.startupPromises){ f() }
      lazy.startupPromises.clear();
      lazy.startupPromises = null;
    }
    Services.obs.addObserver(startupObserver, obs_topic);
  }
  return new Promise(resolve => lazy.startupPromises.add(resolve))
}
