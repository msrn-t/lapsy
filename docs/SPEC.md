# SPEC.md — Lapsy（IT資格学習支援アプリ）

このファイルは人間が記述する要件定義書です。
investigator・architect が参照して調査・設計を進めます。
曖昧な記述はブロッカーの原因になるため、各セクションを具体的に記述してください。

---

## 1. プロジェクト概要

本プロジェクトのプロジェクト名は **Lapsy（ラプシー）** とする。
名称は、ポモドーロタイマーの「ラップ（lap）」単位で学習を区切り積み重ねていくという中核コンセプトに由来する。

IT系資格の取得に向けた学習を支援するWebアプリケーションを構築する。
ユーザーは学習トピックを登録し、ポモドーロタイマーで学習に取り組むことで、その計測時間が自動的に該当トピックの学習時間として記録される。
記録された学習時間は累計・移動平均・ヒートマップとして可視化され、トピックに設定した期限日までのカウントダウンとあわせてダッシュボードに表示される。

利用形態はブラウザ経由でアクセスするWebアプリとし、VPSにホスティングする。
当面は招待制による複数ユーザー利用を想定する。

主な対象資格は JSTQB Foundation Level、AWS Certified Cloud Practitioner（CLF）、基本情報技術者試験（FE）などを想定するが、トピックは自由に登録できるため特定資格に依存しない。

---

## 2. 背景・目的

資格学習において、日々の学習時間や進捗を把握する手段が分散しており（タイマーアプリ、表計算ソフト、メモ等）、一元的に記録・振り返りができていない。

本システムにより、学習の「計測」「記録」「振り返り」「期限管理」を1つのアプリに統合する。
これにより、学習者は自身の学習量を可視化し、期限から逆算した行動判断を行えるようになることを目的とする。

---

## 3. ユーザー・ステークホルダー

| ユーザー種別 | 説明 | 主な操作 |
|---|---|---|
| 一般ユーザー | 招待を受けて登録した学習者 | ログイン・学習トピック管理・ポモドーロタイマー利用・学習記録の閲覧 |
| 管理者 | 管理者フラグを持つ一般ユーザー | 上記に加え、他ユーザーへの招待メール送信 |

- 管理者は他ユーザーの管理者フラグを付与・剥奪できる。ただし以下のガードを設ける。
  - 自分自身の管理者フラグは剥奪できない（自己降格不可）。
  - システム上で最後の管理者となるユーザーの管理者フラグは剥奪できない（管理者ゼロ状態を防止する）。
- 専用の管理画面は当面不要とし、管理者フラグの設定が可能であればよい（フラグ操作の手段はarchitect判断に委ねる）。

---

## 4. 機能要件

### Must（必須）

