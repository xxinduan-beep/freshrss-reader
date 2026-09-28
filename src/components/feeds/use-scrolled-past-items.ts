import { useCallback, useEffect, useRef, useState } from "react"
import { RSSItem } from "../../scripts/models/item"

// Tracks which items have been displayed in the viewport during the current
// reading session. The "mark all read" button at the end of the feed uses
// this so it only marks items the reader actually scrolled through, and
// never items that arrived on the server or were merged into the list
// without being shown.
export function useScrolledPastItems(
    items: RSSItem[],
    feedId: string
): [Set<number>, (e: React.UIEvent<HTMLElement>) => void] {
    const [seenIds, setSeenIds] = useState<Set<number>>(() => new Set())
    const seenRef = useRef(seenIds)
    const observerRef = useRef<IntersectionObserver>(null)
    const tickingRef = useRef(false)

    // Drop the records when switching feeds. A refresh prepending new items
    // keeps the history, so items already scrolled through stay markable.
    useEffect(() => {
        seenRef.current = new Set()
        setSeenIds(new Set())
    }, [feedId])

    const observeItems = useCallback((container: HTMLElement) => {
        if (!observerRef.current || observerRef.current.root !== container) {
            observerRef.current?.disconnect()
            observerRef.current = new IntersectionObserver(
                entries => {
                    let added = false
                    for (let entry of entries) {
                        if (entry.isIntersecting) {
                            const id = Number(
                                (entry.target as HTMLElement).dataset.iid
                            )
                            if (!seenRef.current.has(id)) {
                                seenRef.current.add(id)
                                added = true
                            }
                        }
                    }
                    if (added) setSeenIds(new Set(seenRef.current))
                },
                { root: container }
            )
        }
        container
            .querySelectorAll<HTMLElement>("[data-iid]")
            .forEach(el => observerRef.current.observe(el))
    }, [])

    useEffect(() => () => observerRef.current?.disconnect(), [])

    // Cover newly rendered cards (pagination, refresh) without waiting for a
    // scroll event.
    useEffect(() => {
        const container = document.getElementById("refocus")
        if (container) observeItems(container)
    }, [observeItems, feedId, items.length, items[0]?._id])

    const handleScroll = useCallback(
        (e: React.UIEvent<HTMLElement>) => {
            const container = e.currentTarget
            if (tickingRef.current) return
            tickingRef.current = true
            requestAnimationFrame(() => {
                tickingRef.current = false
                observeItems(container)
            })
        },
        [observeItems]
    )

    return [seenIds, handleScroll]
}
