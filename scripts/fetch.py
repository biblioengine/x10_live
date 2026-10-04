#!/usr/bin/env python3
"""X 10投稿チャレンジ：参加者の投稿を X API から取得して data.json を更新する。

GitHub Actions から定期実行される想定。必要なのは環境変数 X_BEARER_TOKEN だけ。
- 参加者は participants.txt（1行1ハンドル）
- 投稿は参加者ごとに「前回取得した最新の投稿より後」だけを取りに行く（同じ投稿を二度読まないので課金が増えない）
- リポスト（RT）と他人への返信は数えない。引用と、自分の投稿へのリプ（ツリー）は数える（下の設定で変更可）
- 名前・アイコン・フォロワー数は日本時間で1日1回だけ取り直し、フォロワー数は日付ごとに記録する
"""
import json, os, sys, time, urllib.parse, urllib.request, urllib.error
from datetime import datetime, timezone, timedelta

# ---- 設定 ----
CHALLENGE_START = "2026-10-01T00:00:00+09:00"  # 企画の開始日時（日本時間）
COUNT_REPLIES = False       # 返信も1本として数えるか（False なら取得自体しないので課金も減る）
COUNT_QUOTES = True         # 引用ポストも1本として数えるか
COUNT_SELF_REPLIES = True   # 自分の投稿へのリプ（ツリー・連投）を1本として数えるか

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data.json")
PARTICIPANTS = os.path.join(ROOT, "participants.txt")
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


def load_data():
    if os.path.exists(DATA):
        with open(DATA, encoding="utf-8") as f:
            return json.load(f)
    return {"start": CHALLENGE_START, "users": [], "posts": [], "state": {}}


def refresh_users(data, handles):
    """名前・アイコン・フォロワー数を取得。全員分は日本時間で1日1回、新しく増えた人はその場で。"""
    st = data.setdefault("state", {})
    followers = data.setdefault("followers", {})
    known = {u["handle"].lower(): u for u in data["users"]}
    today = today_jst()
    daily = st.get("users_refreshed_on") != today
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
                print(f"  ユーザーが見つかりません: {e.get('value')} ({e.get('title')})")
        if daily:
            st["users_refreshed_on"] = today
    # participants.txt の順番で並べ、リストから外した人は消す
    data["users"] = [known[h.lower()] for h in handles if h.lower() in known]


def counts(t, self_reply=False):
    refs = {r["type"] for r in t.get("referenced_tweets", [])}
    if "retweeted" in refs:
        return False
    if "replied_to" in refs and not (COUNT_REPLIES or (self_reply and COUNT_SELF_REPLIES)):
        return False
    if "quoted" in refs and not COUNT_QUOTES:
        return False
    return True


def fetch_posts(data):
    st = data.setdefault("state", {})
    since = st.setdefault("since_id", {})
    have = {p["id"] for p in data["posts"]}
    added = 0
    for u in data["users"]:
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


def fetch_self_replies(data):
    """自分の投稿へのリプ（ツリー）だけを検索で取る。他人への返信は読まないので課金されない。
    検索は直近7日分しかさかのぼれないため、追加されたばかりの人も7日前までが上限。"""
    if not COUNT_SELF_REPLIES or not data["users"]:
        return 0
    st = data.setdefault("state", {})
    covered = set(st.get("self_reply_users", []))
    have = {p["id"] for p in data["posts"]}
    by_id = {u["id"]: u for u in data["users"]}
    floor = datetime.now(timezone.utc) - timedelta(days=6, hours=23)
    start = max(datetime.fromisoformat(CHALLENGE_START).astimezone(timezone.utc), floor).strftime("%Y-%m-%dT%H:%M:%SZ")

    def chunks(users):
        out, cur = [], []
        for u in users:
            q = f"(from:{u['handle']} to:{u['handle']})"
            if cur and len(" OR ".join(cur + [q])) > 440:
                out.append(cur); cur = []
            cur.append(q)
        if cur:
            out.append(cur)
        return [" OR ".join(c) + " is:reply" for c in out]

    def run(query, since=None, start_time=None):
        params = {"query": query, "max_results": 100,
                  "tweet.fields": "created_at,referenced_tweets,in_reply_to_user_id,author_id"}
        if since:
            params["since_id"] = since
        if start_time:
            params["start_time"] = start_time
        n, newest, token = 0, None, None
        while True:
            if token:
                params["next_token"] = token
            res = api("/tweets/search/recent", params)
            for t in res.get("data", []):
                if newest is None or int(t["id"]) > int(newest):
                    newest = t["id"]
                u = by_id.get(t.get("author_id"))
                if not u or t.get("in_reply_to_user_id") != u["id"] or t["id"] in have:
                    continue
                if not counts(t, self_reply=True):
                    continue
                data["posts"].append({"id": t["id"], "handle": u["handle"], "created_at": t["created_at"],
                                      "text": t.get("text", ""), "kind": "thread"})
                have.add(t["id"]); n += 1
            token = res.get("meta", {}).get("next_token")
            if not token:
                return n, newest

    added = 0
    since = st.get("self_reply_since")
    known = [u for u in data["users"] if u["id"] in covered]
    new = [u for u in data["users"] if u["id"] not in covered]
    newest_all = since
    # すでに対象の人：前回の続きから
    if known and since:
        for q in chunks(known):
            n, nw = run(q, since=since)
            added += n
            if nw and (newest_all is None or int(nw) > int(newest_all)):
                newest_all = nw
    # 新しく対象になった人：企画開始日（最大7日前）からさかのぼる
    if new:
        for q in chunks(new):
            n, nw = run(q, start_time=start)
            added += n
            if nw and (newest_all is None or int(nw) > int(newest_all)):
                newest_all = nw
        covered |= {u["id"] for u in new}
        st["self_reply_users"] = sorted(covered)
    if newest_all:
        st["self_reply_since"] = newest_all
    return added


def main():
    if not TOKEN:
        sys.exit("X_BEARER_TOKEN が設定されていません（GitHub の Settings → Secrets に登録してください）")
    handles = load_handles()
    data = load_data()
    data["start"] = CHALLENGE_START
    try:
        refresh_users(data, handles)
        added = fetch_posts(data)
        print(f"参加者 {len(data['users'])}人 / 新しい投稿 {added}件")
        try:
            print(f"ツリー（自分へのリプ） {fetch_self_replies(data)}件")
        except RuntimeError as e:
            print("ツリーの取得に失敗しました（通常の投稿の取得には影響なし）:", e)
    except RateLimited as e:
        print("X API の回数制限に達したため、今回はここまでで保存します:", e)
    data["posts"].sort(key=lambda p: p["created_at"])
    data["updated_at"] = now_iso()
    with open(DATA, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