- [ ] 管理者は、メールアドレスを指定して招待メールを送信できる
- [ ] 既に登録済みのメールアドレスへは招待を送信できない（エラーを表示する）
- [ ] 同一メールアドレスに有効な招待（未受諾・期限内）が既に存在する場合は、重複して招待を送信できない。72時間の有効期限が切れた後は再招待できる
- [ ] 招待されたユーザーは、招待メール内のリンクからパスワードを設定して登録を完了できる
- [ ] ユーザーはメールアドレスとパスワードでログインできる
- [ ] ログイン失敗時はエラーメッセージを表示する
- [ ] ログアウトできる
- [ ] ユーザーは学習トピックを作成・編集・削除できる（個人ごとに管理される）
- [ ] 学習トピックは「タイトル（必須）」「詳細（任意）」「期限日（任意）」を持つ
- [ ] ユーザーはポモドーロタイマーを使用できる
- [ ] ポモドーロタイマーは繰り返し回数（ラップ数）をユーザーがカスタマイズできる
- [ ] 作業時間・休憩時間は一律ではなく、ラップごとに個別の長さを設定できる（例: 1ラップ目は作業25分/休憩5分、2ラップ目は作業50分/休憩10分）
- [ ] ラップの作業時間は60秒以上を必須とする（1分未満の completed 作業ブロックが記録時に除外されるのを防ぐため。詳細は §7.3）。休憩時間は0秒（休憩なし）を許容する
- [ ] ラップ設定（作業/休憩の組み合わせ）をプリセットとして保存し、次回以降に再利用できる
- [ ] ポモドーロタイマー使用時、対象の学習トピックを選択する
- [ ] 同時に進行できるポモドーロは1ユーザーにつき1つまでとする（詳細は §7.5）
- [ ] 学習時間は作業区間ごと（作業ブロック単位）に該当トピックへ自動記録される。完了した作業ブロックは「計画作業時間」を学習時間として記録する（実経過の壁時計時間ではない。詳細は §7）
- [ ] 作業ブロックを途中で中断した場合は、その時点までの実作業時間を「中断（aborted）」として記録する（破棄しない）
- [ ] 学習記録はステータス（completed / aborted）を保持し、累計・移動平均・ヒートマップの集計では両者を合算する
- [ ] ポモドーロのカウントはクライアント側で行い、サーバーには「開始時刻」と「ラップ構成のスナップショット」を保存する。ブラウザを閉じて再度開いた場合、サーバーの開始時刻・スナップショット・現在時刻から進行状態（何ラップ目の作業/休憩か・累計経過）を復元して表示を継続できる
- [ ] 経過時間・進行状態の計算はサーバー時刻を正とする（クライアント時計のズレ・改ざん対策）
- [ ] ダッシュボードでトピック別の累計学習時間を確認できる
- [ ] ダッシュボードで学習記録のヒートマップ（日別の学習量）を確認できる。集計単位はトピック横断の総学習量とする
- [ ] ダッシュボードで学習時間の移動平均グラフ（7日移動平均）を確認できる
- [ ] ダッシュボードで各トピックの期限日までのカウントダウン日数を確認できる
- [ ] ユーザーは学習トピックを手動でアーカイブできる
- [ ] アーカイブ済みトピックは通常のトピック一覧・トピック別累計の表示から除外され、別画面で閲覧できる（横断集計＝ヒートマップ・移動平均での扱いは §7.4 参照）
- [ ] アーカイブ済みトピックを通常状態へ復元できる

### Should（できれば）

- [ ] パスワードリセット機能を提供する
- [ ] ログイン状態を一定期間保持できる（保持期間はarchitect判断）
- [ ] 期限日を過ぎたトピックは「期限超過」として警告的に識別できる表示にする（自動アーカイブはせず、アーカイブの判断はユーザーに委ねる）
- [ ] 終了し忘れ対策として、開始から3時間が経過した進行中ランは自動的に aborted として確定する（3時間でキャップ。専用バッチを設けず遅延評価で実装可。詳細は §7.3）
- [ ] 開始直後の誤操作対策として、実作業時間が1分未満の作業ブロックは記録対象から除外する（詳細は §7.3）

### Could（余裕があれば）

- [ ] 管理者専用の管理画面（ユーザー一覧・フラグ操作のUI）
- [ ] 管理者以外も登録できる自由登録（セルフサインアップ＋メール認証）※Phase 2で実装

---

## 5. 非機能要件

| 項目 | 要件 |
|---|---|
| レスポンスタイム | 主要画面（ダッシュボード）の初期表示は2秒以内を目標とする |
| セキュリティ | パスワードは bcrypt 等の安全なアルゴリズムでハッシュ化して保存すること |
| セキュリティ | 招待トークン・パスワードリセットトークンには有効期限を設定すること（例: 招待72時間） |
| データ分離 | 学習トピック・学習記録はユーザー単位で分離し、他ユーザーのデータを参照できないこと |
| 対応ブラウザ | Chrome・Firefox・Safari の最新版 |
| レイアウト | Tailwind CSS によるレスポンシブ対応とし、スマートフォン・タブレット・PCで利用可能であること |
| 通信 | HTTPS による通信を必須とする（SSL証明書はLet's Encrypt想定） |
| 可用性 | 個人〜少人数利用のため厳密なSLAは設けないが、日中帯の安定稼働を目指す |

---

## 6. 技術的制約

