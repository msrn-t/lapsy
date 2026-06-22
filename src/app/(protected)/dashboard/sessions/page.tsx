import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import {
  validatePresetInput,
  parsePresetConfig,
  MAX_LAPS,
  type LapConfig,
  type PresetValidationReason,
} from "@/lib/preset";
import { deriveSessionState } from "@/lib/session";
import { materializeIfDue, materializeOnAbort } from "@/lib/materialize";
import { collectLaps } from "../presets/_form";
import { LapRows } from "../presets/_lap-rows";
import { SessionTimer } from "./_timer";

// ポモドーロ実行（ラン）の開始・進行中表示・中断（LAP-009 §3 / §4）。
// 認証・データ分離は二層: (1) auth.config の authorized で /dashboard 配下をログイン必須に保護、
// (2) ページ・各 server action 冒頭で requireUserId()（未認証は /login へ）。
// 全クエリは requireUserId() 由来 userId でフィルタする（§7.5）。
// 開始は StudySession を running で作成し presetSnapshot（LapConfig[] の値コピー）を凍結する（§3-1）。
// 1ユーザー1アクティブは partial unique index studysession_user_running_unique（P2002）を最終権威に拒否（§3-4）。
// 進行状態の正はサーバー（deriveSessionState({ startedAt(DB), now: new Date() })）。再 open は再導出で復元（§3-5）。
// 中断は status=aborted + endedAt=サーバー時刻 の UPDATE まで。StudyRecord の materialize は LAP-010（§3-3）。

type ResultKind =
  | "started"
  | "aborted"
  | "materialized"
  | "already_running"
  | "topic_not_found"
  | "preset_not_found"
  | "empty_config"
  | "lap_work_too_short"
  | "lap_work_too_long"
  | "break_negative"
  | "break_too_long"
  | "too_many_laps"
  | "invalid_number"
  | "not_found";

const SUCCESS_KINDS: ReadonlySet<ResultKind> = new Set<ResultKind>([
  "started",
  "aborted",
  "materialized",
]);

const ERROR_KINDS: ReadonlyArray<ResultKind> = [
  "already_running",
  "topic_not_found",
  "preset_not_found",
  "empty_config",
  "lap_work_too_short",
  "lap_work_too_long",
  "break_negative",
  "break_too_long",
  "too_many_laps",
  "invalid_number",
  "not_found",
];

function isResultKind(value: string): value is ResultKind {
  return (
    SUCCESS_KINDS.has(value as ResultKind) ||
    ERROR_KINDS.includes(value as ResultKind)
  );
}

// validatePresetInput の reason をセッション開始の ResultKind へ写像する（§4・手入力経路）。
// 開始フォームには name 入力が無くダミー "_" を渡すため name_required/name_too_long は構造上発生しない。
// 万一発生した場合は empty_config（ラップ未設定相当）へフォールバックして型を網羅する。
function lapValidationToResult(reason: PresetValidationReason): ResultKind {
  switch (reason) {
    case "name_required":
    case "name_too_long":
      return "empty_config"; // 発生し得ない経路。フォールバック。
    case "empty_config":
    case "too_many_laps":
    case "lap_work_too_short":
    case "lap_work_too_long":
    case "break_negative":
    case "break_too_long":
    case "invalid_number":
      return reason;
  }
}

