/*
 * Wails v3 implementation of the window.settings / window.utils bridge
 * facades. Signatures match the legacy Electron bridges in
 * src/bridges/settings.ts and src/bridges/utils.ts so that no component or
 * Redux model code needs to change.
 *
 * Synchronous getters are served from a boot snapshot fetched with a
 * blocking XHR before any app module runs (see index.tsx import order);
 * setters call the Go backend over same-origin HTTP and update the snapshot.
 */
import { Events } from "@wailsio/runtime"
import {
    SourceGroup,
    ViewType,
    ThemeSettings,
    SearchEngines,
    ServiceConfigs,
    ViewConfigs,
    WindowStateListenerType,
} from "../../schema-types"

interface BootData {
    settings: { [key: string]: any }
    platform: string
    version: string
    fontList: string[]
    systemDark: boolean
    resolvedLocale: string
}

function loadBoot(): BootData {
    try {
        const xhr = new XMLHttpRequest()
        xhr.open("GET", "/api/desktop/boot", false)
        xhr.send(null)
        if (xhr.status === 200) return JSON.parse(xhr.responseText)
    } catch {}
    // Fallback for plain-browser builds (webpack devserver etc.)
    return {
        settings: {},
        platform: "web",
        version: "0.0.0",
        fontList: [],
        systemDark: window.matchMedia("(prefers-color-scheme: dark)").matches,
        resolvedLocale: navigator.language,
    }
}

const boot = loadBoot()

function snap(key: string, fallback: any) {
    const v = boot.settings[key]
    return v === undefined ? fallback : v
}

function setSnap(key: string, value: any) {
    boot.settings[key] = value
}

async function api(path: string, body?: any): Promise<any> {
    const resp = await fetch("/api/desktop/" + path, {
        method: body === undefined ? "GET" : "POST",
        headers:
            body === undefined
                ? undefined
                : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (resp.status === 204) return null
    const text = await resp.text()
    try {
        return text ? JSON.parse(text) : null
    } catch (e) {
        fetch("/api/desktop/log", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                message:
                    "api " +
                    path +
                    " status=" +
                    resp.status +
                    " body=" +
                    text.slice(0, 120),
            }),
        })
        throw e
    }
}

// Blocking variant for legacy synchronous getters.
function apiSync(path: string): any {
    try {
        const xhr = new XMLHttpRequest()
        xhr.open("GET", "/api/desktop/" + path, false)
        xhr.send(null)
        if (xhr.status === 200) return JSON.parse(xhr.responseText)
    } catch {}
    return null
}