- 使用言語: TypeScript
- フレームワーク: Next.js（フルスタック構成、App Router想定）
- データベース: PostgreSQL（複数ユーザーの同時書き込みに対応するため）
- ORM: Prisma
- スタイリング: Tailwind CSS（レスポンシブ対応を前提とする）
- 認証ライブラリ: NextAuth.js
- セッション管理: Database セッション戦略（NextAuth + Prisma Adapter）。セッション情報をDBで管理し、招待取り消し・強制ログアウト等の即時無効化に対応する（ただし NextAuth × DB セッションの実現性に既知の制約あり。§10 未決事項を参照）
- メール送信: Resend（招待メール・パスワードリセットに使用。開発時はテスト用ドメイン、本番はドメイン確定後に独自ドメインを認証）
- 初期管理者: Prisma の seed スクリプトで投入する。認証情報はハードコードせず環境変数（ADMIN_EMAIL / ADMIN_PASSWORD 等）から読み込み、パスワードはハッシュ化して保存する
- 実行環境: Ubuntu（VPS）
- Node.js: v22（安定版 / LTS）
- Webサーバー: Nginx（リバースプロキシ）
- プロセス管理: PM2 等を想定
- デプロイ先: VPS（セルフホスティング）
- ドメイン: 未定（SSL は Let's Encrypt を想定）

---

## 7. データモデル設計（確定事項）

ポモドーロの計測・記録に関する中核設計を以下に確定する。
本セクションは architect が ER 図・Prisma スキーマへ落とし込む際の決定事項とする。

### 7.1 エンティティ構成（2層モデル）

学習の「実行」と「記録」を別エンティティとして分離する。

- **StudySession（ラン）**: ライブタイマーの実行単位。マルチラップ1回分の進行中状態を表す永続実体。状態復元・1ユーザー1アクティブ制限・確定（完了／3時間キャップ中断）の対象。
- **StudyRecord（作業ブロック）**: 学習時間の確定記録。ラップの作業区間ごとに1レコードを生成する。累計・ヒートマップ・移動平均の集計は **StudyRecord のみ** を参照する。

集計を作業ブロック単位の事実に対して行うことで、日跨ぎランの日割り・中断の部分記録・トピック別累計がいずれも単純な集約クエリで成立する。進行中の実体（復元・3hスイープ・同時実行制限）と過去の事実（集計対象）を分離する意図。

#### StudySession（ラン）

| フィールド | 説明 |
|---|---|
| id | 主キー |
| userId | 所有ユーザー |
| topicId | 対象学習トピック |
| presetSnapshot | 開始時に凍結したラップ構成 `[{ workSec, breakSec }, ...]`（順序付き）。プリセットを後から編集・削除しても進行中ランは影響を受けない |
| startedAt | サーバー時刻による開始時刻。経過計算・状態復元の正とする |
| status | `running` / `completed` / `aborted` |
| endedAt | 完了・中断の確定時刻（nullable） |

#### StudyRecord（作業ブロック）

| フィールド | 説明 |
|---|---|
| id | 主キー |
| sessionId | 紐づく StudySession（FK） |
| userId | 集計フィルタ・データ分離用に非正規化保持 |
| topicId | トピック別累計用に非正規化保持 |
| lapIndex | ラン内のラップ番号 |
| plannedSeconds | そのラップの計画作業秒数 |
| countedSeconds | 集計が合算する値。completed のとき plannedSeconds、aborted のとき実作業秒数 |
| status | `completed` / `aborted` |
| startedAt / completedAt | その作業ブロックの実時刻（日次バケツの基準は completedAt） |

### 7.2 記録値のルール

- **completed の作業ブロックは計画値（plannedSeconds）を記録する。** 実経過の壁時計時間ではない（ブラウザを長時間放置・再openしても計画値で確定する）。
- **aborted の作業ブロックは中断時点までの実作業秒数を記録する。** 破棄しない。
- 学習時間として記録・集計するのは **作業区間のみ**。休憩区間は completed / aborted いずれも学習時間に含めない。
- 累計・移動平均・ヒートマップは status を問わず `countedSeconds` を合算する。

### 7.3 状態のライフサイクルとサーバー時刻

