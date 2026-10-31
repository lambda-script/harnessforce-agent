import { createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { tempDir } from "@harnessforce/test-support/temp-dir";
import { afterEach, describe, expect, it } from "vitest";
import {
	type DBusMessage,
	decodeMessages,
	encodeMessage,
} from "../../src/credentials/dbus.js";
import {
	createSecretServiceLock,
	sessionBusAddress,
} from "../../src/credentials/secret-service-lock.js";

const UID = 1000;

type Collection = { label: string; isLocked: boolean };
type FakeSecretService = {
	// 提供者のprocessの名前（/proc/<pid>/comm）。
	comm: string;
	// defaultの別名が指すcollection。無ければReadAliasは"/"を返す。
	defaultCollection?: Collection;
	// usernameごとの項目の(unlocked, locked)。
	items?: Record<string, { unlocked: number; locked: number }>;
	// 応答しない（解錠の確認を待つ提供者の代わりではなく、届かないbus）。
	isSilent?: boolean;
};

const PROVIDER_PID = 4242;
const servers: Server[] = [];
afterEach(async () => {
	await Promise.all(
		servers.splice(0).map((server) => new Promise((r) => server.close(r))),
	);
});

// session busとSecret Serviceの提供者の代わり。受けたmethodを記録する。
async function fakeBus(service: FakeSecretService) {
	const path = join(tempDir("hf-dbus-"), "bus");
	const members: string[] = [];
	const server = createServer((socket) => serve(socket, service, members));
	servers.push(server);
	await new Promise<void>((resolve) => server.listen(path, resolve));
	return { address: `unix:path=${path}`, members };
}

function serve(socket: Socket, service: FakeSecretService, members: string[]) {
	let isAuthenticated = false;
	let hasAcceptedAuth = false;
	let pending: Buffer = Buffer.alloc(0);
	let serial = 1;
	const reply = (call: DBusMessage, signature: string, body: unknown[]) =>
		socket.write(
			encodeMessage({
				type: "method_return",
				serial: serial++,
				replySerial: call.serial,
				destination: call.sender,
				signature,
				body,
			}),
		);
	const fail = (call: DBusMessage, name: string) =>
		socket.write(
			encodeMessage({
				type: "error",
				serial: serial++,
				replySerial: call.serial,
				errorName: name,
				signature: "s",
				body: [name],
			}),
		);
	socket.on("data", (chunk: Buffer) => {
		pending = Buffer.concat([pending, chunk]);
		if (!isAuthenticated) {
			const text = pending.toString("latin1");
			if (!hasAcceptedAuth && text.includes("\r\n")) {
				const expected = `\0AUTH EXTERNAL ${Buffer.from(String(UID)).toString("hex")}\r\n`;
				if (!text.startsWith(expected)) return socket.end("REJECTED\r\n");
				hasAcceptedAuth = true;
				socket.write("OK 1234deadbeef\r\n");
			}
			const end = text.indexOf("BEGIN\r\n");
			if (end < 0) return;
			isAuthenticated = true;
			pending = pending.subarray(end + "BEGIN\r\n".length);
		}
		if (service.isSilent) return;
		const { messages, rest } = decodeMessages(pending);
		pending = rest;
		for (const call of messages) {
			members.push(call.member ?? "");
			if (call.member === "Hello") reply(call, "s", [":1.7"]);
			else if (call.member === "GetConnectionUnixProcessID")
				reply(call, "u", [PROVIDER_PID]);
			else if (call.member === "SearchItems") {
				const [attributes] = call.body as [Record<string, string>];
				const found = service.items?.[attributes.username ?? ""] ?? {
					unlocked: 0,
					locked: 0,
				};
				const paths = (n: number, prefix: string) =>
					Array.from(
						{ length: n },
						(_, i) => `/org/freedesktop/secrets/collection/${prefix}/${i}`,
					);
				reply(call, "aoao", [
					paths(found.unlocked, "u"),
					paths(found.locked, "l"),
				]);
			} else if (call.member === "Get") {
				const [, property] = call.body as [string, string];
				const collection = service.defaultCollection;
				if (!collection) fail(call, "org.freedesktop.DBus.Error.UnknownObject");
				else if (property === "Locked")
					reply(call, "v", [{ signature: "b", value: collection.isLocked }]);
				else reply(call, "v", [{ signature: "s", value: collection.label }]);
			} else fail(call, "org.freedesktop.DBus.Error.UnknownMethod");
		}
	});
}

const KDE: FakeSecretService = {
	comm: "ksecretd",
	defaultCollection: { label: "kdewallet", isLocked: true },
	items: { "ws1:ingest-key": { unlocked: 0, locked: 1 } },
};
const GNOME: FakeSecretService = {
	comm: "gnome-keyring-d",
	defaultCollection: { label: "Login", isLocked: true },
	items: { "ws1:ingest-key": { unlocked: 0, locked: 1 } },
};

function lockFor(address: string, service: FakeSecretService) {
	return createSecretServiceLock({
		address,
		uid: UID,
		readComm: async (pid) => {
			if (pid !== PROVIDER_PID) throw new Error("unknown pid");
			return service.comm;
		},
	});
}

describe.each([
	["KDE (KWallet)", KDE],
	["GNOME (GNOME Keyring)", GNOME],
])("ロックされたSecret Service: %s", (_, service) => {
	it("ロックされた項目の読み出しは解錠の確認が要る", async () => {
		const bus = await fakeBus(service);
		const lock = lockFor(bus.address, service);
		await expect(lock.needsUnlock("get", "ws1:ingest-key", 1000)).resolves.toBe(
			true,
		);
		expect(bus.members).toEqual(["Hello", "SearchItems"]);
	});

	it("項目の無いaccountの読み出しは解錠の確認が要らない", async () => {
		const bus = await fakeBus(service);
		const lock = lockFor(bus.address, service);
		await expect(
			lock.needsUnlock("get", "availability-probe", 1000),
		).resolves.toBe(false);
	});

	it("項目の無いaccountへの書き込みは、defaultのcollectionがロックされていれば解錠の確認が要る", async () => {
		const bus = await fakeBus(service);
		const lock = lockFor(bus.address, service);
		await expect(
			lock.needsUnlock("set", "availability-probe", 1000),
		).resolves.toBe(true);
		expect(bus.members).toEqual(["Hello", "SearchItems", "Get"]);
	});
});

describe("解錠されたSecret Service", () => {
	it("解錠された項目とcollectionの操作は解錠の確認が要らない", async () => {
		const service = {
			...KDE,
			defaultCollection: { label: "kdewallet", isLocked: false },
			items: { "ws1:ingest-key": { unlocked: 1, locked: 0 } },
		};
		const bus = await fakeBus(service);
		const lock = lockFor(bus.address, service);
		await expect(lock.needsUnlock("get", "ws1:ingest-key", 1000)).resolves.toBe(
			false,
		);
		await expect(lock.needsUnlock("set", "ws1:url-origin", 1000)).resolves.toBe(
			false,
		);
	});

	it("defaultのcollectionが無ければ、書き込みは作る確認が要る", async () => {
		const service = { ...GNOME, defaultCollection: undefined };
		const bus = await fakeBus(service);
		const lock = lockFor(bus.address, service);
		await expect(
			lock.needsUnlock("set", "availability-probe", 1000),
		).resolves.toBe(true);
	});
});

describe("提供者", () => {
	it("KDEではKWalletとdefaultのwalletの名前を返す", async () => {
		const bus = await fakeBus(KDE);
		await expect(lockFor(bus.address, KDE).provider(1000)).resolves.toEqual({
			isKWallet: true,
			walletLabel: "kdewallet",
		});
	});

	it("GNOMEではKWalletでないと返す", async () => {
		const bus = await fakeBus(GNOME);
		await expect(lockFor(bus.address, GNOME).provider(1000)).resolves.toEqual({
			isKWallet: false,
			walletLabel: "Login",
		});
	});
});

describe("届かないbus", () => {
	it("応答の無いbusは上限時間で失敗する", async () => {
		const service = { ...KDE, isSilent: true };
		const bus = await fakeBus(service);
		await expect(
			lockFor(bus.address, service).needsUnlock("get", "ws1:ingest-key", 100),
		).rejects.toThrow();
	});

	it("unixのsocket以外のaddressは失敗する", async () => {
		await expect(
			lockFor("tcp:host=127.0.0.1,port=1", KDE).needsUnlock("get", "a", 100),
		).rejects.toThrow();
	});
});

describe("sessionBusAddress", () => {
	it("DBUS_SESSION_BUS_ADDRESSを優先する", () => {
		expect(
			sessionBusAddress({
				DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus,guid=ab",
				XDG_RUNTIME_DIR: "/run/user/9",
			}),
		).toBe("unix:path=/run/user/1000/bus,guid=ab");
	});

	it("無ければXDG_RUNTIME_DIRのbusを使う（libdbusの既定と同じ）", () => {
		expect(sessionBusAddress({ XDG_RUNTIME_DIR: "/run/user/1000" })).toBe(
			"unix:path=/run/user/1000/bus",
		);
		expect(sessionBusAddress({})).toBeUndefined();
	});
});
