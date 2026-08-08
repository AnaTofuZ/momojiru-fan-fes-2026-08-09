# ほうとう組。思い出広場

2026年8月の「もも市民再会の日」で、ボス・司令官・宝灯桃汁の好きな瞬間を集めるスマホ向けWebアプリです。

## ローカル開発

```sh
npm install
npm run db:local
```

ローカルで投稿まで試す場合は、`.dev.vars` に Turnstile の秘密鍵とローカルのホスト名を設定します（コミットしません）。

```dotenv
TURNSTILE_SECRET=Turnstileの秘密鍵
TURNSTILE_HOSTNAME=localhost
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
npx wrangler secret put TURNSTILE_SECRET
```

公開先は `https://202608.momoshimin-saikainohi.anatofuz.net` です。管理画面と管理APIは Cloudflare Access で保護します。参加者は表示名とアイコン画像で初回登録し、同じブラウザではHttpOnly Cookieで識別します。登録と公開投稿は Turnstile で検証し、画像は5MBまでで R2 の `houtougumi-memory-images` に保存します。既存の同名D1を使う場合は、その `database_id` を `wrangler.jsonc` に追加してください。

## 確認

```sh
npm test
npm run build
npx wrangler deploy --dry-run
```
