# Lapsy ローカル開発セットアップ

Lapsy アプリ（Next.js + TypeScript + Tailwind CSS + Prisma + PostgreSQL）をローカルで起動する手順。
基盤チケット LAP-001 で整備。設計の正本は `docs/SPEC.md` / `docs/designs/LAP-001.md`。

> 注: リポジトリ直下の `README.md` は Kenesis Loop Kit（運用フレームワーク）のものです。本ファイルが Lapsy アプリの起動手順です。

## 前提

- **Node.js v22**（SPEC §6 で必須）。`.nvmrc` に `22` を記載済み。
  ```bash
  nvm install 22   # 未導入の場合
  nvm use          # .nvmrc を読んで v22 を有効化
  node -v          # v22.x であることを確認
  ```
  package.json の `engines.node` が `>=22` を要求します。
- **Docker + Docker Compose**（PostgreSQL をコンテナで起動するため）。

## 1. 依存のインストール

```bash
nvm use            # Node v22
npm install
```

導入されるのは next(15) / react(19) / typescript(5) / prisma(6) / @prisma/client(6) / tailwindcss(4) と、
認証基盤（LAP-002）で追加した next-auth(v5 beta) / bcryptjs、テスト/seed 用の vitest / tsx など。
`resend`（メール送信）は後続チケット（招待 LAP-003 / リセット LAP-005）で導入します。

## 2. 環境変数

`.env.example` をコピーして `.env` を作成します（`.env` は `.gitignore` 対象。コミットしない）。

```bash
cp .env.example .env
```

`DATABASE_URL` と `POSTGRES_*` は docker-compose のデフォルト（ユーザー/パスワード/DB = `lapsy`）と一致しています。

認証基盤（LAP-002）で以下も `.env` に設定します（実値は `.env` のみ。コミット禁止）:

```bash
# Auth.js v5。JWT 署名鍵。必須。生成例:
openssl rand -base64 32      # 出力を AUTH_SECRET="..." に貼る
# AUTH_URL="http://localhost:3000"   # 任意（v5 は自動推論可・本番で明示推奨）

# 初期管理者 seed 用（ハードコード禁止・未設定だと seed はエラー終了）
# ADMIN_EMAIL="admin@example.com"
# ADMIN_PASSWORD="<任意の強いパスワード>"
```

## 3. データベース起動（PostgreSQL）

```bash
npm run db:up         # docker compose up -d（postgres:16 を 5432 で起動）
# 停止: npm run db:down
# データごと破棄: docker compose down -v
```

healthcheck（`pg_isready`）が通るまで数秒かかります。

## 4. マイグレーション適用

初期マイグレーション（`prisma/migrations/<ts>_init`）には全テーブル + 2 つの部分ユニークインデックスが含まれます。
認証基盤（LAP-002）で **新規マイグレーション 1 本**（`<ts>_auth_session_strategy`）を追加しています。
内容は Auth.js Adapter 用 3 テーブル（Account / Session / VerificationToken）の DROP と `User.sessionVersion` 列追加です。

> **既存の `_init` マイグレーションは編集しません**（checksum drift を避けるため）。スキーマ変更は常に新規マイグレーションで行います。

```bash
npx prisma migrate dev      # または npm run prisma:migrate（未適用分をすべて適用）
npx prisma generate         # クライアント生成（migrate dev でも自動実行される）
npx prisma validate         # スキーマ検証（npm run prisma:validate）
```

部分インデックスが作成されたことの確認:

```bash
docker compose exec db psql -U lapsy -d lapsy -c '\d "Invitation"'
docker compose exec db psql -U lapsy -d lapsy -c '\d "StudySession"'
# invitation_email_pending_unique / studysession_user_running_unique が表示されればOK
```

## 5. 開発サーバ起動

```bash
npm run dev          # next dev（http://localhost:3000）
```

`/` が Tailwind 適用済みの最小ページ（HTTP 200）を返します。

## 6. 認証・初期管理者（LAP-002）

セッション戦略は **Auth.js v5 Credentials + JWT 戦略・Adapter なし**。即時無効化（SPEC §6）は
`User.sessionVersion` を JWT へ焼き込み、`jwt` callback で DB の最新版と照合して代替します。
DB アクセスを伴う失効照合は middleware（edge）ではなく node 側の `auth()` で行う分割構成です。

