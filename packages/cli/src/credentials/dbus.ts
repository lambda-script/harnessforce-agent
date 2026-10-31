import { connect } from "node:net";

// D-Busのsession busへのmethod callに使う最小の実装（D-Bus Specificationの"Message Protocol"）。
// Secret Serviceの項目と解錠の状態だけを読むため、使う型（y b u s o g a v struct dict）だけを扱い、
// unixのsocketとEXTERNAL認証だけに対応する。秘密を運ぶmethod（GetSecretsなど）には使わない。

export type DBusMessage = {
	type: "method_call" | "method_return" | "error" | "signal";
	serial: number;
	path?: string;
	interface?: string;
	member?: string;
	errorName?: string;
	replySerial?: number;
	destination?: string;
	sender?: string;
	signature?: string;
	body?: unknown[];
};

const TYPES = ["", "method_call", "method_return", "error", "signal"] as const;
// header fieldのcodeと型。
const FIELDS = {
	path: [1, "o"],
	interface: [2, "s"],
	member: [3, "s"],
	errorName: [4, "s"],
	replySerial: [5, "u"],
	destination: [6, "s"],
	sender: [7, "s"],
	signature: [8, "g"],
} as const;

type Type = { code: string; children: Type[] };

function parseSignature(signature: string): Type[] {
	let index = 0;
	const one = (): Type => {
		const code = signature[index++] ?? "";
		if (code === "a") return { code, children: [one()] };
		if (code === "(" || code === "{") {
			const close = code === "(" ? ")" : "}";
			const children: Type[] = [];
			while (signature[index] !== close) {
				if (index >= signature.length) throw new Error("bad signature");
				children.push(one());
			}
			index++;
			return { code, children };
		}
		if (!"ybusogv".includes(code) || code === "")
			throw new Error(`unsupported D-Bus type ${code}`);
		return { code, children: [] };
	};
	const types: Type[] = [];
	while (index < signature.length) types.push(one());
	return types;
}

const alignmentOf = (type: Type) =>
	({ y: 1, g: 1, v: 1, b: 4, u: 4, s: 4, o: 4, a: 4 })[type.code] ?? 8;

class Writer {
	private bytes: number[] = [];
	get length() {
		return this.bytes.length;
	}
	align(n: number) {
		while (this.bytes.length % n !== 0) this.bytes.push(0);
	}
	uint32(value: number) {
		this.align(4);
		const buffer = Buffer.alloc(4);
		buffer.writeUInt32LE(value);
		this.bytes.push(...buffer);
	}
	patchUint32(offset: number, value: number) {
		const buffer = Buffer.alloc(4);
		buffer.writeUInt32LE(value);
		this.bytes.splice(offset, 4, ...buffer);
	}
	raw(values: Iterable<number>) {
		this.bytes.push(...values);
	}
	write(type: Type, value: unknown): void {
		const [child] = type.children;
		switch (type.code) {
			case "y":
				this.raw([Number(value)]);
				return;
			case "b":
				this.uint32(value ? 1 : 0);
				return;
			case "u":
				this.uint32(Number(value));
				return;
			case "s":
			case "o": {
				const text = Buffer.from(String(value), "utf8");
				this.uint32(text.length);
				this.raw([...text, 0]);
				return;
			}
			case "g": {
				const text = Buffer.from(String(value), "utf8");
				this.raw([text.length, ...text, 0]);
				return;
			}
			case "v": {
				const variant = value as { signature: string; value: unknown };
				this.write({ code: "g", children: [] }, variant.signature);
				const [inner] = parseSignature(variant.signature);
				if (!inner) throw new Error("empty variant");
				this.write(inner, variant.value);
				return;
			}
			case "a": {
				if (!child) throw new Error("bad array");
				this.uint32(0);
				const lengthAt = this.length - 4;
				this.align(alignmentOf(child));
				const start = this.length;
				const elements =
					child.code === "{"
						? Object.entries(value as Record<string, unknown>)
						: (value as unknown[]);
				for (const element of elements) this.write(child, element);
				this.patchUint32(lengthAt, this.length - start);
				return;
			}
			default: {
				this.align(8);
				const fields = value as unknown[];
				type.children.forEach((field, i) => {
					this.write(field, fields[i]);
				});
			}
		}
	}
	toBuffer() {
		return Buffer.from(this.bytes);
	}
}

