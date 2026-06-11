export type SecurityId = string;

export type Security = {
	symbol: string;
	name: string;
	annualReturn: (context: { year: number, progress: number }) => number;
	expenseRatio: number;
	dividendYield: (context: { year: number, progress: number }) => number;
	capitalGainsDistributionYield: number;
};

export type Holding = {
	securityId: SecurityId;
	weight: (context: { year: number, progress: number }) => number;
};

export type ScenarioTimeline = {
	startYear: number;
	years: number;
	annualContribution: number;
	contributionTiming: "start" | "end";
	rebalanceEveryNYears: number;
}

export type ScenarioTax = {
	dividendTaxRate: number;
	capitalGainsTax: (context: {
		year: number;
		progress: number;
		realizedGains: number;
	}) => number;
	taxesPaidFromAccount: boolean;
}

export type Scenario = {
	name: string;
	timeline: ScenarioTimeline;
	tax: ScenarioTax;
	holdings: Holding[];
	securities: Record<SecurityId, Security>;
};

type PositionState = {
	securityId: SecurityId;
	value: number;
	costBasis: number;
	feesPaid: number;
	dividendTaxesPaid: number;
	capitalGainsTaxesPaid: number;
};

export type YearRow = {
	year: number;
	endingValue: number;
	cumulativeFees: number;
	cumulativeDividendTaxes: number;
	cumulativeCapitalGainsTaxes: number;
	annualFees: number;
	annualDividendTaxes: number;
	annualCapitalGainsTaxes: number;
};

function sumArray(numbers: number[]): number {
	return numbers.reduce((sum, num) => sum + num, 0);
}

export function validateScenario(scenario: Scenario): void {
	const startYear = scenario.timeline.startYear;
	const endYear = scenario.timeline.startYear + scenario.timeline.years - 1;
	const totalStartWeight = sumArray(scenario.holdings.map(holding => holding.weight({ year: startYear, progress: 0 })));
	const totalEndWeight = sumArray(scenario.holdings.map(holding => holding.weight({ year: endYear, progress: 1 })));

	if (Math.abs(totalStartWeight - 1) > 0.000001) {
		throw new Error(
			`${scenario.name}: start weights must sum to 1.0, got ${totalStartWeight.toFixed(6)}`,
		);
	}

	if (Math.abs(totalEndWeight - 1) > 0.000001) {
		throw new Error(
			`${scenario.name}: end weights must sum to 1.0, got ${totalEndWeight.toFixed(6)}`,
		);
	}

	if (
		scenario.timeline.rebalanceEveryNYears <= 0 ||
		(Number.isFinite(scenario.timeline.rebalanceEveryNYears) && !Number.isInteger(scenario.timeline.rebalanceEveryNYears))
	) {
		throw new Error(
			`${scenario.name}: rebalanceEveryNYears must be a positive integer or Infinity.`,
		);
	}
}

export function simulateScenario(scenario: Scenario): YearRow[] {
	const positions = scenario.holdings.map<PositionState>((holding) => ({
		securityId: holding.securityId,
		value: 0,
		costBasis: 0,
		feesPaid: 0,
		dividendTaxesPaid: 0,
		capitalGainsTaxesPaid: 0,
	}));

	const rows: YearRow[] = [];

	for (let yearOffset = 0; yearOffset < scenario.timeline.years; yearOffset += 1) {
		const year = scenario.timeline.startYear + yearOffset;
		const progress = progressForOffset(yearOffset, scenario.timeline.years);
		const targetWeights = getTargetWeightsForYear(scenario, yearOffset);

		if (scenario.timeline.contributionTiming === "start") {
			contributeToTargets(positions, targetWeights, scenario.timeline.annualContribution);
		}

		const annual = applyAnnualReturnsAndTaxes(positions, scenario, year, progress);

		if (shouldRebalanceThisYear(yearOffset, scenario.timeline.rebalanceEveryNYears)) {
			annual.rebalanceCapitalGainsTaxes += rebalancePortfolio(positions, targetWeights, scenario, year, progress);
		}

		if (scenario.timeline.contributionTiming === "end") {
			contributeToTargets(positions, targetWeights, scenario.timeline.annualContribution);
		}

		if (yearOffset === scenario.timeline.years - 1) {
			annual.rebalanceCapitalGainsTaxes += applyEndOfHorizonCapitalGainsTaxes(positions, scenario, year, progress);
		}

		const cumulativeFees = sumArray(positions.map(position => position.feesPaid));
		const cumulativeDividendTaxes = sumArray(positions.map(position => position.dividendTaxesPaid));
		const cumulativeCapitalGainsTaxes = sumArray(positions.map(position => position.capitalGainsTaxesPaid));

		rows.push({
			year,
			endingValue: sumArray(positions.map(position => position.value)),
			cumulativeFees,
			cumulativeDividendTaxes,
			cumulativeCapitalGainsTaxes,
			annualFees: annual.fees,
			annualDividendTaxes: annual.dividendTaxes,
			annualCapitalGainsTaxes: annual.capitalGainsDistributionTaxes + annual.rebalanceCapitalGainsTaxes,
		});
	}

	return rows;
}

function shouldRebalanceThisYear(yearOffset: number, rebalanceEveryNYears: number): boolean {
	if (!Number.isFinite(rebalanceEveryNYears)) {
		return false;
	}

	return (yearOffset + 1) % rebalanceEveryNYears === 0;
}

