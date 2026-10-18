# stadiamaps-proxy

Stadia Maps 瓦片服务反向代理（Vercel Serverless），用于解决国内访问 `tiles.stadiamaps.com` 受限的问题。

- 请求路径与参数**原样透传**，服务端自动拼接 `api_key`，Key 不暴露给前端
- Vercel 边缘 CDN 缓存，同一瓦片在缓存有效期内只回源一次，**大幅节省 API 额度**

## 一键部署

1. 将本仓库推送到你的 GitHub，仓库名建议为 `stadiamaps-proxy`（若不同，请同步修改下方按钮链接）
2. 点击按钮，在部署页面按提示填入环境变量 `STADIAMAPS`（你的 Stadia Maps API Key）

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fcxvh%2Fstadiamaps-proxy&env=STADIAMAPS&project-name=stadiamaps-proxy)

> 建议部署完成后，在 Project → Settings → Functions → Function Region 选择 **Hong Kong (hkg1)** 或 **Singapore (sin1)**，国内访问延迟更低（边缘缓存也按区域存储）。

## 手动部署（CLI）

```bash
npm i -g vercel
vercel                     # 首次部署并关联项目
vercel env add STADIAMAPS  # 配置 API Key（选择 Production）
vercel --prod              # 重新部署使环境变量生效
```

## 本地开发

项目根目录创建 `.env`：

```
STADIAMAPS=你的key
```

```bash
vercel dev
# 访问 http://localhost:3000/tiles/stamen_toner/3/3/2.png
```

## 使用示例

```
https://你的域名/tiles/stamen_toner/3/3/2.png
→ https://tiles.stadiamaps.com/tiles/stamen_toner/3/3/2.png?api_key=***

https://你的域名/tiles/a/1/2.png?x=1
→ https://tiles.stadiamaps.com/tiles/a/1/2.png?x=1&api_key=***
```

任意路径与查询参数原样透传：请求带参数拼 `&api_key=`，不带参数拼 `?api_key=`。

## 缓存策略

| 层级 | 时长 | 说明 |
|------|------|------|
| Vercel 边缘缓存（`s-maxage`） | 1 年 | 同一 URL 重复请求直接命中缓存，不回源、不消耗额度 |
| 浏览器缓存（`max-age`） | 1 年 | 用户本地缓存 |
| `stale-while-revalidate` | 7 天 | 过期后先返回旧瓦片，后台静默刷新 |

- 缓存按完整 URL 区分；`api_key` 由服务端拼接、不在 URL 中，因此**所有用户共享同一份缓存**
- 失败响应（403/404/502 等）不缓存
- 边缘缓存为尽力而为：热点瓦片可存满整个时长，冷门瓦片可能被提前逐出
- 每次重新部署会清空边缘缓存

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `STADIAMAPS` | 是 | Stadia Maps API Key，在 [Stadia Maps 控制台](https://client.stadiamaps.com/) 获取 |