class Reader {
	offset = 0;
	private readonly buffer: Buffer;
	private readonly isLittleEndian: boolean;
	constructor(buffer: Buffer, isLittleEndian: boolean) {
		this.buffer = buffer;
		this.isLittleEndian = isLittleEndian;
	}
	align(n: number) {
		this.offset = Math.ceil(this.offset / n) * n;
	}
	uint32() {
		this.align(4);
		const value = this.isLittleEndian
			? this.buffer.readUInt32LE(this.offset)
			: this.buffer.readUInt32BE(this.offset);
		this.offset += 4;
		return value;
	}
	read(type: Type): unknown {
		const [child] = type.children;
		switch (type.code) {
			case "y":
				return this.buffer[this.offset++];
			case "b":
				return this.uint32() !== 0;
			case "u":
				return this.uint32();
			case "s":
			case "o": {
				const length = this.uint32();
				const text = this.buffer.toString(
					"utf8",
					this.offset,
					this.offset + length,
				);
				this.offset += length + 1;
				return text;
			}
			case "g": {
				const length = this.buffer[this.offset++] ?? 0;
				const text = this.buffer.toString(
					"utf8",
					this.offset,
					this.offset + length,
				);
				this.offset += length + 1;
				return text;
			}
			case "v": {
				const signature = this.read({ code: "g", children: [] }) as string;
				const [inner] = parseSignature(signature);
				if (!inner) throw new Error("empty variant");
				return { signature, value: this.read(inner) };
			}
			case "a": {
				if (!child) throw new Error("bad array");
				const length = this.uint32();
				this.align(alignmentOf(child));
				const end = this.offset + length;
				const elements: unknown[] = [];
				while (this.offset < end) elements.push(this.read(child));
				return child.code === "{"
					? Object.fromEntries(elements as [string, unknown][])
					: elements;
			}
			default:
				this.align(8);
				return type.children.map((field) => this.read(field));
		}
	}
}

const HEADER_FIELDS: Type = parseSignature("a(yv)")[0] as Type;

export function encodeMessage(message: DBusMessage): Buffer {
	const signature = message.signature ?? "";
	const bodyWriter = new Writer();
	parseSignature(signature).forEach((type, i) => {
		bodyWriter.write(type, message.body?.[i]);
	});
	const body = bodyWriter.toBuffer();
	const fields: [number, { signature: string; value: unknown }][] = [];
	for (const [name, [code, fieldType]] of Object.entries(FIELDS)) {
		const value = message[name as keyof typeof FIELDS];
		if (value === undefined || (name === "signature" && value === "")) continue;
		fields.push([code, { signature: fieldType, value }]);
	}
	const header = new Writer();
	header.raw([
		"l".charCodeAt(0),
		TYPES.indexOf(message.type),
		// NO_AUTO_STARTを付けない。Secret Serviceの提供者はD-Busの起動で立ち上がる。
		0,
		1,
	]);
	header.uint32(body.length);
	header.uint32(message.serial);
	header.write(HEADER_FIELDS, fields);
	header.align(8);
	return Buffer.concat([header.toBuffer(), body]);
}

// 受け取ったbyte列から、揃ったmessageを取り出す。restは続きを待つbyte列。
export function decodeMessages(buffer: Buffer): {
	messages: DBusMessage[];
	rest: Buffer;
} {
	const messages: DBusMessage[] = [];
	let rest = buffer;
	while (rest.length >= 16) {
		const isLittleEndian = rest[0] === "l".charCodeAt(0);
		const readUint32 = (offset: number) =>
			isLittleEndian ? rest.readUInt32LE(offset) : rest.readUInt32BE(offset);
		const bodyLength = readUint32(4);
		const fieldsLength = readUint32(12);
		const headerLength = Math.ceil((16 + fieldsLength) / 8) * 8;
		const total = headerLength + bodyLength;
		if (rest.length < total) break;
		const reader = new Reader(rest.subarray(0, total), isLittleEndian);
		reader.offset = 8;
		const serial = reader.uint32();
		const fields = reader.read(HEADER_FIELDS) as [number, { value: unknown }][];
		const message: DBusMessage = {
			type: TYPES[rest[1] ?? 0] || "signal",
			serial,
		};
		for (const [code, { value }] of fields) {
			const name = Object.entries(FIELDS).find(([, [c]]) => c === code)?.[0];
			if (name) Object.assign(message, { [name]: value });
		}
		reader.offset = headerLength;
		message.body = parseSignature(message.signature ?? "").map((type) =>
			reader.read(type),
		);
		messages.push(message);
		rest = rest.subarray(total);
	}
	return { messages, rest };
}

