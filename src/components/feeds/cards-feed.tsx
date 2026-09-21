import * as React from "react"
import { useState, useEffect, useCallback, useRef } from "react"
import intl from "react-intl-universal"
import { FeedProps } from "./feed"
import DefaultCard from "../cards/default-card"
import { PrimaryButton, FocusZone } from "office-ui-fabric-react"
import { RSSItem } from "../../scripts/models/item"
import { List, AnimationClassNames } from "@fluentui/react"
import { ViewConfigs } from "../../schema-types"
import { useMarkReadOnScroll } from "./use-mark-read-on-scroll"

const CardsFeed: React.FC<FeedProps> = props => {
    // Reset the scroll position to the top whenever the feed content resets
    // (refresh or feed switch), otherwise stale offsets hide new unread
    // items above the viewport.
    const resetKey = `${props.feed._id}:${props.items[0]?._id ?? ""}`
    useEffect(() => {
        const container = document.getElementById("refocus")
        if (container) container.scrollTo(0, 0)
    }, [resetKey])
    const handleScroll = useMarkReadOnScroll(
        window.settings.getScrollMarkReadOn() &&
            Boolean(props.viewConfigs & ViewConfigs.MarkReadOnScroll),
        props.items,
        props.markRead,
        resetKey
    )
    const [width, setWidth] = useState(window.innerWidth)
    const [height, setHeight] = useState(window.innerHeight)
    const observerRef = useRef<ResizeObserver>(null)

    useEffect(() => {
        setWidth(document.querySelector(".main").clientWidth - 40)
        observerRef.current = new ResizeObserver(
            (entries: ResizeObserverEntry[]) => {
                if (entries) {
                    setWidth(entries[0].contentRect.width - 40)
                    setHeight(window.innerHeight)
                }
            }
        )
        observerRef.current.observe(document.querySelector(".main"))
        return () => {
            observerRef.current.disconnect()
        }
    }, [])

    const getItemCountForPage = useCallback(() => {
        let elemPerRow = Math.floor(width / 280)
        let rows = Math.ceil(height / 304)
        return elemPerRow * rows
    }, [width, height])

    const getPageHeight = useCallback(() => {
        return height + (304 - (height % 304))
    }, [height])

    const flexFixItems = () => {
        let elemPerRow = Math.floor(width / 280)
        let elemLastRow = props.items.length % elemPerRow
        let items = [...props.items]
        for (let i = 0; i < elemPerRow - elemLastRow; i += 1) items.push(null)
        return items
    }

    const onRenderItem = (item: RSSItem, index: number) =>
        item ? (
            <DefaultCard
                feedId={props.feed._id}
                key={item._id}
                item={item}
                source={props.sourceMap[item.source]}
                filter={props.filter}
                shortcuts={props.shortcuts}
                markRead={props.markRead}
                contextMenu={props.contextMenu}
                showItem={props.showItem}
            />
        ) : (
            <div className="flex-fix" key={"f-" + index}></div>
        )

    const canFocusChild = (el: HTMLElement) => {
        if (el.id === "load-more") {
            const container = document.getElementById("refocus")
            const result =
                container.scrollTop >
                container.scrollHeight - 2 * container.offsetHeight
            if (!result) container.scrollTop += 100
            return result
        } else {
            return true
        }
    }

    return (
        props.feed.loaded && (
            <FocusZone
                as="div"
                id="refocus"
                className="cards-feed-container"
                shouldReceiveFocus={canFocusChild}
                onScroll={handleScroll}
                data-is-scrollable>
                <List
                    className={AnimationClassNames.slideUpIn10}
                    items={flexFixItems()}
                    onRenderCell={onRenderItem}
                    getItemCountForPage={getItemCountForPage}
                    getPageHeight={getPageHeight}
                    ignoreScrollingState
                    usePageCache
                />
                {props.feed.loaded && !props.feed.allLoaded ? (
                    <div className="load-more-wrapper">
                        <PrimaryButton
                            id="load-more"
                            text={intl.get("loadMore")}
                            disabled={props.feed.loading}
                            onClick={() => props.loadMore(props.feed)}
                        />
                    </div>
                ) : null}
                {props.feed.loaded &&
                props.feed.allLoaded &&
                props.items.some(i => !i.hasRead) ? (
                    <div className="load-more-wrapper">
                        <PrimaryButton
                            id="mark-read"
                            text={intl.get("nav.markAllRead")}
                            onClick={() => props.markAllRead(props.items)}
                        />
                    </div>
                ) : null}
                {props.items.length === 0 && (
                    <div className="empty">{intl.get("article.empty")}</div>
                )}
            </FocusZone>
        )
    )
}

export default CardsFeed
