# stadiamaps-proxy

Stadia Maps 瓦片反向代理（Vercel Serverless），解决国内访问受限，边缘缓存省额度，域名白名单防盗用。

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fcxvh%2Fstadiamaps-proxy&env=STADIAMAPS,ALLOWED_DOMAINS&project-name=stadiamaps-proxy)

## 使用

```
https://你的域名/tiles/stamen_toner/3/3/2.png
→ https://tiles.stadiamaps.com/tiles/stamen_toner/3/3/2.png?api_key=***
```

路径与参数原样透传，服务端自动拼 `api_key`（请求带参数拼 `&`，不带拼 `?`）。

## 配置

| 环境变量 | 说明 |
|------|------|
| `STADIAMAPS` | Stadia Maps API Key（必填） |
| `ALLOWED_DOMAINS` | 域名白名单，逗号分隔，支持 `*.example.com`；默认 `*.cnb.run,*.cxvh.com,*.allapi.cc` |

- 白名单校验 `Origin` / `Referer`，非白名单及无来源头的请求返回 403
- 缓存：边缘与浏览器均 1 年，命中不回源、不耗额度，重新部署清空
- 本地调试：根目录建 `.env` 填 `STADIAMAPS=你的key`，运行 `vercel dev`
- CLI 部署：`npm i -g vercel && vercel --prod`
