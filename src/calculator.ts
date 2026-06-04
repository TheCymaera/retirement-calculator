export type FundId = string;

export type Fund = {
	symbol: string;
	name: string;
	annualReturn: number;
	expenseRatio: number;
	dividendYield: number;
	capitalGainsDistributionYield: number;
};

export type Holding = {
	fundId: FundId;
	startWeight: number;
	endWeight: number;
};

export type Scenario = {
	name: string;
	startYear: number;
	years: number;
	annualContribution: number;
	contributionTiming: "start" | "end";
	dividendTaxRate: number;
	longTermCapitalGainsTaxRate: number;
	taxesPaidFromAccount: boolean;
	assumeRebalanceSalesAreLongTerm: boolean;
	rebalanceEveryNYears: number;
	holdings: Holding[];
	funds: Record<FundId, Fund>;
};

type PositionState = {
	fundId: FundId;
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
	const totalStartWeight = sumArray(scenario.holdings.map(holding => holding.startWeight));
	const totalEndWeight = sumArray(scenario.holdings.map(holding => holding.endWeight));

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
		scenario.rebalanceEveryNYears <= 0 ||
		(Number.isFinite(scenario.rebalanceEveryNYears) && !Number.isInteger(scenario.rebalanceEveryNYears))
	) {
		throw new Error(
			`${scenario.name}: rebalanceEveryNYears must be a positive integer or Infinity.`,
		);
	}
}