// config を「全ラップの合計作業/休憩」の要約文字列にする（開始フォームのプリセット選択肢用）。
function summarizeConfig(config: LapConfig[]): string {
  if (config.length === 0) return "（設定なし）";
  return config
    .map((c, i) => `${i + 1}: 作業${c.workSec}秒/休憩${c.breakSec}秒`)
    .join("、");
}

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string }>;
}) {
  // ページ表示も認証必須（未認証は /login へ）。
  const userId = await requireUserId();
  const { result } = await searchParams;

  // 進行中ランを取得（データ分離・§3-5）。@@index([userId,status]) が効く。
  // userId/topicId は遅延評価 materialize（materializeIfDue）に必要なため select する（§3-5 A）。
  const running = await prisma.studySession.findFirst({
    where: { userId, status: "running" },
    select: {
      id: true,
      userId: true,
      topicId: true,
      presetSnapshot: true,
      startedAt: true,
    },
  });

  // 再 open / 参照の遅延評価（§3-5 A・§7.3 step3/step5）。確定期限を過ぎていれば materialize し、
  // running は確定済み（completed/aborted）になるため開始フォームへ戻す（?result=materialized）。
  // due:false（進行中）なら従来の RunningView 表示へ続行する。
  if (running) {
    const outcome = await materializeIfDue(running, new Date());
    if (outcome.due) {
      revalidatePath("/dashboard/sessions");
      redirect("/dashboard/sessions?result=materialized");
    }
  }

  const isRunning = !!running;

  return (
    <div className="flex flex-col gap-6">
      {/* WF chip タブ（準備 / 実行中・装飾）。実体は running 有無の分岐（§3.2 U3・クリック遷移なし）。 */}
      <div className="flex items-center gap-2">
        <span
          className={
            isRunning
              ? "inline-flex items-center rounded-full border border-line-2 bg-fill px-3 py-1.5 text-[11px] text-ink"
              : "inline-flex items-center rounded-full border border-line-strong bg-nav-active px-3 py-1.5 text-[11px] font-bold text-ink"
          }
        >
          準備
        </span>
        <span
          className={
            isRunning
              ? "inline-flex items-center rounded-full border border-line-strong bg-nav-active px-3 py-1.5 text-[11px] font-bold text-ink"
              : "inline-flex items-center rounded-full border border-line-2 bg-fill px-3 py-1.5 text-[11px] text-ink"
          }
        >
          実行中
        </span>
        {!isRunning ? (
          <span className="ml-auto self-center text-[11px] text-ink-dim">
            同時に進行できるランは1つまで
          </span>
        ) : null}
      </div>

      {result && isResultKind(result) ? <ResultBanner kind={result} /> : null}

      {running ? (
        <RunningView running={running} />
      ) : (
        <StartFormView userId={userId} />
      )}
    </div>
  );
}

// 進行中ランの表示（§3-5）。JSONB は信頼せず parsePresetConfig で narrowing し、
// サーバー時刻基準で初期状態を導出して client component（SessionTimer）へ渡す。
function RunningView({
  running,
}: {
  running: {
    id: string;
    topicId: string;
    presetSnapshot: Prisma.JsonValue;
    startedAt: Date;
  };
}) {
  const snapshot = parsePresetConfig(running.presetSnapshot); // JSONB を信頼しない（§3-1）
  const state = deriveSessionState({
    snapshot,
    startedAt: running.startedAt,
    now: new Date(), // サーバー現在時刻が正（§7.3）
  });

  return (
    <div className="mx-auto flex w-full max-w-[420px] flex-col gap-4">
      {/* WF 07 実行モード: 中央カードに timer-ring / prog / run-meta。中断ボタンも内包。 */}
      <SessionTimer
        initial={state}
        startedAt={running.startedAt.toISOString()}
        snapshot={snapshot}
        abortAction={abortSession}
        sessionId={running.id}
      />

      <p className="text-center text-[11px] text-ink-dim">
        ※ 進行状態はサーバー時刻を正とします。ブラウザを閉じて再度開いても進行は復元されます。
      </p>
    </div>
  );
}

