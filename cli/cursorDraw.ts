export function clickRingDrawing(radius: number): string {
	const r = Math.max(6, Math.round(radius));
	const points: string[] = [];
	const steps = 12;
	for (let index = 0; index <= steps; index += 1) {
		const angle = (Math.PI * 2 * index) / steps;
		points.push(`${Math.round(Math.cos(angle) * r)} ${Math.round(Math.sin(angle) * r)}`);
	}
	return `m ${points[0]} l ${points.slice(1).join(" l ")}`;
}
