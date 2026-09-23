import * as React from "react"
import intl from "react-intl-universal"
import {
    Callout,
    Checkbox,
    CommandBarButton,
    DirectionalHint,
    PrimaryButton,
    TextField,
} from "@fluentui/react"
import { makeStyles, mergeClasses } from "@griffel/react"
import { RSSItem } from "../../scripts/models/item"
import { Spinner } from "@fluentui/react-components"

const useStyles = makeStyles({
    wrapper: {
        display: "inline-block",
    },
    list: {
        maxHeight: "320px",
        overflowY: "auto",
        padding: "6px 0",
        minHeight: "32px",
    },
    item: {
        "display": "flex",
        "alignItems": "center",
        "padding": "3px 12px",
        ":hover": {
            backgroundColor: "#0001",
        },
        "@media (prefers-color-scheme: dark)": {
            ":hover": {
                backgroundColor: "#fff1",
            },
        },
    },
    footer: {
        display: "flex",
        alignItems: "flex-end",
        padding: "8px 12px 12px",
        borderTop: "1px solid var(--neutralLighter, #eee)",
    },
    input: {
        flex: 1,
        marginRight: "8px",
    },
    hint: {
        padding: "4px 12px",
        color: "var(--neutralSecondary)",
        fontSize: "12px",
    },
    error: {
        padding: "8px 12px",
        color: "var(--neutralSecondary)",
    },
})

export interface TagEditorProps {
    item: RSSItem
    fetchAvailableTags: () => Promise<string[]>
    fetchItemTags: (item: RSSItem) => Promise<string[]>
    updateItemTags: (item: RSSItem, added: string[], removed: string[]) => void
    styleClass?: string
}

export const TagEditor: React.FC<TagEditorProps> = ({
    item,
    fetchAvailableTags,
    fetchItemTags,
    updateItemTags,
    styleClass,
}) => {
    const classes = useStyles()
    const buttonRef = React.useRef<HTMLSpanElement>(null)
    const [open, setOpen] = React.useState(false)
    const [loading, setLoading] = React.useState(false)
    const [error, setError] = React.useState(false)
    const [available, setAvailable] = React.useState<string[]>([])
    const [applied, setApplied] = React.useState<string[]>([])
    const [newTag, setNewTag] = React.useState("")

    const openEditor = () => {
        setOpen(true)
        setLoading(true)
        setError(false)
        setApplied([])
        setAvailable([])
        Promise.all([fetchAvailableTags(), fetchItemTags(item)])
            .then(([tags, itemTags]) => {
                setAvailable(tags)
                setApplied(itemTags)
            })
            .catch(err => {
                console.warn("[FreshRSS] fetch tags failed:", err)
                setError(true)
            })
            .finally(() => setLoading(false))
    }

    const allTags = React.useMemo(() => {
        const names = new Set(available)
        for (let t of applied) names.add(t)
        return [...names].sort((a, b) =>
            a.localeCompare(b, undefined, { sensitivity: "base" })
        )
    }, [available, applied])

    // Clicks inside the article iframe do not reach this document, so the
    // Callout's own outside-click detection cannot see them; the iframe
    // relays them as "frss-webview-click" messages instead.
    React.useEffect(() => {
        if (!open) return
        const onMessage = (ev: MessageEvent) => {
            if (ev.data && ev.data.type === "frss-webview-click") {
                setOpen(false)
            }
        }
        window.addEventListener("message", onMessage)
        return () => window.removeEventListener("message", onMessage)
    }, [open])

    const toggleTag = (tag: string, checked: boolean) => {
        setApplied(prev =>
            checked
                ? prev.includes(tag)
                    ? prev
                    : [...prev, tag]
                : prev.filter(t => t !== tag)
        )
        if (checked && !available.includes(tag)) {
            setAvailable(prev => [...prev, tag].sort())
        }
        updateItemTags(item, checked ? [tag] : [], checked ? [] : [tag])
    }

    const addNewTag = () => {
        const tag = newTag.trim()
        if (tag === "") return
        setNewTag("")
        toggleTag(tag, true)
    }

    return (
        <span className={mergeClasses(classes.wrapper, styleClass)}>
            <span ref={buttonRef}>
                <CommandBarButton
                    title={intl.get("article.tags")}
                    iconProps={{ iconName: "Tag" }}
                    onClick={() => (open ? setOpen(false) : openEditor())}
                />
            </span>
            {open && (
                <Callout
                    target={buttonRef.current}
                    directionalHint={DirectionalHint.bottomRightEdge}
                    gapSpace={4}
                    calloutWidth={220}
                    styles={{
                        root: {
                            border: "1px solid var(--neutralTertiaryAlt, #c8c6c4)",
                            borderRadius: 4,
                        },
                    }}
                    onDismiss={() => setOpen(false)}>
                    {error ? (
                        <p className={classes.error}>
                            {intl.get("service.failure")}
                        </p>
                    ) : loading ? (
                        <div className={classes.hint}>
                            <Spinner size="extra-tiny" />
                        </div>
                    ) : (
                        <>
                            <div className={classes.list}>
                                {allTags.length === 0 ? (
                                    <p className={classes.hint}>
                                        {intl.get("article.noTags")}
                                    </p>
                                ) : (
                                    allTags.map(tag => (
                                        <div className={classes.item} key={tag}>
                                            <Checkbox
                                                label={tag}
                                                checked={applied.includes(tag)}
                                                onChange={(_, checked) =>
                                                    toggleTag(tag, !!checked)
                                                }
                                            />
                                        </div>
                                    ))
                                )}
                            </div>
                            <div className={classes.footer}>
                                <TextField
                                    className={classes.input}
                                    placeholder={intl.get("article.newTag")}
                                    value={newTag}
                                    onChange={(_, value) =>
                                        setNewTag(value || "")
                                    }
                                    onKeyDown={e => {
                                        if (e.key === "Enter") addNewTag()
                                    }}
                                />
                                <PrimaryButton
                                    text={intl.get("article.addTag")}
                                    disabled={newTag.trim() === ""}
                                    onClick={addNewTag}
                                />
                            </div>
                        </>
                    )}
                </Callout>
            )}
        </span>
    )
}