export function simulateScenario(scenario: Scenario): YearRow[] {
	const positions = scenario.holdings.map<PositionState>((holding) => ({
		fundId: holding.fundId,
		value: 0,
		costBasis: 0,
		feesPaid: 0,
		dividendTaxesPaid: 0,
		capitalGainsTaxesPaid: 0,
	}));

	const rows: YearRow[] = [];

	for (let yearOffset = 0; yearOffset < scenario.years; yearOffset += 1) {
		const year = scenario.startYear + yearOffset;
		const targetWeights = getTargetWeightsForYear(scenario, yearOffset);

		if (scenario.contributionTiming === "start") {
			contributeToTargets(positions, targetWeights, scenario.annualContribution);
		}

		const annual = applyAnnualReturnsAndTaxes(positions, scenario);

		if (shouldRebalanceThisYear(yearOffset, scenario.rebalanceEveryNYears)) {
			annual.rebalanceCapitalGainsTaxes += rebalancePortfolio(positions, targetWeights, scenario);
		}

		if (scenario.contributionTiming === "end") {
			contributeToTargets(positions, targetWeights, scenario.annualContribution);
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
			annualCapitalGainsTaxes:
				annual.capitalGainsDistributionTaxes + annual.rebalanceCapitalGainsTaxes,
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
		const contribution = annualContribution * targetWeights[index];
		positions[index].value += contribution;
		positions[index].costBasis += contribution;
	}
}

function applyAnnualReturnsAndTaxes(
	positions: PositionState[],
	scenario: Scenario,
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
		const fund = scenario.funds[position.fundId];
		const openingValue = position.value;
		const dividendAmount = openingValue * fund.dividendYield;
		const capitalGainsDistributionAmount =
			openingValue * fund.capitalGainsDistributionYield;
		const priceReturnRate =
			fund.annualReturn - fund.dividendYield - fund.capitalGainsDistributionYield;
		const priceAppreciationAmount = openingValue * priceReturnRate;
		const estimatedFee = openingValue * (1 + fund.annualReturn / 2) * fund.expenseRatio;

		const dividendTax = dividendAmount * scenario.dividendTaxRate;
		const capitalGainsDistributionTax =
			capitalGainsDistributionAmount * scenario.longTermCapitalGainsTaxRate;

		position.value +=
			dividendAmount + capitalGainsDistributionAmount + priceAppreciationAmount;

		if (scenario.taxesPaidFromAccount) {
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

function rebalancePortfolio(
	positions: PositionState[],
	targetWeights: number[],
	scenario: Scenario,
): number {
	const totalValue = sumArray(positions.map(position => position.value));
	if (totalValue <= 0) {
		return 0;
	}

	let totalRebalanceTaxes = 0;

	for (let index = 0; index < positions.length; index += 1) {
		const position = positions[index];
		const targetValue = totalValue * targetWeights[index];

		if (position.value <= targetValue) {
			continue;
		}

		const sellAmount = position.value - targetValue;
		const gainRatio = position.value <= 0 ? 0 : Math.max(0, (position.value - position.costBasis) / position.value);
		const realizedGain =
			sellAmount * gainRatio * (scenario.assumeRebalanceSalesAreLongTerm ? 1 : 0);
		const tax = realizedGain * scenario.longTermCapitalGainsTaxRate;

		const basisReductionRatio = sellAmount / position.value;
		position.costBasis -= position.costBasis * basisReductionRatio;
		position.value -= sellAmount;
		position.capitalGainsTaxesPaid += tax;
		totalRebalanceTaxes += tax;

		if (scenario.taxesPaidFromAccount) {
			position.value -= tax;
		}
	}

	const postTaxTotal = sumArray(positions.map(position => position.value));
	for (let index = 0; index < positions.length; index += 1) {
		const position = positions[index];
		const desiredValue = postTaxTotal * targetWeights[index];
		if (desiredValue <= position.value) {
			continue;
		}

		const buyAmount = desiredValue - position.value;
		position.value += buyAmount;
		position.costBasis += buyAmount;
	}

	return totalRebalanceTaxes;
}

export function printScenario(scenario: Scenario, rows: YearRow[]): void {
	console.log(`\n${scenario.name}`);
	for (const line of buildScenarioDetailLines(scenario)) {
		console.log(line);
	}
	console.log("Holdings:");
	for (const holding of scenario.holdings) {
		console.log(`  - ${describeHolding(holding, scenario.funds[holding.fundId])}`);
	}
	console.table(
		rows.map((row) => ({
			Year: row.year,
			"Ending Value": formatCurrency(row.endingValue),
			"Total Fees": formatCurrency(row.cumulativeFees),
			"Dividend Taxes": formatCurrency(row.cumulativeDividendTaxes),
			"LTCG Taxes": formatCurrency(row.cumulativeCapitalGainsTaxes),
			"Fees This Year": formatCurrency(row.annualFees),
			"Dividend Tax This Year": formatCurrency(row.annualDividendTaxes),
			"LTCG Tax This Year": formatCurrency(row.annualCapitalGainsTaxes),
		})),
	);
}

export function htmlScenario(scenario: Scenario, rows: YearRow[]): string {
	const details = buildScenarioDetailLines(scenario)
		.map((line) => `<li>${escapeHtml(line)}</li>`)
		.join("");
	const holdings = scenario.holdings
		.map((holding) => {
			const fund = scenario.funds[holding.fundId];
			const startWeight = holding.startWeight;
			const endWeight = holding.endWeight;
			return `<tr>
<td>${escapeHtml(fund.symbol)}</td>
<td>${escapeHtml(fund.name)}</td>
	<td>${formatPercent(startWeight)}</td>
	<td>${formatPercent(endWeight)}</td>
<td>${formatPercent(fund.annualReturn)}</td>
<td>${formatPercent(fund.expenseRatio)}</td>
<td>${formatPercent(fund.dividendYield)}</td>
<td>${formatPercent(fund.capitalGainsDistributionYield)}</td>
</tr>`;
		})
		.join("");

	const header = `<h2>${escapeHtml(scenario.name)}</h2>
<h3>Scenario Details</h3>
<ul>${details}</ul>
<h3>Fund Allocation</h3>
<table>
<tr>
<th>Symbol</th>
<th>Name</th>
<th>Start Weight</th>
<th>End Weight</th>
<th>Annual Return</th>
<th>Expense Ratio</th>
<th>Dividend Yield</th>
<th>Capital Gains Dist. Yield</th>
</tr>
${holdings}
</table>`;

	const tableHeader = `<tr>
<th>Year</th>
<th>Ending Value</th>
<th>Total Fees</th>
<th>Dividend Taxes</th>
<th>LTCG Taxes</th>
<th>Fees This Year</th>
<th>Dividend Tax This Year</th>
<th>LTCG Tax This Year</th>
</tr>`;

	const tableRows = rows
		.map(
			(row) => `<tr>
<td>${row.year}</td>
<td>${formatCurrency(row.endingValue)}</td>
<td>${formatCurrency(row.cumulativeFees)}</td>
<td>${formatCurrency(row.cumulativeDividendTaxes)}</td>
<td>${formatCurrency(row.cumulativeCapitalGainsTaxes)}</td>
<td>${formatCurrency(row.annualFees)}</td>
<td>${formatCurrency(row.annualDividendTaxes)}</td>
<td>${formatCurrency(row.annualCapitalGainsTaxes)}</td>
</tr>`,
		)
		.join("");

	return `${header}<table>${tableHeader}${tableRows}</table>`;
}

export const htmlStyles = `<style>
table {
	border-collapse: collapse;
	width: 100%;
	margin-bottom: 1rem;
}
th, td {
	border: 1px solid #ddd;
	padding: 8px;
	text-align: right;
}
th {
	background-color: #f2f2f2;
}

body {
	font-family: Arial, sans-serif;
	padding: 20px;
}

th:first-child, td:first-child,
th:nth-child(2), td:nth-child(2) {
	text-align: left;
}

ul {
	padding-left: 20px;
}
</style>`;

function buildScenarioDetailLines(scenario: Scenario): string[] {
	return [
		`Start year: ${scenario.startYear}`,
		`Years: ${scenario.years}`,
		`Annual contribution: ${formatCurrency(scenario.annualContribution)}`,
		`Contribution timing: ${capitalize(scenario.contributionTiming)}`,
		`Dividend tax rate: ${formatPercent(scenario.dividendTaxRate)}`,
		`Long-term capital gains tax rate: ${formatPercent(scenario.longTermCapitalGainsTaxRate)}`,
		`Taxes paid from account: ${formatBoolean(scenario.taxesPaidFromAccount)}`,
		`Assume rebalance sales are long term: ${formatBoolean(scenario.assumeRebalanceSalesAreLongTerm)}`,
		`Rebalance policy: ${describeRebalancePolicy(scenario.rebalanceEveryNYears)}`,
	];
}

function describeHolding(holding: Holding, fund: Fund): string {
	const start = holding.startWeight;
	const end = holding.endWeight;
	const weightText = start === end
		? `weight ${formatPercent(start)}`
		: `weight ${formatPercent(start)} -> ${formatPercent(end)}`;

	return `${fund.symbol} (${fund.name}) | ${weightText} | return ${formatPercent(fund.annualReturn)} | expense ${formatPercent(fund.expenseRatio)} | dividend ${formatPercent(fund.dividendYield)} | cap gains dist ${formatPercent(fund.capitalGainsDistributionYield)}`;
}

function getTargetWeightsForYear(scenario: Scenario, yearOffset: number): number[] {
	const ratio = scenario.years <= 1 ? 0 : yearOffset / (scenario.years - 1);

	return scenario.holdings.map((holding) => {
		const start = holding.startWeight;
		const end = holding.endWeight;
		return start + (end - start) * ratio;
	});
}

function describeRebalancePolicy(rebalanceEveryNYears: number): string {
	if (!Number.isFinite(rebalanceEveryNYears)) {
		return "None";
	}

	if (rebalanceEveryNYears === 1) {
		return "Every 1 year";
	}

	return `Every ${rebalanceEveryNYears} years`;
}

function formatCurrency(value: number): string {
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
		maximumFractionDigits: 2,
	}).format(value);
}

function formatPercent(value: number): string {
	return new Intl.NumberFormat("en-US", {
		style: "percent",
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(value);
}

function formatBoolean(value: boolean): string {
	return value ? "Yes" : "No";
}

function capitalize(value: string): string {
	return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}