// 開始フォーム（§3-1）。トピック選択 + プリセット選択（presetId）or 手入力ラップ（LapRows 再利用）。
async function StartFormView({ userId }: { userId: string }) {
  const [topics, presets] = await Promise.all([
    prisma.topic.findMany({
      where: { userId, isArchived: false }, // データ分離 + アーカイブ除外
      select: { id: true, title: true },
      orderBy: [{ createdAt: "desc" }],
    }),
    prisma.preset.findMany({
      where: { userId },
      select: { id: true, name: true, config: true },
      orderBy: [{ createdAt: "desc" }],
    }),
  ]);

  if (topics.length === 0) {
    return (
      <p className="rounded-card border border-dashed border-line-2 px-6 py-8 text-center text-xs leading-7 text-ink-dim">
        対象の学習トピックがありません。先に
        <a
          href="/dashboard/topics"
          className="mx-1 text-ink underline underline-offset-2"
        >
          トピック
        </a>
        を作成してください。
      </p>
    );
  }

  // WF 07 準備モード: cards c2（左=トピック/プリセット選択、右=ラップ構成）+ 下部に開始ボタン。
  // chip 型プリセット選択は装飾のみで、実体は <select name="presetId"> を維持（§4-4・name 不変）。
  return (
    <form action={startSession} className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4 rounded-card border border-line bg-card p-6">
          <div>
            <p className="mb-2 font-[family-name:var(--font-fredoka)] text-xs font-medium uppercase tracking-wide text-ink-dim">
              対象トピックを選択
            </p>
            <select
              name="topicId"
              required
              className="min-h-[44px] w-full rounded-ctl border border-line-2 bg-fill px-3 text-sm"
            >
              {topics.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <p className="mb-2 font-[family-name:var(--font-fredoka)] text-xs font-medium uppercase tracking-wide text-ink-dim">
              プリセットを選択（任意）
            </p>
            <select
              name="presetId"
              className="min-h-[44px] w-full rounded-ctl border border-line-2 bg-fill px-3 text-sm"
            >
              <option value="">（プリセットを使わず下のラップを手入力）</option>
              {presets.map((p) => {
                const config = parsePresetConfig(p.config);
                return (
                  <option key={p.id} value={p.id}>
                    {p.name}（{summarizeConfig(config)}）
                  </option>
                );
              })}
            </select>
            <p className="mt-1.5 text-[11px] text-ink-dim">
              プリセットを選ぶと下のラップ手入力は無視されます。
            </p>
          </div>
        </div>

        <fieldset className="flex flex-col gap-2 rounded-card border border-line bg-card p-6">
          <legend className="font-[family-name:var(--font-fredoka)] text-xs font-medium uppercase tracking-wide text-ink-dim">
            ラップ構成（プリセット未選択時・作業/休憩を分で入力）
          </legend>
          <p className="text-[11px] text-ink-dim">
            作業時間は1分以上、休憩時間は0分以上。最低1ラップ・最大{MAX_LAPS}
            ラップ。
          </p>
          <LapRows />
        </fieldset>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          className="inline-flex min-h-[46px] items-center justify-center rounded-ctl bg-btn px-6 text-btn-ink"
        >
          ▶ 開始
        </button>
        <span className="text-[11px] text-ink-dim">
          作業のみ計上・休憩は学習時間に含めません（§4）
        </span>
      </div>
    </form>
  );
}

// 開始（server action・§3-1 / §3-4）。認証はセッション由来 userId で行い、クライアント入力を信頼しない。
async function startSession(formData: FormData) {
  "use server";

  const userId = await requireUserId();

  const back = (kind: ResultKind) =>
    redirect(`/dashboard/sessions?result=${kind}`);

  const topicId = String(formData.get("topicId") ?? "");
  const presetId = String(formData.get("presetId") ?? "");

  // トピック検証（データ分離・無ければ DB に触れず終了）。
  const topic = await prisma.topic.findFirst({
    where: { id: topicId, userId },
    select: { id: true },
  });
  if (!topic) {
    back("topic_not_found");
    return;
  }

  // snapshot の確定（§3-1）。最終的に正規化済み LapConfig[] に統一する。
  let snapshot: LapConfig[];
  if (presetId.length > 0) {
    // (a) 保存済みプリセット選択。
    const preset = await prisma.preset.findFirst({
      where: { id: presetId, userId },
      select: { config: true },
    });
    if (!preset) {
      back("preset_not_found");
      return;
    }
    const config = parsePresetConfig(preset.config); // JSONB を信頼しない（§3-1）
    if (config.length === 0) {
      back("empty_config");
      return;
    }
    snapshot = config;
  } else {
    // (b) 手入力ラップ（LAP-008 の純関数・入力 UI を共有・重複実装しない）。
    const validation = validatePresetInput({
      name: "_", // 開始フォームに名前は無いためダミー（config のみ使う）。
      laps: collectLaps(formData),
    });
    if (!validation.ok) {
      // 開始フォームに name 入力は無くダミー "_" を渡すため name_required/name_too_long は
      // 構造上発生しない。型網羅のため lapValidationToResult で ResultKind へ写像する（§4・ResultKind 一覧）。
      back(lapValidationToResult(validation.reason));
      return;
    }
    snapshot = validation.value.config;
  }

  // running 二重作成のプリチェック（UX 早期リターン・§3-4）。
  const existing = await prisma.studySession.findFirst({
    where: { userId, status: "running" },
    select: { id: true },
  });
  if (existing) {
    back("already_running");
    return;
  }

  // 作成（DB 最終権威で TOCTOU 対策・§3-4）。startedAt はサーバー時刻（§7.3）。
  try {
    await prisma.studySession.create({
      data: {
        userId,
        topicId,
        presetSnapshot: snapshot, // 値コピー（FK/参照は持たせない・§3-1）
        startedAt: new Date(),
        status: "running",
      },
    });
  } catch (e) {
    // プリチェックと create の間に並行生成された running は partial unique index で P2002。
    // DB を最終権威に already_running へフォールバックする（§3-4）。
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      back("already_running");
      return;
    }
    throw e;
  }

  revalidatePath("/dashboard/sessions");
  back("started");
}