function contributeToTargets(
	positions: PositionState[],
	targetWeights: number[],
	annualContribution: number,
): void {
	for (let index = 0; index < targetWeights.length; index += 1) {
		const contribution = annualContribution * targetWeights[index]!;
		positions[index]!.value += contribution;
		positions[index]!.costBasis += contribution;
	}
}

function applyAnnualReturnsAndTaxes(
	positions: PositionState[],
	scenario: Scenario,
	year: number,
	progress: number,
): {
	fees: number;
	dividendTaxes: number;
	capitalGainsDistributionTaxes: number;
	rebalanceCapitalGainsTaxes: number;
} {
	let annualFees = 0;
	let annualDividendTaxes = 0;
	let annualCapitalGainsDistributionTaxes = 0;

	for (const position of positions) {
		const security = scenario.securities[position.securityId]!;
		const openingValue = position.value;
		const annualReturn = security.annualReturn({ year, progress });
		const dividendYield = security.dividendYield({ year, progress });
		const dividendAmount = openingValue * dividendYield;
		const capitalGainsDistributionAmount = openingValue * security.capitalGainsDistributionYield;
		const priceReturnRate = annualReturn - dividendYield - security.capitalGainsDistributionYield;
		const priceAppreciationAmount = openingValue * priceReturnRate;
		const estimatedFee = openingValue * (1 + annualReturn / 2) * security.expenseRatio;

		const dividendTax = dividendAmount * scenario.tax.dividendTaxRate;
		const capitalGainsDistributionTax = scenario.tax.capitalGainsTax({
			year,
			progress,
			realizedGains: capitalGainsDistributionAmount,
		});

		position.value += dividendAmount + capitalGainsDistributionAmount + priceAppreciationAmount;

		if (scenario.tax.taxesPaidFromAccount) {
			position.value -= dividendTax + capitalGainsDistributionTax;
		}

		position.feesPaid += estimatedFee;
		position.dividendTaxesPaid += dividendTax;
		position.capitalGainsTaxesPaid += capitalGainsDistributionTax;

		annualFees += estimatedFee;
		annualDividendTaxes += dividendTax;
		annualCapitalGainsDistributionTaxes += capitalGainsDistributionTax;
	}

	return {
		fees: annualFees,
		dividendTaxes: annualDividendTaxes,
		capitalGainsDistributionTaxes: annualCapitalGainsDistributionTaxes,
		rebalanceCapitalGainsTaxes: 0,
	};
}

function applyEndOfHorizonCapitalGainsTaxes(
	positions: PositionState[],
	scenario: Scenario,
	year: number,
	progress: number,
): number {
	let totalTaxes = 0;

	for (const position of positions) {
		const unrealizedGain = Math.max(0, position.value - position.costBasis);
		if (unrealizedGain <= 0) {
			continue;
		}

		const tax = scenario.tax.capitalGainsTax({
			year,
			progress,
			realizedGains: unrealizedGain,
		});
		position.capitalGainsTaxesPaid += tax;
		totalTaxes += tax;

		if (scenario.tax.taxesPaidFromAccount) {
			position.value -= tax;
		}

		position.costBasis = position.value;
	}

	return totalTaxes;
}

function rebalancePortfolio(
	positions: PositionState[],
	targetWeights: number[],
	scenario: Scenario,
	year: number,
	progress: number,
): number {
	const totalValue = sumArray(positions.map(position => position.value));
	if (totalValue <= 0) {
		return 0;
	}

	let totalRebalanceTaxes = 0;

	for (let index = 0; index < positions.length; index += 1) {
		const position = positions[index]!;
		const targetValue = totalValue * targetWeights[index]!;

		if (position.value <= targetValue) {
			continue;
		}

		const sellAmount = position.value - targetValue;
		const gainRatio = position.value <= 0 ? 0 : Math.max(0, (position.value - position.costBasis) / position.value);
		const realizedGain = sellAmount * gainRatio;
		const tax = scenario.tax.capitalGainsTax({
			year,
			progress,
			realizedGains: realizedGain,
		});

		const basisReductionRatio = sellAmount / position.value;
		position.costBasis -= position.costBasis * basisReductionRatio;
		position.value -= sellAmount;
		position.capitalGainsTaxesPaid += tax;
		totalRebalanceTaxes += tax;

		if (scenario.tax.taxesPaidFromAccount) {
			position.value -= tax;
		}
	}

	const postTaxTotal = sumArray(positions.map(position => position.value));
	for (let index = 0; index < positions.length; index += 1) {
		const position = positions[index]!;
		const desiredValue = postTaxTotal * targetWeights[index]!;
		if (desiredValue <= position.value) {
			continue;
		}

		const buyAmount = desiredValue - position.value;
		position.value += buyAmount;
		position.costBasis += buyAmount;
	}

	return totalRebalanceTaxes;
}

function getTargetWeightsForYear(scenario: Scenario, yearOffset: number): number[] {
	const year = scenario.timeline.startYear + yearOffset;
	const progress = progressForOffset(yearOffset, scenario.timeline.years);
	return scenario.holdings.map((holding) => holding.weight({ year, progress }));
}

function progressForOffset(yearOffset: number, totalYears: number): number {
	if (totalYears <= 1) {
		return 0;
	}

	return yearOffset / (totalYears - 1);
}