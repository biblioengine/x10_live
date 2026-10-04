# 10投稿チャレンジ実況

X に毎日10本投稿する企画を、野次馬が非公式に実況するページです。
15分ごとに参加者の投稿を X API から取得し、`data.json` を更新します。ページはその `data.json` を5分ごとに読み直します。

## 中身

| ファイル | 役割 |
|---|---|
| `index.html` | 実況ページ本体 |
| `participants.txt` | 参加者の X ハンドル（1行1人） |
| `scripts/fetch.py` | X API から投稿を取って `data.json` を作る |
| `.github/workflows/fetch.yml` | 15分ごとに `fetch.py` を自動実行する設定 |
| `data.json` | 取得結果（自動で作られる） |

## はじめの準備（1回だけ）

### 1. X API のキーを用意する
1. https://developer.x.com にログインし、開発者アカウントを作る
2. Developer Console で App（プロジェクト）を作る
3. 従量課金のクレジットを購入する（まずは 10〜20ドル程度で様子見がおすすめ）
4. App の「Keys and tokens」で **Bearer Token** を発行し、コピーしておく

### 2. GitHub にリポジトリを作る
1. GitHub で新しいリポジトリを作る（例：`x10_live`）。**Public** にする（無料で GitHub Pages を使うため）
2. このフォルダの中身を全部アップロードする
   - `.github` フォルダは隠しフォルダなので、アップロード漏れに注意

### 3. Bearer Token を登録する
リポジトリの **Settings → Secrets and variables → Actions → New repository secret**
- Name：`X_BEARER_TOKEN`
- Secret：手順1でコピーした Bearer Token

### 4. 公開ページを有効にする
**Settings → Pages**
- Source：`Deploy from a branch`
- Branch：`main` / `/(root)` を選んで Save

数分後、`https://（ユーザー名）.github.io/x10_live/` でページが開けるようになります。

### 5. 初回の取得
**Actions → 投稿を取得 → Run workflow** を押す。
1〜2分で `data.json` ができ、ページに参加者が並びます。以降は15分ごとに自動で動きます。

## 参加者を追加・削除するとき
`participants.txt` を GitHub 上で編集して保存するだけ。次の自動取得から反映されます。

## 数え方のルール（`scripts/fetch.py` の先頭で変更可）
- 1日は日本時間 0:00〜24:00
- リポスト（RT）は数えない
- 返信（リプ）は数えない。自分の投稿へのリプでつなげたツリーも返信扱いになる（`COUNT_REPLIES` を `True` にすると数える）
- 引用ポストは数える（自分の言葉を書くため。`COUNT_QUOTES` で変更可）
- 削除された投稿は、取得済みなら残ったままになる
- フォロワー数は1日1回記録。記録を始めた日からの増減になる（XのAPIは過去のフォロワー数を返さない）


止めたいときは **Actions → 投稿を取得 → 「…」→ Disable workflow**。
