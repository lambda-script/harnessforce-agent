import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const spawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn }));

import { spawnUsageSender } from "../../src/usage-limits/spawn-sender.js";

describe("starting the detached sender", () => {
	beforeEach(() => spawn.mockReset());

	it("closes stdio, detaches and does not keep the parent alive", () => {
		const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
		spawn.mockReturnValue(child);
		spawnUsageSender('{"a":1}');
		const [, args, options] = spawn.mock.calls[0] ?? [];
		expect(args.slice(-3)).toEqual(["usage-limits", "send", '{"a":1}']);
		expect(options).toEqual({ detached: true, stdio: "ignore" });
		expect(child.unref).toHaveBeenCalled();
	});
});