function onEvent(name: string, cb: (data: any) => void) {
    Events.On(name, (ev: any) => {
        const d = Array.isArray(ev.data) ? ev.data[0] : ev.data
        cb(d)
    })
}
const settingsBridge = {
    saveGroups: (groups: SourceGroup[]) => {
        setSnap("sourceGroups", groups)
        api("settings/set", { key: "sourceGroups", value: groups })
    },
    loadGroups: (): SourceGroup[] => {
        return snap("sourceGroups", [])
    },

    getDefaultMenu: (): boolean => {
        return snap("menuOn", false)
    },
    setDefaultMenu: (state: boolean) => {
        setSnap("menuOn", state)
        api("settings/set", { key: "menuOn", value: state })
    },

    getProxyStatus: (): boolean => {
        return snap("pacOn", false)
    },
    toggleProxyStatus: () => {
        const next = !snap("pacOn", false)
        setSnap("pacOn", next)
        api("settings/set", { key: "pacOn", value: next }).then(() =>
            api("proxy", { address: null })
        )
    },
    getProxy: (): string => {
        return snap("pac", "")
    },
    setProxy: (address: string = null) => {
        if (address !== null) setSnap("pac", address)
        api("proxy", { address: address })
    },

    getDefaultView: (): ViewType => {
        return snap("view", ViewType.Cards)
    },
    setDefaultView: (viewType: ViewType) => {
        setSnap("view", viewType)
        api("settings/set", { key: "view", value: viewType })
    },

    getThemeSettings: (): ThemeSettings => {
        return snap("theme", ThemeSettings.Default)
    },
    setThemeSettings: (theme: ThemeSettings) => {
        setSnap("theme", theme)
        api("settings/set", { key: "theme", value: theme })
    },
    shouldUseDarkColors: (): boolean => {
        switch (snap("theme", ThemeSettings.Default)) {
            case ThemeSettings.Dark:
                return true
            case ThemeSettings.Light:
                return false
            default:
                return dark
        }
    },
    addThemeUpdateListener: (callback: (shouldDark: boolean) => any) => {
        onEvent("theme-updated", (d: any) => {
            if (typeof d === "boolean") dark = d
            callback(d)
        })
    },

    setLocaleSettings: (option: string) => {
        setSnap("locale", option)
        api("settings/set", { key: "locale", value: option })
    },
    getLocaleSettings: (): string => {
        return snap("locale", "default")
    },
    getCurrentLocale: (): string => {
        const setting = snap("locale", "default")
        return setting === "default" ? boot.resolvedLocale : setting
    },

    getFontSize: (): number => {
        return snap("fontSize", 16)
    },
    setFontSize: (size: number) => {
        setSnap("fontSize", size)
        api("settings/set", { key: "fontSize", value: size })
    },

    getFont: (): string => {
        return snap("fontFamily", "")
    },
    setFont: (font: string) => {
        setSnap("fontFamily", font)
        api("settings/set", { key: "fontFamily", value: font })
    },

    getFetchInterval: (): number => {
        return snap("fetchInterval", 0)
    },
    setFetchInterval: (interval: number) => {
        setSnap("fetchInterval", interval)
        api("settings/set", { key: "fetchInterval", value: interval })
    },

    getSearchEngine: (): SearchEngines => {
        return snap("searchEngine", SearchEngines.Google)
    },
    setSearchEngine: (engine: SearchEngines) => {
        setSnap("searchEngine", engine)
        api("settings/set", { key: "searchEngine", value: engine })
    },

    getServiceConfigs: (): ServiceConfigs => {
        return snap("serviceConfigs", { type: 0 })
    },
    setServiceConfigs: (configs: ServiceConfigs) => {
        setSnap("serviceConfigs", configs)
        api("settings/set", { key: "serviceConfigs", value: configs })
    },

    getFilterType: (): number => {
        return snap("filterType", null)
    },
    setFilterType: (filterType: number) => {
        setSnap("filterType", filterType)
        api("settings/set", { key: "filterType", value: filterType })
    },

    getViewConfigs: (view: ViewType): ViewConfigs => {
        return snap(viewConfigsKey(view), 0)
    },
    setViewConfigs: (view: ViewType, configs: ViewConfigs) => {
        setSnap(viewConfigsKey(view), configs)
        api("settings/set", { key: viewConfigsKey(view), value: configs })
    },

    getUnreadSourcesOnly: (): boolean => {
        return snap("menuUnreadSourcesOnly", false)
    },
    setUnreadSourcesOnly: (flag: boolean) => {
        setSnap("menuUnreadSourcesOnly", flag)
        api("settings/set", { key: "menuUnreadSourcesOnly", value: flag })
    },

    getScrollMarkReadOn: (): boolean => {
        return snap("scrollMarkReadOn", false)
    },
    setScrollMarkReadOn: (flag: boolean) => {
        setSnap("scrollMarkReadOn", flag)
        api("settings/set", { key: "scrollMarkReadOn", value: flag })
    },

    getAll: () => {
        return { ...boot.settings }
    },

    setAll: (configs: Object) => {
        api("settings/import", configs)
    },
}

function viewConfigsKey(view: ViewType): string {
    switch (view) {
        case ViewType.Cards:
            return "cardsViewConfigs"
        case ViewType.Magazine:
            return "magazineViewConfigs"
        case ViewType.Compact:
            return "compactViewConfigs"
        default:
            return "listViewConfigs"
    }
}

// Latest known system dark state, updated by theme-updated events.
let dark = boot.systemDark

interface WebviewInput {
    type?: string
    key: string
    code: string
    alt: boolean
    control: boolean
    shift: boolean
    meta: boolean
    isAutoRepeat: boolean
}

let webviewKeydownHandler: ((input: WebviewInput) => any) | null = null

