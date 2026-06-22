// 学習トピックの純ロジック（LAP-006 §3-3 / §4）。
// DB に非依存。入力検証・正規化（validateTopicInput）と削除可否判定
// （evaluateTopicDeletion）をここに集約し、server action（page.tsx）は
// これらを組み合わせる薄い層にする。これにより DB に触れずに単体テストできる（§9）。
//
// 削除整合の「正」は DB の FK Restrict（StudyRecord/StudySession.topicId→Topic）。
// 本ファイルの evaluateTopicDeletion は早期拒否と案内文分岐のための UX 層に過ぎない（§3-4）。

/** タイトルの最大文字数（SPEC §4/§7 に明示が無いため 200 を採用・テストで固定・§4 注記）。 */
export const MAX_TITLE_LENGTH = 200;

export type TopicInput = {
  title: string;
  description?: string | null;
  deadline?: string | null; // フォーム由来の文字列（"" は未指定）
};

export type NormalizedTopic = {
  title: string;
  description: string | null;
  deadline: Date | null;
};

export type TopicValidationResult =
  | { ok: true; value: NormalizedTopic }
  | {
      ok: false;
      reason: "title_required" | "title_too_long" | "invalid_deadline";
    };

/**
 * トピック入力を検証・正規化する純関数（§3-3 / §4-A,B）。
 * 失敗時は理由コードを返し DB へは渡さない。成功時は DB にそのまま書ける正規化値を返す。
 *
 * 判定・正規化:
 *   - title: trim 後 0 文字 → title_required、MAX_TITLE_LENGTH 超過 → title_too_long
 *   - description: trim、空文字（trim 後 0 文字）は null へ正規化
 *   - deadline: 空文字/未指定は null、文字列はパース可否を検証し不正なら invalid_deadline
 */
export function validateTopicInput(input: TopicInput): TopicValidationResult {
  const title = input.title.trim();
  if (title.length === 0) {
    return { ok: false, reason: "title_required" };
  }
  if (title.length > MAX_TITLE_LENGTH) {
    return { ok: false, reason: "title_too_long" };
  }

  // description: trim し、空なら null へ正規化。
  const descRaw = input.description ?? "";
  const descTrimmed = descRaw.trim();
  const description = descTrimmed.length === 0 ? null : descTrimmed;

  // deadline: 未指定/空文字は null。文字列はパース可否を検証する。
  const deadlineRaw = input.deadline ?? "";
  const deadlineTrimmed = deadlineRaw.trim();
  let deadline: Date | null = null;
  if (deadlineTrimmed.length > 0) {
    const parsed = new Date(deadlineTrimmed);
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false, reason: "invalid_deadline" };
    }
    deadline = parsed;
  }

  return { ok: true, value: { title, description, deadline } };
}

export type TopicDeletionVerdict =
  | { ok: true }
  | { ok: false; reason: "running" | "has_records" };

/**
 * トピック削除の可否を判定する純関数（§3-4 / §3-5）。
 * DB から数えた件数（userId+topicId でフィルタ済み）を入力として受け取る。
 *
 * 判定順（running を最優先・§3-5）:
 *   1. running ランがある → running（ラン終了を先に促す。記録ありより具体的な案内）
 *   2. StudyRecord または StudySession がある → has_records（アーカイブ LAP-007 へ誘導）
 *   3. いずれも無い → ok（記録なしトピックのみ物理削除を許可）
 *
 * 最終的な整合の「正」は DB の FK Restrict。本関数は UX 層の早期拒否（§3-4）。
 */
export function evaluateTopicDeletion(input: {
  runningSessionCount: number; // userId+topicId の status=running な StudySession 件数
  studyRecordCount: number; // userId+topicId の StudyRecord 件数
  studySessionCount: number; // userId+topicId の StudySession 件数（running 以外も含む）
}): TopicDeletionVerdict {
  // 1. running を最優先で判定。
  if (input.runningSessionCount > 0) {
    return { ok: false, reason: "running" };
  }
  // 2. 記録（StudyRecord / StudySession いずれか）があれば削除不可。
  if (input.studyRecordCount > 0 || input.studySessionCount > 0) {
    return { ok: false, reason: "has_records" };
  }
  // 3. 記録なし → 物理削除を許可。
  return { ok: true };
}

// --- アーカイブ／復元の mutation 生成（LAP-007 §3-4 / §9）。 ---
// アーカイブ／復元は DB の UPDATE のみ（StudyRecord/StudySession は物理削除しない・§7.4）。
// data 生成をここに純関数化し、不変条件 isArchived===true ⟺ archivedAt!=null を一点に集約する。

export type ArchiveMutation = { isArchived: true; archivedAt: Date };
export type RestoreMutation = { isArchived: false; archivedAt: null };

/**
 * アーカイブ時の更新 data を生成する純関数（§3-4 / §3-5）。
 * archivedAt に現在時刻（引数 now）を設定する。now を引数で受け取り、
 * テストで固定値を渡せるようにする（時刻非依存テスト）。
 */
export function computeArchiveMutation(now: Date): ArchiveMutation {
  return { isArchived: true, archivedAt: now };
}

/**
 * 復元時の更新 data を生成する純関数（§3-4 / §3-5）。
 * archivedAt を null クリアする（状態を素直に表現・不変条件を保つ）。
 */
export function computeRestoreMutation(): RestoreMutation {
  return { isArchived: false, archivedAt: null };
}
