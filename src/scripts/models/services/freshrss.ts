import intl from "react-intl-universal"
import * as db from "../../db"
import lf from "lovefield"
import { ServiceHooks } from "../service"
import { ServiceConfigs, SyncService } from "../../../schema-types"
import { createSourceGroup } from "../group"
import { RSSSource, updateUnreadCounts } from "../source"
import { RSSItem, insertItems, fetchItemsSuccess } from "../item"
import { domParser } from "../../utils"

const ALL_TAG = "user/-/state/com.google/reading-list"
const READ_TAG = "user/-/state/com.google/read"
const STAR_TAG = "user/-/state/com.google/starred"

export interface FreshRSSConfigs extends ServiceConfigs {
    type: SyncService.FreshRSS
    endpoint: string
    username: string
    password: string
    fetchLimit: number
    lastFetched?: number
    lastId?: string
    auth?: string
}

// Minimal Response surface used by the call sites below. Requests are
// forwarded through the Go backend because the webview enforces CORS, which
// Electron never did.
interface ForwardedResponse {
    status: number
    json: () => Promise<any>
    text: () => Promise<string>
}

async function fetchAPI(
    configs: FreshRSSConfigs,
    params: string,
    method = "GET",
    body: URLSearchParams | string = null
): Promise<ForwardedResponse> {
    const headers: { [key: string]: string } = {}
    if (configs.auth !== null) headers["Authorization"] = configs.auth
    let bodyStr: string = null
    if (body !== null) {
        bodyStr = typeof body === "string" ? body : body.toString()
        headers["Content-Type"] =
            "application/x-www-form-urlencoded;charset=UTF-8"
    }
    const resp = await window.utils.request({
        method: method,
        url: configs.endpoint + params,
        headers: headers,
        body: bodyStr,
    })
    if (resp.error) throw new Error(resp.error)
    return {
        status: resp.status,
        json: () => Promise.resolve(JSON.parse(resp.body)),
        text: () => Promise.resolve(resp.body),
    }
}

async function fetchAll(
    configs: FreshRSSConfigs,
    params: string
): Promise<Set<string>> {
    let results = new Array()
    let fetched: any[]
    let continuation: string
    do {
        let p = params
        if (continuation) p += `&c=${continuation}`
        const response = await fetchAPI(configs, p)
        if (response.status !== 200) {
            throw new Error(`HTTP ${response.status}`)
        }
        const parsed = await response.json()
        fetched = parsed.itemRefs
        if (fetched) {
            for (let i of fetched) {
                results.push(decToHexId(i.id))
            }
        }
        continuation = parsed.continuation
    } while (continuation && fetched && fetched.length >= 1000)
    return new Set(results)
}

async function fetchUnreadCounts(
    configs: FreshRSSConfigs
): Promise<Map<string, number>> {
    const response = await fetchAPI(
        configs,
        "/reader/api/0/unread-count?output=json"
    )
    const counts = new Map<string, number>()
    if (response.status !== 200) return counts
    const data = await response.json()
    for (let c of data.unreadcounts ?? []) {
        if (typeof c.id === "string" && c.id.startsWith("feed/")) {
            counts.set(c.id, c.count)
        }
    }
    return counts
}

async function localUnreadCount(): Promise<number> {
    const rows = await db.itemsDB
        .select(lf.fn.count(db.items._id))
        .from(db.items)
        .where(db.items.hasRead.eq(false))
        .exec()
    return rows.length > 0 ? rows[0]["COUNT(_id)"] : 0
}

async function localUnreadCountBySource(): Promise<Map<number, number>> {
    const rows = await db.itemsDB
        .select(db.items.source, lf.fn.count(db.items._id))
        .from(db.items)
        .where(db.items.hasRead.eq(false))
        .groupBy(db.items.source)
        .exec()
    const counts = new Map<number, number>()
    for (let row of rows) {
        counts.set(row["source"], row["COUNT(_id)"])
    }
    return counts
}

async function serviceRefsBySource(): Promise<Map<number, Set<string>>> {
    const rows = await db.itemsDB
        .select(db.items.source, db.items.serviceRef)
        .from(db.items)
        .where(db.items.serviceRef.isNotNull())
        .exec()
    const refs = new Map<number, Set<string>>()
    for (let row of rows) {
        if (!refs.has(row["source"])) refs.set(row["source"], new Set())
        refs.get(row["source"]).add(row["serviceRef"])
    }
    return refs
}

