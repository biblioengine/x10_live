#!/usr/bin/env python3
"""X 10投稿チャレンジ：参加者の投稿を X API から取得して data.json を更新する。

GitHub Actions から定期実行される想定。必要なのは環境変数 X_BEARER_TOKEN だけ。
- 参加者は participants.txt（1行1ハンドル）
- 投稿は参加者ごとに「前回取得した最新の投稿より後」だけを取りに行く（同じ投稿を二度読まないので課金が増えない）
- リポスト（RT）と返信（ツリーを含む）は数えない。引用は数える（下の設定で変更可）
- X の一覧から漏れた投稿は manual_posts.txt に URL を書くと個別に取り込む
- 名前・アイコン・フォロワー数は日本時間で1日1回だけ取り直し、フォロワー数は日付ごとに記録する
"""
import json, os, re, sys, time, urllib.parse, urllib.request, urllib.error
from datetime import datetime, timezone, timedelta

# ---- 設定 ----
CHALLENGE_START = "2026-10-01T00:00:00+09:00"  # 企画の開始日時（日本時間）
COUNT_REPLIES = False       # 返信も1本として数えるか（False なら取得自体しないので課金も減る）
COUNT_QUOTES = True         # 引用ポストも1本として数えるか
# この仕組みを入れる前に @ID を変えた人（X の内部ID: 前のハンドル）。引き継ぎが済めば残しておいても害はない
OLD_HANDLES = {"2102709315241144321": "bolu_note"}

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data.json")
PARTICIPANTS = os.path.join(ROOT, "participants.txt")
MANUAL = os.path.join(ROOT, "manual_posts.txt")
SUBS = os.path.join(ROOT, "subaccounts.txt")
AVATARS = os.path.join(ROOT, "avatars")
API = "https://api.x.com/2"
TOKEN = os.environ.get("X_BEARER_TOKEN", "").strip()


JST = timezone(timedelta(hours=9))


def today_jst():
    return datetime.now(JST).strftime("%Y-%m-%d")


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def api(path, params):
    url = f"{API}{path}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {TOKEN}", "User-Agent": "x10-live"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")[:300]
        if e.code == 429:
            raise RateLimited(body)
        raise RuntimeError(f"HTTP {e.code} {path}: {body}")


class RateLimited(Exception):
    pass


def load_handles():
    out, seen = [], set()
    with open(PARTICIPANTS, encoding="utf-8") as f:
        for line in f:
            h = line.strip().lstrip("@")
            if not h or h.startswith("#"):
                continue
            if h.lower() not in seen:
                seen.add(h.lower())
                out.append(h)
    return out