const utilsBridge = {
    platform: boot.platform,

    getVersion: (): string => {
        return boot.version
    },

    // Forward an HTTP request through the Go backend (avoids webview CORS
    // restrictions and honours the configured proxy).
    request: async (opts: {
        method: string
        url: string
        headers: { [key: string]: string }
        body: string | null
    }): Promise<{
        status: number
        body: string
        headers: { [key: string]: string }
        error?: string
    }> => {
        return api("http", opts)
    },

    openExternal: (url: string, background = false) => {
        api("external", { url: url, background: background })
    },

    showErrorBox: (title: string, content: string, copy?: string) => {
        api("message/error", { title: title, content: content, copy: copy })
    },

    showMessageBox: async (
        title: string,
        message: string,
        confirm: string,
        cancel: string,
        defaultCancel = false,
        type = "none"
    ) => {
        const resp = (await api("message/box", {
            title: title,
            message: message,
            confirm: confirm,
            cancel: cancel,
            defaultCancel: defaultCancel,
            type: type,
        })) as { confirmed: boolean }
        return resp.confirmed
    },

    showSaveDialog: async (filters: any[], path: string) => {
        const resp = (await api("dialog/save", {
            defaultPath: path,
            filters: filters,
        })) as { canceled: boolean; path: string }
        if (resp.canceled || !resp.path) {
            return null
        } else {
            return (result: string, errmsg: string) => {
                api("dialog/write", {
                    path: resp.path,
                    content: result,
                    errmsg: errmsg,
                })
            }
        }
    },

    showOpenDialog: async (filters: any[]) => {
        const resp = (await api("dialog/open", {
            filters: filters,
        })) as { content: string | null }
        return resp.content
    },

    getCacheSize: async (): Promise<number> => {
        const resp = (await api("cache")) as { size: number }
        return resp.size
    },

    clearCache: async () => {
        await api("cache/clear")
    },

    addMainContextListener: (
        callback: (pos: [number, number], text: string) => any
    ) => {
        // WebKitGTK provides a native context menu; no custom text menu.
        void callback
    },
    addWebviewContextListener: (
        callback: (pos: [number, number], text: string, url: string) => any
    ) => {
        // Article body is rendered in a sandboxed iframe; custom context
        // menus are not forwarded.
        void callback
    },
    imageCallback: (type: number) => {
        void type
    },

    addWebviewKeydownListener: (callback: (event: WebviewInput) => any) => {
        webviewKeydownHandler = callback
        window.addEventListener("message", ev => {
            if (
                ev.data &&
                typeof ev.data === "object" &&
                ev.data.type === "frss-webview-keydown" &&
                webviewKeydownHandler
            ) {
                webviewKeydownHandler(ev.data.input)
            }
        })
    },

    addWebviewErrorListener: (callback: (reason: string) => any) => {
        void callback
    },

    writeClipboard: (text: string) => {
        api("clipboard", { text: text })
    },

    closeWindow: () => {
        api("window/close")
    },
    minimizeWindow: () => {
        api("window/minimize")
    },
    maximizeWindow: () => {
        api("window/zoom")
    },
    isMaximized: () => {
        return !!(apiSync("window/state") || {}).maximized
    },
    isFullscreen: () => {
        return !!(apiSync("window/state") || {}).fullscreen
    },
    isFocused: () => {
        const state = apiSync("window/state")
        return state ? state.focused !== false : true
    },
    focus: () => {
        api("window/focus")
    },
    requestAttention: () => {
        api("window/attention")
    },
    addWindowStateListener: (
        callback: (type: WindowStateListenerType, state: boolean) => any
    ) => {
        onEvent("maximized", () =>
            callback(WindowStateListenerType.Maximized, true)
        )
        onEvent("unmaximized", () =>
            callback(WindowStateListenerType.Maximized, false)
        )
        onEvent("enter-fullscreen", () =>
            callback(WindowStateListenerType.Fullscreen, true)
        )
        onEvent("leave-fullscreen", () =>
            callback(WindowStateListenerType.Fullscreen, false)
        )
        onEvent("window-focus", () =>
            callback(WindowStateListenerType.Focused, true)
        )
        onEvent("window-blur", () =>
            callback(WindowStateListenerType.Focused, false)
        )
    },

    addTouchBarEventsListener: (callback: (e: any) => any) => {
        void callback
    },
    initTouchBar: (texts: any) => {
        void texts
    },
    destroyTouchBar: () => {},

    initFontList: (): Promise<Array<string>> => {
        return Promise.resolve(boot.fontList)
    },
}

declare global {
    interface Window {
        settings: typeof settingsBridge
        utils: typeof utilsBridge
        fontList: Array<string>
    }
    var settings: typeof settingsBridge
    var utils: typeof utilsBridge
    var fontList: Array<string>
}

window.settings = settingsBridge
window.utils = utilsBridge

export {}
