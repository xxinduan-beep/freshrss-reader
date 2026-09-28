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
                const containerBottom = containerRect.bottom
                // In either scroll direction, any item that has left the
                // viewport counts as read: scrolling down moves items out
                // through the top edge, and at the end of the list the last
                // items can only leave through the bottom edge when
                // scrolling back up.
                let maxOutIndex = -1
                let minOutIndex = itemsRef.current.length
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
                        } else if (rect.top >= containerBottom) {
                            if (index < minOutIndex) minOutIndex = index
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
                for (let i = minOutIndex; i < itemsRef.current.length; i++) {
                    markItem(itemsRef.current[i])
                }
            })
        },
        [enabled, observeItems]
    )
}
