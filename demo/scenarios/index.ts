import type { Scenario } from "../engine.ts";
import { excalidraw } from "./excalidraw.ts";
import { github } from "./github.ts";
import { harbor } from "./harbor.ts";
import { openstreetmap } from "./openstreetmap.ts";

// Add a demo by dropping a scenario file in this folder and registering it here.
export const scenarios: Record<string, Scenario> = {
	harbor,
	github,
	excalidraw,
	osm: openstreetmap,
};

export const DEFAULT_SCENARIO = "harbor";

export function getScenario(name: string): Scenario | null {
	return scenarios[name] ?? null;
}

export function listScenarios(): Scenario[] {
	return Object.values(scenarios);
}