async function editTag(
    configs: FreshRSSConfigs,
    ref: string,
    tag: string,
    add = true
) {
    const body = new URLSearchParams(`i=${ref}&${add ? "a" : "r"}=${tag}`)
    return await fetchAPI(configs, "/reader/api/0/edit-tag", "POST", body)
}

function compactId(longId: string) {
    let parts = longId.split("/")
    return parts[parts.length - 1]
}

// FreshRSS returns decimal IDs from stream/items/ids but hex IDs
// (16-digit zero-padded) from stream/contents; normalize to hex
function decToHexId(id: string): string {
    return /^\d+$/.test(id) ? BigInt(id).toString(16).padStart(16, "0") : id
}

const APIError = () => new Error(intl.get("service.failure"))

function parseStreamItems(
    items: any[],
    fidMap: Map<string, RSSSource>
): RSSItem[] {
    const parsedItems = new Array<RSSItem>()
    items.map(i => {
        const source = fidMap.get(i.origin.streamId)
        if (source === undefined) return
        const summary = i.summary?.content ?? i.content?.content ?? ""
        const dom = domParser.parseFromString(summary, "text/html")
        const item = {
            source: source.sid,
            title: i.title,
            link: i.canonical[0].href,
            date: new Date(i.published * 1000),
            fetchedDate: new Date(parseInt(i.crawlTimeMsec)),
            content: dom.body.innerHTML,
            snippet: dom.documentElement.textContent.trim(),
            creator: i.author,
            hasRead: false,
            starred: false,
            hidden: false,
            notify: false,
            serviceRef: i.id,
        } as RSSItem
        const baseEl = dom.createElement("base")
        baseEl.setAttribute("href", item.link.split("/").slice(0, 3).join("/"))
        dom.head.append(baseEl)
        let img = dom.querySelector("img")
        if (img && img.src) item.thumb = img.src
        for (let c of i.categories) {
            if (!item.hasRead && c.endsWith("/state/com.google/read"))
                item.hasRead = true
            else if (!item.starred && c.endsWith("/state/com.google/starred"))
                item.starred = true
        }
        parsedItems.push(item)
    })
    return parsedItems
}