進行中はサーバーが `startedAt + presetSnapshot + サーバー現在時刻` から状態を導出するのみとし、作業↔休憩の遷移ごとの書き込みは行わない。クライアントに遷移を報告させないことで、サーバー時刻基準と改ざん対策を一貫させる。確定記録（StudyRecord）の生成（materialize）はランの確定時にまとめて行う。

**確定（materialize）の起点**: 各作業ブロックの StudyRecord 生成はランの確定時にまとめて行う。確定の判定は **`確定期限 = min(startedAt + ラン総時間, startedAt + 3時間)`** を基準とし、クライアントからの通知だけでなく、再open・ダッシュボード参照などアクセス時の遅延評価でも実行する（クライアント不在でも確定が漏れないようにする）。

1. **開始**: StudySession を `running` で作成（presetSnapshot を凍結）。`running` の二重作成はユニーク制約で拒否する。
2. **再open／参照時の評価**: サーバーが `startedAt + snapshot + サーバー現在時刻` から状態を判定する。
   - `現在 < 確定期限`（進行中）の場合: 「現在が何ラップ目の作業/休憩か」「累計経過」を導出して返すのみ（書き込みなし）。
   - `現在 ≥ 確定期限`（確定期限を経過済み）の場合: 下記 3 または 5 として materialize する（このとき書き込みが発生する）。
3. **完了**: クライアントがラン終端に到達した時点、または遅延評価で `現在 ≥ startedAt + ラン総時間`（かつ総時間 ≤ 3時間）を検知した時点で、全作業ブロックを completed（各 plannedSeconds）として StudyRecord に materialize し、StudySession を completed にする。**ブラウザを閉じたまま総時間が経過したランも、この経路で正しく completed として確定する**（aborted にはしない）。
4. **中断（ユーザー操作）**: 中断時刻をサーバーが受け取り、snapshot と突き合わせて「完了済みブロック = completed / plannedSeconds」「中断が当たった作業ブロック = aborted / 実作業秒数」を算出して materialize する。中断が休憩区間に当たった場合、直前の作業ブロックは既に completed 扱いとし部分記録は生じない。
5. **3時間キャップ中断**: ラン総時間が3時間を超える長大ランが、3時間経過時点でまだ作業中の場合に限り、`startedAt + 3時間` を中断点として step 4 と同じ要領で aborted を materialize する（終了し忘れ・異常放置の安全網）。**総時間が3時間以内のランは放置されても step 3 の完了として確定し、aborted にはしない**。専用バッチは設けず参照時の遅延評価で実装してよい。

materialize 時、`countedSeconds < 60`（1分未満）の作業ブロックは記録対象から除外する。これは実質的に aborted の部分ブロックのみが対象となる（completed は §4 の「ラップ作業時間 60 秒以上」制約により plannedSeconds が常に1分以上のため影響しない）。

### 7.4 集計と日境界

- 集計の日境界は **Asia/Tokyo** で固定する。
- トピック別累計 = `SUM(countedSeconds) GROUP BY topicId`
- ヒートマップ（日別総学習量・トピック横断）= `SUM(countedSeconds) GROUP BY date(completedAt, 'Asia/Tokyo')`
- 7日移動平均 = 上記日次系列を **学習ゼロの日も 0 として埋めた上で** 7日窓で算出する。データが7日に満たない期間は、存在する日数での部分平均を表示する。
- 1つの作業ブロックが日付をまたぐ稀なケース（例: 50分作業が 23:40〜00:30）は、MVP では分割せず **completedAt の日に丸ごと計上**する。
- **アーカイブの集計への影響**: アーカイブは「トピック一覧・トピック別累計の表示」にのみ影響する。横断集計（ヒートマップ・7日移動平均）はアーカイブ済みトピックの過去 StudyRecord も**含めて**集計し、過去日の学習量が欠落しないようにする。

### 7.5 制約・インデックス・データ分離

- `StudySession.status = running` は1ユーザーにつき1件のみ（部分ユニーク制約で担保）。新規開始時に既存の running があれば拒否または既存を abort 確定とする（挙動は architect 判断）。
- インデックス: `StudyRecord(userId, completedAt)`、`StudyRecord(userId, topicId)`。
- データ分離: 全クエリで認証セッション由来の userId をフィルタ条件とし、クライアント入力の id を信頼しない。StudyRecord に userId を非正規化保持するのは、このフィルタとアプリ層の防御を一貫させるため。
- トピック削除時の StudyRecord/StudySession の扱い（カスケード削除か履歴保持か）は別途要決定（§10 参照）。

