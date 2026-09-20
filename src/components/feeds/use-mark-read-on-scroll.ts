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
    const lastScrollTopRef = useRef(0)

    // When the feed content resets (refresh, feed switch), drop the stale
    // scroll position so scrolling down from the top marks again.
    useEffect(() => {
        lastScrollTopRef.current = 0
    }, [resetKey])

    return useCallback(
        (e: React.UIEvent<HTMLElement>) => {
            const container = e.currentTarget
            const scrollTop = container.scrollTop
            const scrolledDown = scrollTop > lastScrollTopRef.current
            lastScrollTopRef.current = scrollTop
            if (!enabled || !scrolledDown || tickingRef.current) return
            tickingRef.current = true
            requestAnimationFrame(() => {
                tickingRef.current = false
                const containerTop = container.getBoundingClientRect().top
                let maxOutIndex = -1
                container
                    .querySelectorAll<HTMLElement>("[data-iid]")
                    .forEach(el => {
                        if (el.getBoundingClientRect().bottom <= containerTop) {
                            const index = itemsRef.current.findIndex(
                                i => i._id === Number(el.dataset.iid)
                            )
                            if (index > maxOutIndex) maxOutIndex = index
                        }
                    })
                for (let i = 0; i <= maxOutIndex; i++) {
                    const item = itemsRef.current[i]
                    if (item && !item.hasRead) markReadRef.current(item)
                }
            })
        },
        [enabled]
    )
}