export const freshRSSServiceHooks: ServiceHooks = {
    authenticate: async (configs: FreshRSSConfigs) => {
        if (configs.auth !== null) {
            try {
                const result = await fetchAPI(
                    configs,
                    "/reader/api/0/user-info"
                )
                return result.status === 200
            } catch {
                return false
            }
        }
    },

    reauthenticate: async (
        configs: FreshRSSConfigs
    ): Promise<FreshRSSConfigs> => {
        const body = new URLSearchParams()
        body.append("Email", configs.username)
        body.append("Passwd", configs.password)
        const result = await fetchAPI(
            configs,
            "/accounts/ClientLogin",
            "POST",
            body
        )
        if (result.status === 200) {
            const text = await result.text()
            const matches = text.match(/Auth=(\S+)/)
            if (matches.length > 1)
                configs.auth = "GoogleLogin auth=" + matches[1]
            return configs
        } else {
            throw APIError()
        }
    },

    updateSources: () => async (dispatch, getState) => {
        const configs = getState().service as FreshRSSConfigs
        const response = await fetchAPI(
            configs,
            "/reader/api/0/subscription/list?output=json"
        )
        if (response.status !== 200) throw APIError()
        const subscriptions: any[] = (await response.json()).subscriptions
        let groupsMap: Map<string, string>
        if (configs.importGroups) {
            groupsMap = new Map()
            const groupSet = new Set<string>()
            for (let s of subscriptions) {
                if (s.categories && s.categories.length > 0) {
                    const group: string = s.categories[0].label
                    if (!groupSet.has(group)) {
                        groupSet.add(group)
                        dispatch(createSourceGroup(group))
                    }
                    groupsMap.set(s.id, group)
                }
            }
        }
        const sources = new Array<RSSSource>()
        subscriptions.forEach(s => {
            const source = new RSSSource(s.url || s.htmlUrl, s.title)
            source.serviceRef = s.id
            sources.push(source)
        })
        return [sources, groupsMap]
    },

    syncItems: () => async (_, getState) => {
        const configs = getState().service as FreshRSSConfigs
        return await Promise.all([
            fetchAll(
                configs,
                `/reader/api/0/stream/items/ids?output=json&s=${ALL_TAG}&xt=${READ_TAG}&n=1000`
            ),
            fetchAll(
                configs,
                `/reader/api/0/stream/items/ids?output=json&s=${STAR_TAG}&n=1000`
            ),
        ])
    },

    fetchItems: () => async (_, getState) => {
        const state = getState()
        const configs = state.service as FreshRSSConfigs
        const fetchLimit = Math.max(1, configs.fetchLimit || 250)
        const items = new Array()
        let fetchedItems: any[]
        let continuation: string
        let hitLastId = false
        do {
            try {
                const limit = Math.min(fetchLimit - items.length, 1000)
                // FreshRSS requires the streamId in the URL path
                let params = `/reader/api/0/stream/contents/${ALL_TAG}?output=json&n=${limit}`
                if (configs.lastFetched) params += `&ot=${configs.lastFetched}`
                if (continuation) params += `&c=${continuation}`
                const response = await fetchAPI(configs, params)
                if (response.status !== 200) {
                    throw new Error(`HTTP ${response.status}`)
                }
                let fetched = await response.json()
                fetchedItems = fetched.items ?? []
                for (let i of fetchedItems) {
                    i.id = compactId(i.id)
                    if (i.id === configs.lastId || items.length >= fetchLimit) {
                        hitLastId = true
                        break
                    } else {
                        items.push(i)
                    }
                }
                continuation = fetched.continuation
            } catch (err) {
                console.warn("[FreshRSS] fetchItems failed:", err)
                break
            }
        } while (continuation && items.length < fetchLimit && !hitLastId)
        if (items.length > 0) {
            configs.lastId = items[0].id
        }
        const fidMap = new Map<string, RSSSource>()
        for (let source of Object.values(state.sources)) {
            if (source.serviceRef) {
                fidMap.set(source.serviceRef, source)
            }
        }
        let parsedItems = parseStreamItems(items, fidMap)
        if (parsedItems.length > 0) {
            configs.lastFetched = Math.round(
                parsedItems[0].fetchedDate.getTime() / 1000
            )
        }
        // Backfill unread items that fall outside of the latest-articles
        // fetch window, otherwise they never appear in unread-only views
        try {
            const localUnread = await localUnreadCount()
            const serverUnreadCounts = await fetchUnreadCounts(configs)
            const serverUnread = [...serverUnreadCounts.values()].reduce(
                (a, b) => a + b,
                0
            )
            if (serverUnread > localUnread) {
                const existingRefs = new Set(
                    (
                        await db.itemsDB
                            .select(db.items.serviceRef)
                            .from(db.items)
                            .where(db.items.serviceRef.isNotNull())
                            .exec()
                    ).map(row => row["serviceRef"])
                )
                for (let item of parsedItems) {
                    existingRefs.add(item.serviceRef)
                }
                const limit = Math.min(fetchLimit, serverUnread - localUnread)
                const backfill = new Array()
                let backfillContinuation: string
                do {
                    try {
                        // FreshRSS requires the streamId in the URL path
                        let params = `/reader/api/0/stream/contents/${ALL_TAG}?output=json&xt=${READ_TAG}&n=${Math.min(
                            limit - backfill.length,
                            1000
                        )}`
                        if (backfillContinuation) {
                            params += `&c=${backfillContinuation}`
                        }
                        const response = await fetchAPI(configs, params)
                        if (response.status !== 200) {
                            throw new Error(`HTTP ${response.status}`)
                        }
                        const fetched = await response.json()
                        const backfillItems: any[] = fetched.items ?? []
                        for (let i of backfillItems) {
                            const ref = compactId(i.id)
                            if (
                                existingRefs.has(ref) ||
                                backfill.length >= limit
                            ) {
                                continue
                            }
                            existingRefs.add(ref)
                            i.id = ref
                            backfill.push(i)
                        }
                        backfillContinuation = fetched.continuation
                    } catch (err) {
                        console.warn("[FreshRSS] backfill failed:", err)
                        break
                    }
                } while (backfillContinuation && backfill.length < limit)
                parsedItems = parsedItems.concat(
                    parseStreamItems(backfill, fidMap)
                )
            }
        } catch {
            // Backfill is best-effort; keep the regular fetch result
        }
        return [parsedItems, configs]
    },

    fetchFeedUnread: (sids: number[]) => async (dispatch, getState) => {
        const state = getState()
        const configs = state.service as FreshRSSConfigs
        const [localUnread, serverUnread, existingRefs] = await Promise.all([
            localUnreadCountBySource(),
            fetchUnreadCounts(configs),
            serviceRefsBySource(),
        ])
        const fidMap = new Map<string, RSSSource>()
        for (let source of Object.values(state.sources)) {
            if (source.serviceRef) {
                fidMap.set(source.serviceRef, source)
            }
        }
        const parsed = new Array<RSSItem>()
        for (let sid of sids) {
            const source = state.sources[sid]
            if (!source || !source.serviceRef) continue
            const deficit =
                (serverUnread.get(source.serviceRef) ?? 0) -
                (localUnread.get(sid) ?? 0)
            if (deficit <= 0) continue
            const refs = existingRefs.get(sid) ?? new Set<string>()
            const limit = Math.min(configs.fetchLimit || 250, deficit)
            const items = new Array()
            let continuation: string
            do {
                try {
                    // FreshRSS requires the streamId in the URL path
                    let params = `/reader/api/0/stream/contents/${
                        source.serviceRef
                    }?output=json&xt=${READ_TAG}&n=${Math.min(
                        limit - items.length,
                        1000
                    )}`
                    if (continuation) params += `&c=${continuation}`
                    const response = await fetchAPI(configs, params)
                    if (response.status !== 200) {
                        throw new Error(`HTTP ${response.status}`)
                    }
                    const fetched = await response.json()
                    const fetchedItems: any[] = fetched.items ?? []
                    for (let i of fetchedItems) {
                        const ref = compactId(i.id)
                        if (refs.has(ref) || items.length >= limit) continue
                        refs.add(ref)
                        i.id = ref
                        items.push(i)
                    }
                    continuation = fetched.continuation
                } catch (err) {
                    console.warn("[FreshRSS] fetchFeedUnread failed:", err)
                    break
                }
            } while (continuation && items.length < limit)
            parsed.push(...parseStreamItems(items, fidMap))
        }
        if (parsed.length > 0) {
            // Re-check against the DB to avoid duplicate inserts from races
            const refRows = await db.itemsDB
                .select(db.items.serviceRef)
                .from(db.items)
                .where(
                    lf.op.and(
                        db.items.source.in(sids),
                        db.items.serviceRef.isNotNull()
                    )
                )
                .exec()
            const known = new Set(refRows.map(row => row["serviceRef"]))
            const toInsert = parsed.filter(i => !known.has(i.serviceRef))
            if (toInsert.length > 0) {
                const inserted = await insertItems(toInsert)
                dispatch(
                    fetchItemsSuccess(inserted.reverse(), getState().items)
                )
                dispatch(updateUnreadCounts())
            }
        }
    },

    markAllRead: (sids, date, before) => async (_, getState) => {
        const state = getState()
        const configs = state.service as FreshRSSConfigs
        if (date) {
            const predicates: lf.Predicate[] = [
                db.items.source.in(sids),
                db.items.hasRead.eq(false),
                db.items.serviceRef.isNotNull(),
            ]
            if (date) {
                predicates.push(
                    before ? db.items.date.lte(date) : db.items.date.gte(date)
                )
            }
            const query = lf.op.and.apply(null, predicates)
            const rows = await db.itemsDB
                .select(db.items.serviceRef)
                .from(db.items)
                .where(query)
                .exec()
            const refs = rows.map(row => row["serviceRef"]).join("&i=")
            if (refs) {
                editTag(getState().service as FreshRSSConfigs, refs, READ_TAG)
            }
        } else {
            const sources = sids.map(sid => state.sources[sid])
            for (let source of sources) {
                if (source.serviceRef) {
                    const body = new URLSearchParams()
                    body.set("s", source.serviceRef)
                    fetchAPI(
                        configs,
                        "/reader/api/0/mark-all-as-read",
                        "POST",
                        body
                    )
                }
            }
        }
    },

    markRead: (item: RSSItem) => async (_, getState) => {
        await editTag(
            getState().service as FreshRSSConfigs,
            item.serviceRef,
            READ_TAG
        )
    },

    markUnread: (item: RSSItem) => async (_, getState) => {
        await editTag(
            getState().service as FreshRSSConfigs,
            item.serviceRef,
            READ_TAG,
            false
        )
    },

    star: (item: RSSItem) => async (_, getState) => {
        await editTag(
            getState().service as FreshRSSConfigs,
            item.serviceRef,
            STAR_TAG
        )
    },

    unstar: (item: RSSItem) => async (_, getState) => {
        await editTag(
            getState().service as FreshRSSConfigs,
            item.serviceRef,
            STAR_TAG,
            false
        )
    },
}