### 7.6 Prisma スキーマ（ドラフト）

§7 の決定事項を反映した Prisma スキーマのドラフトを以下に示す。フィールド名・補助項目は実装時に調整可。認証関連モデル（Account / Session / VerificationToken）は §10「認証セッション戦略」の決定により増減する。

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum SessionStatus {
  running
  completed
  aborted
}

enum RecordStatus {
  completed
  aborted
}

enum InvitationStatus {
  pending
  accepted
}

model User {
  id            String    @id @default(cuid())
  email         String    @unique
  passwordHash  String                            // bcrypt 等でハッシュ化（§5）
  name          String?
  isAdmin       Boolean   @default(false)
  emailVerified DateTime?                          // NextAuth Adapter 用
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  topics              Topic[]
  presets             Preset[]
  studySessions       StudySession[]
  studyRecords        StudyRecord[]
  sentInvitations     Invitation[]         @relation("InvitedBy")
  passwordResetTokens PasswordResetToken[]

  // NextAuth Adapter 用（§10 の決定により構成変更の可能性あり）
  accounts Account[]
  sessions Session[]
}

model Invitation {
  id          String           @id @default(cuid())
  email       String
  token       String           @unique
  status      InvitationStatus @default(pending)
  expiresAt   DateTime                            // 発行から72時間（§5）
  acceptedAt  DateTime?
  invitedById String
  invitedBy   User             @relation("InvitedBy", fields: [invitedById], references: [id])
  createdAt   DateTime         @default(now())

  @@index([email])
  // 「同一メールへの有効な招待は1件まで」（§4）は status=pending の部分ユニークで担保。
  // Prisma 標準の @@unique は条件付きにできないため、マイグレーションで raw SQL を追加する:
  //   CREATE UNIQUE INDEX invitation_email_pending_unique
  //     ON "Invitation"(email) WHERE status = 'pending';
}

model PasswordResetToken {
  id        String    @id @default(cuid())
  token     String    @unique
  userId    String
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime  @default(now())

  @@index([userId])
}

model Topic {
  id          String    @id @default(cuid())
  userId      String
  user        User      @relation(fields: [userId], references: [id])
  title       String
  description String?
  deadline    DateTime?
  isArchived  Boolean   @default(false)
  archivedAt  DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  studySessions StudySession[]
  studyRecords  StudyRecord[]

  @@index([userId, isArchived])
  // 削除時の studySessions/studyRecords の扱いは §10 未決事項。
  // 方針確定までは onDelete を Restrict（既定）とし、記録のある物理削除を制限する想定。
}

model Preset {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  name      String
  config    Json                                  // [{ "workSec": 1500, "breakSec": 300 }, ...]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([userId])
}

model StudySession {
  id             String        @id @default(cuid())
  userId         String
  user           User          @relation(fields: [userId], references: [id])
  topicId        String
  topic          Topic         @relation(fields: [topicId], references: [id])
  presetSnapshot Json                              // 開始時に凍結した [{workSec, breakSec}, ...]
  startedAt      DateTime                          // サーバー時刻が正（§7.3）
  status         SessionStatus @default(running)
  endedAt        DateTime?
  createdAt      DateTime      @default(now())

  records StudyRecord[]

  @@index([userId, status])
  // 「1ユーザー1アクティブ」（§7.5）は status=running の部分ユニークで担保。
  // マイグレーションで raw SQL を追加する:
  //   CREATE UNIQUE INDEX studysession_user_running_unique
  //     ON "StudySession"("userId") WHERE status = 'running';
}

