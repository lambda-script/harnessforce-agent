// serverやIssueの提供元の利用者が書いた文字列を、端末へ出す前に通す。端末の制御文字（C0、DEL、C1）と、
// 表示の向きを変える文字（Bidi_Control）を取り除き、他の文字（日本語など）はそのまま出す。例: "a\u001b[2Kb\u202e" → "a[2Kb"
const UNPRINTABLE = /[\p{Cc}\p{Bidi_Control}]/gu;

export const printable = (text: string) => text.replace(UNPRINTABLE, "");