type DBusCall = {
	destination: string;
	path: string;
	interface: string;
	member: string;
	signature?: string;
	body?: unknown[];
};

export type DBusConnection = {
	call(call: DBusCall): Promise<unknown[]>;
	close(): void;
};

// `unix:path=…`または`unix:abstract=…`のaddressのsocketのpath。対応しないaddressはundefined。
function socketPath(address: string): string | undefined {
	for (const entry of address.split(";")) {
		const [transport, rest = ""] = entry.split(/:(.*)/s);
		if (transport !== "unix") continue;
		const params = new Map(
			rest.split(",").map((pair) => pair.split(/=(.*)/s) as [string, string]),
		);
		const path = params.get("path");
		if (path) return decodeURIComponent(path);
		const abstract = params.get("abstract");
		if (abstract) return `\0${decodeURIComponent(abstract)}`;
	}
	return undefined;
}

// session busへ接続し、認証してHelloを送る。timeoutMsを超えたら接続を閉じて失敗する。
export function openBus(
	address: string,
	uid: number,
	timeoutMs: number,
): Promise<DBusConnection> {
	const path = socketPath(address);
	if (!path) return Promise.reject(new Error("unsupported D-Bus address"));
	return new Promise((resolve, reject) => {
		const socket = connect({ path });
		const waiting = new Map<
			number,
			{ resolve: (body: unknown[]) => void; reject: (error: Error) => void }
		>();
		let serial = 0;
		let pending: Buffer = Buffer.alloc(0);
		let isAuthenticated = false;
		const fail = (error: Error) => {
			socket.destroy();
			reject(error);
			for (const call of waiting.values()) call.reject(error);
			waiting.clear();
		};
		const timer = setTimeout(
			() => fail(new Error("D-Bus timed out")),
			timeoutMs,
		);
		const close = () => {
			clearTimeout(timer);
			socket.destroy();
		};
		const call = (request: DBusCall) =>
			new Promise<unknown[]>((resolveCall, rejectCall) => {
				serial += 1;
				waiting.set(serial, { resolve: resolveCall, reject: rejectCall });
				socket.write(
					encodeMessage({ type: "method_call", serial, ...request }),
				);
			});
		socket.on("error", fail);
		socket.on("close", () => fail(new Error("D-Bus connection closed")));
		socket.on("connect", () => {
			const uidHex = Buffer.from(String(uid)).toString("hex");
			socket.write(`\0AUTH EXTERNAL ${uidHex}\r\n`);
		});
		socket.on("data", (chunk: Buffer) => {
			pending = Buffer.concat([pending, chunk]);
			if (!isAuthenticated) {
				const lineEnd = pending.indexOf("\r\n");
				if (lineEnd < 0) return;
				const line = pending.toString("latin1", 0, lineEnd);
				pending = pending.subarray(lineEnd + 2);
				if (!line.startsWith("OK "))
					return fail(new Error("D-Bus authentication failed"));
				isAuthenticated = true;
				socket.write("BEGIN\r\n");
				call({
					destination: "org.freedesktop.DBus",
					path: "/org/freedesktop/DBus",
					interface: "org.freedesktop.DBus",
					member: "Hello",
				}).then(() => resolve({ call, close }), fail);
			}
			const { messages, rest } = decodeMessages(pending);
			pending = rest;
			for (const message of messages) {
				const replied =
					message.replySerial === undefined
						? undefined
						: waiting.get(message.replySerial);
				if (!replied || message.replySerial === undefined) continue;
				waiting.delete(message.replySerial);
				if (message.type === "error")
					replied.reject(new Error(message.errorName ?? "D-Bus error"));
				else replied.resolve(message.body ?? []);
			}
		});
	});
}