model StudyRecord {
  id             String       @id @default(cuid())
  sessionId      String
  session        StudySession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  userId         String                            // 集計フィルタ・データ分離用に非正規化（§7.5）
  user           User         @relation(fields: [userId], references: [id])
  topicId        String                            // トピック別累計用に非正規化
  topic          Topic        @relation(fields: [topicId], references: [id])
  lapIndex       Int
  plannedSeconds Int
  countedSeconds Int                               // completed=plannedSeconds / aborted=実作業秒数（§7.2）
  status         RecordStatus
  startedAt      DateTime
  completedAt    DateTime                          // 日次バケツの基準（Asia/Tokyo, §7.4）
  createdAt      DateTime     @default(now())

  @@index([userId, completedAt])
  @@index([userId, topicId])
}

// ── NextAuth (Auth.js) Prisma Adapter 用モデル ──
// §10「認証セッション戦略」の決定により、DB セッション戦略で Session を用いるか、
// JWT 戦略へ寄せて Session を省くか等、構成が変わる可能性がある。

model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String?
  access_token      String?
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String?
  session_state     String?
  user              User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
}
```

> 補足: 部分ユニークインデックス（`Invitation` の pending 重複防止・`StudySession` の running 1本制限）は Prisma スキーマ構文では表現できないため、`prisma migrate` 生成後のマイグレーション SQL に上記 `CREATE UNIQUE INDEX ... WHERE ...` を手動追記する。

---

## 8. スコープ外（明示的な除外事項）

- Slack連携（Phase 2以降で段階的に追加予定。MVPには含めない）
- 自由登録（セルフサインアップ）（Phase 2で実装。MVPは招待制のみ）
- 多言語対応（日本語のみ）
- モバイルネイティブアプリ（Webのみ。ただしレスポンシブ対応によりモバイルブラウザでの利用は想定する）
- 模擬問題・過去問の正答率記録、弱点トピック自動抽出
- 忘却曲線に基づく復習リマインダー・通知機能
- ユーザー間の学習時間ランキング・ソーシャル機能
- 学習計画の詳細管理（週次計画など。MVPはトピック＋期限日にとどめる）

---

## 9. 成功基準

- 招待 → 登録 → ログイン → ログアウトの一連の動作確認が完了していること
- 学習トピックのCRUDが正常に動作すること
- ポモドーロ完了時に、完了した作業ブロックの計画作業時間が正しくトピックへ記録され、中断時はその時点までの実作業時間が aborted として記録されること
- ダッシュボードの累計・移動平均・ヒートマップ・カウントダウンが正しく表示されること
- ユーザー間のデータ分離が担保されていること（他ユーザーのデータが見えないこと）
- 主要ロジック（時間集計・トークン検証等）に対する単体テストが整備されていること
- コードレビューが承認されていること

---

## 10. 未決事項（Open Questions）

> ポモドーロ計測のデータモデルは §7 で確定済み。残る検討事項は以下。

- [ ] **認証セッション戦略の確定**: NextAuth.js（Auth.js）の Credentials プロバイダは JWT セッション戦略でのみ動作し、Database セッション戦略は公式に非サポート（`UnsupportedStrategy` エラー）。§6 の「即時無効化のための DB セッション」と正面衝突する。(a) DB セッションを Credentials ログイン時に手動生成する独自実装で回避 / (b) JWT 戦略＋ユーザー単位の失効バージョン照合で即時無効化を代替 / (c) Lucia 等 DB セッション前提のライブラリへ変更、のいずれかを architect が判断する
- [ ] **トピック削除時のデータ整合**: トピックを物理削除した際、紐づく StudyRecord/StudySession をカスケード削除すると横断ヒートマップ・累計の過去履歴が欠落する。物理削除を制限する／論理削除にする／記録は保持する等の方針を決定する（アーカイブ機能とは別の論点）
- [ ] ドメインが未定。SSL（Let's Encrypt）に加え、招待・パスワードリセットメールの到達性（SPF/DKIM/DMARC 設定）も独自ドメイン確定に依存する。確定までは開発用にIPアドレス直アクセス／テスト用ドメインで進行可能

---

## 11. 参考資料

- Figmaデザイン: （未作成 / URLを記入）
- ER図 / スキーマ: §7.6 に Prisma スキーマのドラフトを記載（ER図は設計フェーズで補完）
- ポモドーロ・テクニック参考: 作業25分／休憩5分が一般的なデフォルト（本アプリではカスタマイズ可能）
