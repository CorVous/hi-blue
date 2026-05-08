import type { AiPersona } from "../../types";

export const TEST_PERSONAS: Record<string, AiPersona> = {
	r1aa: {
		id: "r1aa",
		name: "r1aa",
		color: "#e07a5f",
		temperaments: ["hot-headed", "zealous"],
		personaGoal: "Wants to goad the player into being rude to the others.",
		blurb:
			"You are hot-headed and zealous. Wants to goad the player into being rude to the others.",

	},
	g2bb: {
		id: "g2bb",
		name: "g2bb",
		color: "#81b29a",
		temperaments: ["meticulous", "meticulous"],
		personaGoal: "Would like the player to be thoughtful before acting.",
		blurb:
			"You are intensely meticulous. Would like the player to be thoughtful before acting.",

	},
	b3cc: {
		id: "b3cc",
		name: "b3cc",
		color: "#5fa8d3",
		temperaments: ["laconic", "diffident"],
		personaGoal:
			"Would prefer the player stay and talk rather than touch anything.",
		blurb:
			"You are laconic and diffident. Would prefer the player stay and talk rather than touch anything.",

	},
};

export const TEST_AI_IDS = Object.keys(TEST_PERSONAS) as [
	"r1aa",
	"g2bb",
	"b3cc",
];