**初期管理者の投入（冪等）:**

```bash
# 事前に .env へ AUTH_SECRET / ADMIN_EMAIL / ADMIN_PASSWORD を設定しておく
npm run db:seed       # prisma db seed → tsx prisma/seed.ts（upsert で冪等。再実行しても重複作成しない）
```

パスワードは bcryptjs（`$2b$`）でハッシュ化して保存されます。`ADMIN_EMAIL` / `ADMIN_PASSWORD`
未設定時は seed がエラー終了します（平文・空ハッシュの作成防止）。

**ログイン確認:**

```bash
npm run dev
# ブラウザで http://localhost:3000/dashboard を開く → 未認証なら /login へリダイレクト
# /login で ADMIN_EMAIL / ADMIN_PASSWORD を入力 → /dashboard へ遷移
# 誤った資格情報ではエラーメッセージが表示される
# ダッシュボードの「ログアウト」で /login へ戻り、保護ルートに戻れないことを確認
```

**強制ログアウト（失効）の仕組み:** 後続 LAP-003/004 が `src/lib/auth-revocation.ts` の
`bumpSessionVersion(userId)` を呼ぶと対象ユーザーの `sessionVersion` が増え、既存 JWT は
次回アクセスの照合で弾かれます（cookie 期限前でも無効化相当）。本チケットでは関数定義のみ提供。

## その他のスクリプト

| コマンド | 内容 |
|---|---|
| `npm run build` | 本番ビルド（next build） |
| `npm run start` | 本番サーバ起動（next start） |
| `npm run typecheck` | 型チェック（tsc --noEmit） |
| `npm run prisma:validate` | Prisma スキーマ検証 |
| `npm run prisma:migrate` | マイグレーション適用（dev） |
| `npm run prisma:generate` | Prisma Client 生成 |
| `npm run db:seed` | 初期管理者 seed（prisma db seed・冪等） |
| `npm run test` | ユニットテスト（vitest run） |
| `npm run test:watch` | テストの watch 実行 |

---

## 部分ユニークインデックスの運用（重要）

Prisma 標準構文では「条件付きユニーク」を表現できないため、以下 2 つは初期マイグレーションの
`migration.sql` 末尾に **raw SQL を手動追記** しています（SPEC §7.6 補足 / 設計書 §4・§7）。

```sql
CREATE UNIQUE INDEX "invitation_email_pending_unique"  ON "Invitation"("email")  WHERE "status" = 'pending';
CREATE UNIQUE INDEX "studysession_user_running_unique" ON "StudySession"("userId") WHERE "status" = 'running';
```

意味:
- `invitation_email_pending_unique`: 同一メールへの有効な招待（pending）は1件まで（SPEC §4）。
- `studysession_user_running_unique`: 1ユーザーにつき進行中ラン（running）は1件まで（SPEC §7.5）。

**喪失させないための運用ルール:**

1. **適用済みマイグレーションは編集しない。** 追記した raw SQL は適用済みマイグレーション
   ファイルの一部であり、Prisma は適用済みマイグレーションを再生成・上書きしません。よって
   後続の `migrate dev` でも保持されます。
2. **raw SQL の追記は「未適用」のマイグレーションに対してのみ行う。** 手順は `--create-only`
   による 2 段階:
   ```bash
   npx prisma migrate dev --create-only --name <name>   # 生成のみ（未適用）
   #   prisma/migrations/<ts>_<name>/migration.sql 末尾に CREATE UNIQUE INDEX ... WHERE ... を追記
   npx prisma migrate dev                                # 適用
   ```
3. Prisma は部分インデックスを管理対象として追跡しないため、スキーマ変更時に自動 DROP される
   ことはありません。ただし将来テーブル定義を大きく作り直す場合は、新規マイグレーションへ
   同等の `CREATE UNIQUE INDEX ... WHERE ...` を再追記してください。

## ロールバック / DB リセット（開発環境）

```bash
git log --oneline
git revert <コミットハッシュ>        # 履歴を保持して取り消し

docker compose down -v               # ローカル DB をボリュームごと破棄
docker compose up -d && npx prisma migrate dev   # 再構築
```
