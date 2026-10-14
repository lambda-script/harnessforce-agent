export const METRICS: readonly { id: string; better: "higher" | "lower" }[];
export function isoWeek(date: Date): string;
export function buildReport(
	current: Record<string, number | null | undefined>,
	week: string,
	previous?: Record<string, number | null | undefined>,
): { marker: string; title: string; body: string };
export function upsertIssue(
	report: { marker: string; title: string; body: string },
	gh?: (args: string[]) => Promise<string>,
): Promise<void>;