// 中断（server action・LAP-010 §3-5 B）。status:"running" のみ対象に、cutoff=abortedAt（サーバー時刻）で
// materialize（status 遷移 + StudyRecord 生成）へ昇格する。中断時刻はクライアントから受け取らない（改ざん対策）。
// 完了済みブロック=completed/中断 work=aborted(実作業秒)を materialize し、中断が休憩区間/境界なら
// 直前 work=completed・部分記録なし（§7.3 step4）。targetStatus は materialize 結果で決まる。
async function abortSession(formData: FormData) {
  "use server";

  const userId = await requireUserId();
  const id = String(formData.get("id") ?? "");

  const back = (kind: ResultKind) =>
    redirect(`/dashboard/sessions?result=${kind}`);

  // running のみ取得（データ分離・不在/他人/既確定は session 無しで一様化）。
  const session = await prisma.studySession.findFirst({
    where: { id, userId, status: "running" },
    select: {
      id: true,
      userId: true,
      topicId: true,
      presetSnapshot: true,
      startedAt: true,
    },
  });
  if (!session) {
    back("not_found"); // 不在・他人・既に確定済みを一様化。
    return;
  }

  // cutoff=サーバー受信時刻（改ざん対策）。$transaction + status guard で冪等に materialize（§3-3/§3-5 B）。
  const outcome = await materializeOnAbort(session, new Date());
  if (!outcome.materialized) {
    back("not_found"); // 並行で先に確定された（敗者・count===0）。
    return;
  }

  revalidatePath("/dashboard/sessions");
  back("aborted");
}

function ResultBanner({ kind }: { kind: ResultKind }) {
  const ok = SUCCESS_KINDS.has(kind);
  const messages: Record<ResultKind, string> = {
    started: "ポモドーロを開始しました。",
    aborted: "ポモドーロを中断しました。",
    materialized: "学習記録を確定しました。",
    already_running:
      "進行中のランがあります。中断または完了してから新しく開始してください。",
    topic_not_found: "対象のトピックが見つかりませんでした。",
    preset_not_found: "対象のプリセットが見つかりませんでした。",
    empty_config: "ラップを最低1つ設定してください。",
    lap_work_too_short: "ラップの作業時間は1分以上に設定してください。",
    lap_work_too_long: "設定時間が長すぎます。",
    break_negative: "休憩時間に負の値は設定できません。",
    break_too_long: "設定時間が長すぎます。",
    too_many_laps: "ラップ数が多すぎます（上限 20）。",
    invalid_number: "作業時間・休憩時間は整数（分）で入力してください。",
    not_found:
      "中断対象のランが見つかりませんでした（既に終了している可能性があります）。",
  };

  return (
    <p
      role="alert"
      className={
        ok
          ? "rounded-ctl border border-line bg-panel px-3 py-2.5 text-xs text-ink"
          : "flex gap-2 rounded-ctl border border-dashed border-error px-3 py-2.5 text-xs text-error"
      }
    >
      {messages[kind]}
    </p>
  );
}
