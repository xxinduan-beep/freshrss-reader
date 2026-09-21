function get(name) {
    if (name = (new RegExp('[?&]' + encodeURIComponent(name) + '=([^&]*)')).exec(location.search))
        return decodeURIComponent(name[1]);
}
let dir = get("d")
if (dir === "1") {
    document.body.classList.add("rtl")
} else if (dir === "2") {
    document.body.classList.add("vertical")
    document.body.addEventListener("wheel", (evt) => {
        document.scrollingElement.scrollLeft -= evt.deltaY;
    });
}
async function getArticle(url) {
    let article = get("a")
    if (get("m") === "1") {
        return (await Mercury.parse(url, {html: article})).content || ""
    } else {
        return article
    }
}
document.documentElement.style.fontSize = get("s") + "px"
let font = get("f")
if (font) document.body.style.fontFamily = `"${font}"`
let url = get("u")
getArticle(url).then(article => {
    let domParser = new DOMParser()
    let dom = domParser.parseFromString(get("h"), "text/html")
    dom.getElementsByTagName("article")[0].innerHTML = article
    let baseEl = dom.createElement('base')
    baseEl.setAttribute('href', url.split("/").slice(0, 3).join("/"))
    dom.head.append(baseEl)
    for (let s of dom.getElementsByTagName("script")) {
        s.parentNode.removeChild(s)
    }
    for (let e of dom.querySelectorAll("*[src]")) {
        e.src = e.src
    }
    for (let e of dom.querySelectorAll("*[href]")) {
        e.href = e.href
    }
    let main = document.getElementById("main")
    main.innerHTML = dom.body.innerHTML
    main.classList.add("show")
});
document.addEventListener("click", (evt) => {
    if (evt.button !== 0 || !evt.isTrusted) return;
    let target = evt.target;
    while (target && target.nodeName !== "A") {
        target = target.parentElement;
    }
    if (target && target.href && /^https?:/.test(target.href)) {
        evt.preventDefault();
        window.parent.postMessage({
            type: "frss-webview-link",
            url: target.href,
        }, "*");
    }
}, true);
document.addEventListener("keydown", (evt) => {
    if (evt.isTrusted) {
        window.parent.postMessage({
            type: "frss-webview-keydown",
            input: {
                type: "keyDown",
                key: evt.key,
                code: evt.code,
                alt: evt.altKey,
                control: evt.ctrlKey,
                shift: evt.shiftKey,
                meta: evt.metaKey,
                isAutoRepeat: evt.repeat,
            },
        }, "*");
    }
});