def load_subs():
    """subaccounts.txt：1行に「メインのハンドル サブのハンドル」。"""
    out = []
    if os.path.exists(SUBS):
        with open(SUBS, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                parts = [x.lstrip("@") for x in line.split()]
                if len(parts) >= 2:
                    out.append((parts[0], parts[1]))
    return out


def load_data():
    if os.path.exists(DATA):
        with open(DATA, encoding="utf-8") as f:
            return json.load(f)
    return {"start": CHALLENGE_START, "users": [], "posts": [], "state": {}}


def refresh_users(data, handles):
    """名前・アイコン・フォロワー数を取得。全員分は日本時間で1日1回、新しく増えた人はその場で。"""
    st = data.setdefault("state", {})
    followers = data.setdefault("followers", {})
    known = {u["handle"].lower(): u for u in data["users"] + data.get("sub_users", [])}
    today = today_jst()
    daily = st.get("users_refreshed_on") != today or os.environ.get("FORCE_PROFILE_REFRESH") == "true"
    targets = handles if daily else [h for h in handles if h.lower() not in known]
    if targets:
        for i in range(0, len(targets), 100):
            res = api("/users/by", {"usernames": ",".join(targets[i:i + 100]),
                                    "user.fields": "name,profile_image_url,public_metrics"})
            for u in res.get("data", []):
                known[u["username"].lower()] = {"handle": u["username"], "id": u["id"], "name": u.get("name") or u["username"],
                                                "avatar": u.get("profile_image_url", "")}
                fc = u.get("public_metrics", {}).get("followers_count")
                if fc is not None:
                    followers.setdefault(u["username"], {})[today] = fc
            for e in res.get("errors", []):
                print(f"  ユーザーが見つかりません: {e.get('value')} ({e.get('title')}) ※@IDを変えた人なら participants.txt を新しいIDに書き換えてください")
        if daily:
            st["users_refreshed_on"] = today
    # participants.txt の順番で並べ、リストから外した人は消す
    data["users"] = [known[h.lower()] for h in handles if h.lower() in known]


def follow_renames(data):
    """@ID を変えた人の記録を引き継ぐ。X の内部ID（変わらない番号）ごとに前回のハンドルを覚えておき、
    participants.txt を新しいハンドルに書き換えたら、それまでの投稿とフォロワー数の記録を新しい名前に付け替える。"""
    st = data.setdefault("state", {})
    by_id = st.setdefault("handle_by_id", {})
    for k, v in OLD_HANDLES.items():
        by_id.setdefault(k, v)
    followers = data.setdefault("followers", {})
    for u in data["users"] + data.get("sub_users", []):
        old, new = by_id.get(u["id"]), u["handle"]
        if old and old.lower() != new.lower():
            n = 0
            for p in data["posts"]:
                if p["handle"].lower() == old.lower():
                    p["handle"] = new
                    n += 1
            for k in [k for k in followers if k.lower() == old.lower()]:
                merged = followers.pop(k)
                merged.update(followers.get(new, {}))
                followers[new] = merged
            print(f"  @{old} → @{new} に引き継ぎ（投稿 {n}件）")
        by_id[u["id"]] = new


def counts(t):
    refs = {r["type"] for r in t.get("referenced_tweets", [])}
    if "retweeted" in refs:
        return False
    if "replied_to" in refs and not COUNT_REPLIES:
        return False
    if "quoted" in refs and not COUNT_QUOTES:
        return False
    return True


def fetch_posts(data):
    st = data.setdefault("state", {})
    since = st.setdefault("since_id", {})
    have = {p["id"] for p in data["posts"]}
    added = 0
    for u in data["users"] + data.get("sub_users", []):
        params = {"max_results": 100, "tweet.fields": "created_at,referenced_tweets",
                  "exclude": "retweets" if COUNT_REPLIES else "retweets,replies"}
        if since.get(u["id"]):
            params["since_id"] = since[u["id"]]
        else:
            params["start_time"] = datetime.fromisoformat(CHALLENGE_START).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        newest = since.get(u["id"])
        token = None
        while True:
            if token:
                params["pagination_token"] = token
            res = api(f"/users/{u['id']}/tweets", params)
            for t in res.get("data", []):
                if newest is None or int(t["id"]) > int(newest):
                    newest = t["id"]
                if t["id"] in have or not counts(t):
                    continue
                kind = "reply" if any(r["type"] == "replied_to" for r in t.get("referenced_tweets", [])) else \
                       "quote" if any(r["type"] == "quoted" for r in t.get("referenced_tweets", [])) else "post"
                data["posts"].append({"id": t["id"], "handle": u["handle"], "created_at": t["created_at"],
                                      "text": t.get("text", ""), "kind": kind})
                have.add(t["id"])
                added += 1
            token = res.get("meta", {}).get("next_token")
            if not token:
                break
        if newest:
            since[u["id"]] = newest
        time.sleep(0.3)
    return added


def fetch_manual(data):
    """manual_posts.txt に書いた投稿（URL か ID）を個別に取り込む。X の一覧から漏れた投稿の補正用。"""
    if not os.path.exists(MANUAL):
        return 0
    ids = []
    with open(MANUAL, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            m = re.search(r"(\d{15,})", line.split("?")[0])
            if m:
                ids.append(m.group(1))
    have = {p["id"] for p in data["posts"]}
    todo = [i for i in dict.fromkeys(ids) if i not in have]
    if not todo:
        return 0
    by_id = {u["id"]: u for u in data["users"] + data.get("sub_users", [])}
    added = 0
    for i in range(0, len(todo), 100):
        res = api("/tweets", {"ids": ",".join(todo[i:i + 100]),
                              "tweet.fields": "created_at,referenced_tweets,author_id"})
        for t in res.get("data", []):
            u = by_id.get(t.get("author_id"))
            if not u:
                print(f"  手動追加：参加者ではない人の投稿のためスキップ {t['id']}")
                continue
            refs = {r["type"] for r in t.get("referenced_tweets", [])}
            kind = "reply" if "replied_to" in refs else "quote" if "quoted" in refs else "post"
            data["posts"].append({"id": t["id"], "handle": u["handle"], "created_at": t["created_at"],
                                  "text": t.get("text", ""), "kind": kind, "manual": True})
            added += 1
        for e in res.get("errors", []):
            print(f"  手動追加：取得できない投稿 {e.get('value')} ({e.get('title')})")
    return added


def save_avatars(data):
    """個人カードの画像に使うアイコンを avatars/ に保存する（1日1回、新しい人はその場で）。
    X の画像をそのままカードに描くとブラウザの制限で書き出せないため、同じサイトに置く。"""
    st = data.setdefault("state", {})
    today = today_jst()
    daily = st.get("avatars_saved_on") != today
    os.makedirs(AVATARS, exist_ok=True)
    n = 0
    for u in data["users"] + data.get("sub_users", []):
        url = u.get("avatar") or ""
        path = os.path.join(AVATARS, u["handle"].lower() + ".jpg")
        if not url or (not daily and os.path.exists(path)):
            continue
        try:
            req = urllib.request.Request(url.replace("_normal.", "_400x400."), headers={"User-Agent": "x10-live"})
            with urllib.request.urlopen(req, timeout=20) as r:
                body = r.read()
            if body:
                with open(path, "wb") as f:
                    f.write(body)
                n += 1
        except Exception as e:
            print(f"  アイコンを保存できませんでした: {u['handle']} ({e})")
    if daily:
        st["avatars_saved_on"] = today
    return n


def main():
    if not TOKEN:
        sys.exit("X_BEARER_TOKEN が設定されていません（GitHub の Settings → Secrets に登録してください）")
    handles = load_handles()
    data = load_data()
    data["start"] = CHALLENGE_START
    # ツリーを数えていた時期に取り込んだ分を片付ける（ツリーは数えないルールに戻したため）
    data["posts"] = [p for p in data["posts"] if p.get("kind") != "thread"]
    for k in ("self_reply_since", "self_reply_users"):
        data.setdefault("state", {}).pop(k, None)
    try:
        subs = load_subs()
        main_lower = {h.lower() for h in handles}
        sub_map = {s.lower(): m for m, s in subs if s.lower() not in main_lower}
        refresh_users(data, handles + [s for m, s in subs if s.lower() in sub_map])
        # サブアカウントは一覧・ランキングとは別のグループに分ける
        data["sub_users"] = [dict(u, main=sub_map[u["handle"].lower()]) for u in data["users"] if u["handle"].lower() in sub_map]
        data["users"] = [u for u in data["users"] if u["handle"].lower() not in sub_map]
        follow_renames(data)
        added = fetch_posts(data)
        print(f"参加者 {len(data['users'])}人 / 新しい投稿 {added}件")
        try:
            print(f"手動追加 {fetch_manual(data)}件")
        except RuntimeError as e:
            print("手動追加の取得に失敗しました:", e)
    except RateLimited as e:
        print("X API の回数制限に達したため、今回はここまでで保存します:", e)
    try:
        n = save_avatars(data)
        if n:
            print(f"アイコン保存 {n}件")
    except Exception as e:
        print("アイコンの保存に失敗しました:", e)
    data["posts"].sort(key=lambda p: p["created_at"])
    data["updated_at"] = now_iso()
    with open(DATA, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
