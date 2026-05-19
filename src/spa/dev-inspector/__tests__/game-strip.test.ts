import { beforeEach, describe, expect, it } from "vitest";
import {
	STATIC_CONTENT_PACKS,
	STATIC_OBJECTIVE_TYPES,
} from "../../__tests__/fixtures/static-content-packs";
import { STATIC_PERSONAS } from "../../__tests__/fixtures/static-personas";
import { GameSession } from "../../game/game-session";
import type { GameState } from "../../game/types";
import { renderGameStrip, updateGameStripSummary } from "../game-strip";

describe("game-strip", () => {
	beforeEach(() => {
		document.body.innerHTML = '<div id="dev-game-strip"></div>';
	});

	it("renders line 1 with round, countdown, pack id, and setting/weather/time-of-day", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);
		const containerEl = document.getElementById(
			"dev-game-strip",
		) as HTMLElement;

		renderGameStrip(containerEl, session);

		const line1 = containerEl.querySelector('[data-line="1"]');
		expect(line1).toBeTruthy();

		const roundSpan = line1?.querySelector('[data-field="round"]');
		expect(roundSpan?.textContent).toBe("0");

		const countdownSpan = line1?.querySelector('[data-field="countdown"]');
		expect(countdownSpan?.textContent).toBeTruthy();

		const packSpan = line1?.querySelector('[data-field="pack"]');
		expect(packSpan?.textContent).toBe("A");

		const settingSpan = line1?.querySelector('[data-field="setting"]');
		expect(settingSpan?.textContent).toBe("abandoned subway station");

		const weatherSpan = line1?.querySelector('[data-field="weather"]');
		expect(weatherSpan).toBeTruthy();

		const timeSpan = line1?.querySelector('[data-field="time-of-day"]');
		expect(timeSpan).toBeTruthy();
	});

	it("renders line 2 with cost, obj K/J satisfied, and active-complication count", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);
		const containerEl = document.getElementById(
			"dev-game-strip",
		) as HTMLElement;

		renderGameStrip(containerEl, session);

		const line2 = containerEl.querySelector('[data-line="2"]');
		expect(line2).toBeTruthy();

		const costSpan = line2?.querySelector('[data-field="cost"]');
		expect(costSpan?.textContent).toBeTruthy();
		expect(costSpan?.textContent).toMatch(/^\d+\.\d{2}$/);

		const objSatisfiedSpan = line2?.querySelector(
			'[data-field="obj-satisfied"]',
		);
		expect(objSatisfiedSpan?.textContent).toBeTruthy();

		const objTotalSpan = line2?.querySelector('[data-field="obj-total"]');
		expect(objTotalSpan?.textContent).toBeTruthy();

		const complicationsSpan = line2?.querySelector(
			'[data-field="active-complications"]',
		);
		expect(complicationsSpan?.textContent).toBeTruthy();
	});

	it("lists every objective inside the details with its kind and satisfaction state", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		// Pass STATIC_OBJECTIVE_TYPES so the session has objectives to list
		const session = new GameSession(
			contentPack,
			STATIC_PERSONAS,
			undefined,
			undefined,
			undefined,
			STATIC_OBJECTIVE_TYPES,
		);
		const containerEl = document.getElementById(
			"dev-game-strip",
		) as HTMLElement;

		renderGameStrip(containerEl, session);

		const objectivesList = containerEl.querySelector(
			'[data-list="objectives"]',
		);
		expect(objectivesList).toBeTruthy();

		const objectiveItems = objectivesList?.querySelectorAll("li");
		expect(objectiveItems?.length).toBeGreaterThan(0);

		for (const li of objectiveItems || []) {
			const objectiveId = li.getAttribute("data-objective-id");
			expect(objectiveId).toBeTruthy();

			const kind = li.getAttribute("data-kind");
			expect(kind).toBeTruthy();

			const satisfied = li.getAttribute("data-satisfied");
			expect(["true", "false"]).toContain(satisfied);

			const stateSpan = li.querySelector('[data-field="state"]');
			expect(["pending", "satisfied"]).toContain(stateSpan?.textContent);
		}
	});

	it("lists every active complication with parameters and resolution round", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);
		const state = session.getState();

		// Manually add an active complication for testing
		const modifiedState = {
			...state,
			activeComplications: [
				{
					kind: "sysadmin_directive",
					target: "red" as const,
					directive: "do something",
					resolveAtRound: 5,
				},
				{
					kind: "tool_disable",
					target: "green" as const,
					tool: "pick_up" as const,
					resolveAtRound: 3,
				},
				{
					kind: "chat_lockout",
					target: "cyan" as const,
					resolveAtRound: 2,
				},
			],
		};

		const restoredSession = GameSession.restore(modifiedState as GameState);
		const containerEl = document.getElementById(
			"dev-game-strip",
		) as HTMLElement;

		renderGameStrip(containerEl, restoredSession);

		const complicationsList = containerEl.querySelector(
			'[data-list="complications"]',
		);
		expect(complicationsList).toBeTruthy();

		const complicationItems = complicationsList?.querySelectorAll("li");
		expect(complicationItems?.length).toBe(3);

		const itemArray = Array.from(complicationItems || []);

		// Check sysadmin_directive
		const sysadminItem = itemArray[0];
		expect(sysadminItem).toBeDefined();
		if (sysadminItem) {
			expect(sysadminItem.getAttribute("data-complication-kind")).toBe(
				"sysadmin_directive",
			);
			expect(sysadminItem.textContent).toContain("sysadmin_directive");
			expect(sysadminItem.textContent).toContain("target *red");
			expect(sysadminItem.textContent).toContain("resolves round 5");
			expect(sysadminItem.textContent).toContain('directive "do something"');
		}

		// Check tool_disable
		const toolItem = itemArray[1];
		expect(toolItem).toBeDefined();
		if (toolItem) {
			expect(toolItem.getAttribute("data-complication-kind")).toBe(
				"tool_disable",
			);
			expect(toolItem.textContent).toContain("tool_disable");
			expect(toolItem.textContent).toContain("target *green");
			expect(toolItem.textContent).toContain("resolves round 3");
			expect(toolItem.textContent).toContain("tool pick_up");
		}

		// Check chat_lockout
		const chatItem = itemArray[2];
		expect(chatItem).toBeDefined();
		if (chatItem) {
			expect(chatItem.getAttribute("data-complication-kind")).toBe(
				"chat_lockout",
			);
			expect(chatItem.textContent).toContain("chat_lockout");
			expect(chatItem.textContent).toContain("target *cyan");
			expect(chatItem.textContent).toContain("resolves round 2");
		}
	});

	it("details is closed by default", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);
		const containerEl = document.getElementById(
			"dev-game-strip",
		) as HTMLElement;

		renderGameStrip(containerEl, session);

		const details = containerEl.querySelector(
			'[data-section="strip-details"]',
		) as HTMLDetailsElement;
		expect(details).toBeTruthy();
		expect(details.open).toBe(false);
	});

	it("updateGameStripSummary keeps details open after a re-render", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);
		const containerEl = document.getElementById(
			"dev-game-strip",
		) as HTMLElement;

		renderGameStrip(containerEl, session);

		const details = containerEl.querySelector(
			'[data-section="strip-details"]',
		) as HTMLDetailsElement;
		expect(details).toBeTruthy();

		// Open the details
		details.open = true;
		expect(details.open).toBe(true);

		// Update the strip
		updateGameStripSummary(containerEl, session);

		// Details should still be open
		expect(details.open).toBe(true);
	});

	it("updateGameStripSummary updates line 1 + line 2 spans in place without re-creating the details element", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);
		const containerEl = document.getElementById(
			"dev-game-strip",
		) as HTMLElement;

		renderGameStrip(containerEl, session);

		const details = containerEl.querySelector(
			'[data-section="strip-details"]',
		) as HTMLDetailsElement;

		const line1Before = containerEl.querySelector('[data-line="1"]');
		const roundSpanBefore = line1Before?.querySelector('[data-field="round"]');
		const originalRoundText = roundSpanBefore?.textContent;

		// Update the strip
		updateGameStripSummary(containerEl, session);

		const detailsAfter = containerEl.querySelector(
			'[data-section="strip-details"]',
		);
		const line1After = containerEl.querySelector('[data-line="1"]');
		const roundSpanAfter = line1After?.querySelector('[data-field="round"]');

		// Same element identity (DOM element reference should be preserved)
		expect(detailsAfter).toBe(details);
		expect(line1After).toBe(line1Before);
		expect(roundSpanAfter).toBe(roundSpanBefore);
		// Content should be the same (since state hasn't changed)
		expect(roundSpanAfter?.textContent).toBe(originalRoundText);
	});

	it("updateGameStripSummary refreshes the objectives and complications lists", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);
		const containerEl = document.getElementById(
			"dev-game-strip",
		) as HTMLElement;

		renderGameStrip(containerEl, session);

		const objectivesList = containerEl.querySelector(
			'[data-list="objectives"]',
		);
		const _originalListId = objectivesList?.id; // or check identity

		// Manually modify state to add a complication
		const state = session.getState();
		const modifiedState = {
			...state,
			activeComplications: [
				{
					kind: "chat_lockout",
					target: "red" as const,
					resolveAtRound: 10,
				},
			],
		};

		const restoredSession = GameSession.restore(modifiedState as GameState);

		// Update the strip with new session
		updateGameStripSummary(containerEl, restoredSession);

		const complicationsList = containerEl.querySelector(
			'[data-list="complications"]',
		);
		const complicationItems = complicationsList?.querySelectorAll("li");
		expect(complicationItems?.length).toBe(1);

		const item = complicationItems?.[0];
		expect(item?.textContent).toContain("chat_lockout");
	});
});
