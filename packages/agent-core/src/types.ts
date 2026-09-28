// processの環境変数。Windowsでは名前の大文字と小文字を区別せずに読む箇所がある（process/lookup.ts）。
export type Env = Readonly<Record<string, string | undefined>>;

// globalのfetchと同じ呼び出し。testは応答を差し替える。
export type Fetch = (url: URL, init: RequestInit) => Promise<Response>;
