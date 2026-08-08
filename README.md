# ほうとう組。思い出広場

2026年8月の「もも市民再会の日」で、ボス・司令官・宝灯桃汁の好きな瞬間を集めるスマホ向けWebアプリです。

## ローカル開発

```sh
npm install
npm run db:local
```

`.dev.vars` に管理画面用トークンを設定します。

```dotenv
ADMIN_USER=管理者名
ADMIN_PASSWORD=推測されにくいパスワード
```

```sh
npm run dev
```

`http://localhost:8787` を開きます。管理画面は `/admin` です。

## Cloudflareへ公開

Wranglerで `anatofuz.net` を管理するCloudflareアカウントにログインした状態で実行します。

```sh
npx wrangler r2 bucket create houtougumi-memory-images
npm run deploy
npm run db:remote
npx wrangler secret put ADMIN_USER
npx wrangler secret put ADMIN_PASSWORD
```

公開先は `https://202608.momoshimin-saikainohi.anatofuz.net` です。初回deploy時にD1データベースが自動作成されます。画像は5MBまでで、R2の `houtougumi-memory-images` に保存します。既存の同名D1を使う場合は、その `database_id` を `wrangler.jsonc` に追加してください。

## 確認

```sh
npm test
npm run build
npx wrangler deploy --dry-run
```
