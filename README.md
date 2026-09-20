<h3 align="center">FreshRSS Reader</h3>
<p align="center">A FreshRSS-specific desktop RSS reader, based on Fluent Reader</p>
<hr />

FreshRSS Reader is a fork of [Fluent Reader](https://github.com/yang991178/fluent-reader)
by Haoyuan Liu (BSD-3-Clause), trimmed down to a single sync backend: the
[Google Reader API](https://freshrss.github.io/FreshRSS/en/users/06_Mobile_access.html#google-reader-api)
as implemented by [FreshRSS](https://freshrss.org) at `https://your-server/api/greader.php`.

Local RSS fetching, the rules engine, full-content scraping, and the other
service backends (Fever, Feedbin, Inoreader, Miniflux, Nextcloud) have been
removed. Your subscriptions, read/starred state and groups live on the
FreshRSS server; articles are cached locally.

## Features

- Google Reader API sync (ClientLogin auth) against FreshRSS
- Two-way read/star state sync with incremental diffing
- Group (category) import from the server
- Cards / list / magazine / compact views, themes, search, notifications
- OPML export, favicons, PAC proxy, TouchBar support

## Download

Build from source (Linux AppImage, Windows NSIS, macOS dmg):

```bash
npm install
npm run build
npm run package-linux   # or package-win / package-mac
```

## Development

```bash
npm install
npm run build
npm run electron
```

Point the app at your FreshRSS instance's Google Reader API endpoint, e.g.
`https://your-freshrss.example/api/greader.php`, and sign in with your
FreshRSS username and (API) password.

## License

BSD-3-Clause — see [LICENSE](LICENSE). Original Fluent Reader code
Copyright © 2020 Haoyuan Liu.
