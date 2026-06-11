export class Duration {
	constructor(readonly milliseconds: number) {}

	static hours(n: number): Duration {
		return new Duration(n * 3_600_000);
	}

	static minutes(n: number): Duration {
		return new Duration(n * 60_000);
	}

	static seconds(n: number): Duration {
		return new Duration(n * 1000);
	}

	static days(n: number): Duration {
		return new Duration(n * 86_400_000);
	}
}