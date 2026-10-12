import { useCallback, useEffect, useRef } from "react"
import { RSSItem } from "../../scripts/models/item"

export function useMarkReadOnScroll(
    enabled: boolean,
    items: RSSItem[],
    markRead: (item: RSSItem) => void,
    resetKey?: string
) {
    const itemsRef = useRef(items)
    itemsRef.current = items
    const markReadRef = useRef(markRead)
    markReadRef.current = markRead
    const tickingRef = useRef(false)
    const seenRef = useRef<Set<number>>(new Set())
    const observerRef = useRef<IntersectionObserver>(null)

    // When the feed content resets (refresh, feed switch), drop the stale
    // scroll position and seen-item records so scrolling down from the top
    // marks again.
    useEffect(() => {
        seenRef.current = new Set()
    }, [resetKey])

    // Track which items have actually entered the viewport. Only these may
    // ever be marked read on scroll, so items merged into the top of the
    // list by a background fetch (never displayed) are not silently marked.
    const observeItems = useCallback((container: HTMLElement) => {
        if (!observerRef.current || observerRef.current.root !== container) {
            observerRef.current?.disconnect()
            observerRef.current = new IntersectionObserver(
                entries => {
                    for (let entry of entries) {
                        if (entry.isIntersecting) {
                            seenRef.current.add(
                                Number(
                                    (entry.target as HTMLElement).dataset.iid
                                )
                            )
                        }
                    }
                },
                { root: container }
            )
        }
        container
            .querySelectorAll<HTMLElement>("[data-iid]")
            .forEach(el => observerRef.current.observe(el))
    }, [])

    useEffect(() => () => observerRef.current?.disconnect(), [])

    return useCallback(
        (e: React.UIEvent<HTMLElement>) => {
            const container = e.currentTarget
            observeItems(container)
            if (!enabled || tickingRef.current) return
            tickingRef.current = true
            requestAnimationFrame(() => {
                tickingRef.current = false
                const containerRect = container.getBoundingClientRect()
                const containerTop = containerRect.top
                // Only items that have left the viewport through the top
                // edge (i.e. passed by while scrolling down) count as read.
                // Items leaving through the bottom edge must stay unread.
                let maxOutIndex = -1
                container
                    .querySelectorAll<HTMLElement>("[data-iid]")
                    .forEach(el => {
                        const index = itemsRef.current.findIndex(
                            i => i._id === Number(el.dataset.iid)
                        )
                        if (index === -1) return
                        const rect = el.getBoundingClientRect()
                        if (rect.bottom <= containerTop) {
                            if (index > maxOutIndex) maxOutIndex = index
                        }
                    })
                const markItem = (item: RSSItem) => {
                    if (
                        item &&
                        !item.hasRead &&
                        seenRef.current.has(item._id)
                    ) {
                        markReadRef.current(item)
                    }
                }
                for (let i = 0; i <= maxOutIndex; i++) {
                    markItem(itemsRef.current[i])
                }
            })
        },
        [enabled, observeItems]
    )
}
