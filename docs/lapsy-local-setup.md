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

導入されるのは next(15) / react(19) / typescript(5) / prisma(6) / @prisma/client(6) / tailwindcss(4) など。
`next-auth` / `resend` / `bcrypt` は後続チケットで導入するため基盤段階では含まれません。

## 2. 環境変数

`.env.example` をコピーして `.env` を作成します（`.env` は `.gitignore` 対象。コミットしない）。

```bash
cp .env.example .env
```

`DATABASE_URL` と `POSTGRES_*` は docker-compose のデフォルト（ユーザー/パスワード/DB = `lapsy`）と一致しています。

## 3. データベース起動（PostgreSQL）

```bash
npm run db:up         # docker compose up -d（postgres:16 を 5432 で起動）
# 停止: npm run db:down
# データごと破棄: docker compose down -v
```

healthcheck（`pg_isready`）が通るまで数秒かかります。

## 4. マイグレーション適用

初期マイグレーション（`prisma/migrations/<ts>_init`）には全テーブル + 2 つの部分ユニークインデックスが含まれます。

```bash
npx prisma migrate dev      # または npm run prisma:migrate
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

## その他のスクリプト

| コマンド | 内容 |
|---|---|
| `npm run build` | 本番ビルド（next build） |
| `npm run start` | 本番サーバ起動（next start） |
| `npm run typecheck` | 型チェック（tsc --noEmit） |
| `npm run prisma:validate` | Prisma スキーマ検証 |
| `npm run prisma:migrate` | マイグレーション適用（dev） |
| `npm run prisma:generate` | Prisma Client 生成 |

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
