# 书源调试

用本机 Docker 中的 reader（`changshengyu/reader`，内置 Legado 规则引擎）调试书源，不需要手机。

- reader 地址：`http://localhost:14396`，API 前缀 `/reader3`，未开启登录鉴权。
- reader 在容器中，用 `host.docker.internal` 访问本机服务。`wrangler dev` 必须加 `--ip 0.0.0.0`。

步骤：

1. 在后台「访问令牌」页面创建访问令牌，复制导入地址，把 `localhost` 换成 `host.docker.internal`。
2. `POST /reader3/readRemoteSourceFile`，body `{"url": "<导入地址>"}`。返回 `data[0]` 是书源数组的 JSON 字符串。
3. `POST /reader3/saveBookSources`，body 是上一步的书源数组。
4. 依次调用（`bookSourceUrl` 是书源地址，例如 `http://host.docker.internal:8787`）：
   - `GET /reader3/searchBook?key=<关键字>&bookSourceUrl=<书源地址>`
   - `GET /reader3/getBookInfo?url=<bookUrl>&bookSourceUrl=<书源地址>`
   - `GET /reader3/getChapterList?url=<bookUrl>&bookSourceUrl=<书源地址>`
   - `GET /reader3/getBookContent?url=<bookUrl>&index=<章节序号>&bookSourceUrl=<书源地址>`
5. 在 `wrangler dev` 日志中核对 `/api/source/*` 请求全部是 200；出现 401 说明请求头没有带上访问令牌。

reader 的行为接近 Legado App，但不完全相同。真机验证仍以「阅读」App 为准。
