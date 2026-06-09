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

export function printScenario(scenario: Scenario, rows: YearRow[]): void {
	const startYear = rows[0]!.year;
	const endYear = rows[rows.length - 1]!.year;
	console.log(`\n${scenario.name}`);
	for (const line of buildScenarioDetailLines(scenario)) {
		console.log(line);
	}
	console.log("Holdings:");
	for (const holding of scenario.holdings) {
		console.log(`  - ${describeHolding(holding, scenario.securities[holding.securityId]!, startYear, endYear)}`);
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

export function htmlScenarios(options: { scenario: Scenario, rows: YearRow[] }[]) {
	const tabs = `<ul class="tabs">` + options.map((i, index) => `<li><a href="#scenario-${index}">${escapeHtml(i.scenario.name)}</a></li>`).join("") + `</ul>`;

	const js = `<script>
		const loadTab = () => {
			const hash = window.location.hash;
			const match = hash.match(/scenario-(\\d+)/) || [];
			const index = match[1] ? parseInt(match[1], 10) : 0;
			document.querySelectorAll('.scenario').forEach((el, i) => {
				el.style.display = i === index ? 'block' : 'none';
			});

			
			document.querySelectorAll('.tabs a').forEach((anchor, i) => {
				anchor.toggleAttribute('aria-current', i === index);
			});
		};

		addEventListener('hashchange', loadTab);
		loadTab();
	</script>`;

	const sections = `<div>${options.map((i) => `<div class="scenario" style="display: none;">${htmlScenario(i.scenario, i.rows)}</div>`).join("")}</div>${js}`;

	return `${htmlStyles}${tabs}${sections}`;
}

export function htmlScenario(scenario: Scenario, rows: YearRow[]): string {
	const startYear = rows[0]!.year;
	const endYear = rows[rows.length - 1]!.year;
	const details = buildScenarioDetailLines(scenario)
		.map((line) => `<li>${escapeHtml(line)}</li>`)
		.join("");
	const holdings = scenario.holdings
		.map((holding) => {
			const security = scenario.securities[holding.securityId]!;
			const startWeight = holding.weight({ year: startYear, progress: 0 });
			const endWeight = holding.weight({ year: endYear, progress: 1 });
			const weightText = Math.abs(startWeight - endWeight) < 0.000001
				? formatPercent(startWeight)
				: `${formatPercent(startWeight)} → ${formatPercent(endWeight)}`;
			
			const returnStart = security.annualReturn({ year: startYear, progress: 0 });
			const returnEnd = security.annualReturn({ year: endYear, progress: 1 });
			const returnText = Math.abs(returnStart - returnEnd) < 0.000001
				? formatPercent(returnStart)
				: `${formatPercent(returnStart)} → ${formatPercent(returnEnd)}`;
			const dividendStart = security.dividendYield({ year: startYear, progress: 0 });
			const dividendEnd = security.dividendYield({ year: endYear, progress: 1 });
			const dividendText = Math.abs(dividendStart - dividendEnd) < 0.000001
				? formatPercent(dividendStart)
				: `${formatPercent(dividendStart)} → ${formatPercent(dividendEnd)}`;
			return `<tr>
<td style="text-align: left;">${escapeHtml(security.symbol)}</td>
<td style="text-align: left;">${escapeHtml(security.name)}</td>
<td>${weightText}</td>
<td>${returnText}</td>
<td>${formatPercent(security.expenseRatio)}</td>
<td>${dividendText}</td>
<td>${formatPercent(security.capitalGainsDistributionYield)}</td>
</tr>`;
		})
		.join("");

	const header = `<h2>${escapeHtml(scenario.name)}</h2>
<h3>Scenario Details</h3>
<ul>${details}</ul>
<h3>Allocation</h3>
<table>
<tr>
<th>Symbol</th>
<th>Name</th>
<th>Weight</th>
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
<td style="text-align: left;">${row.year}</td>
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
	text-wrap: nowrap;
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

ul {
	padding-left: 20px;
}

a[aria-current] {
	color: rgb(115, 0, 0);
	font-weight: bold;
}
</style>`;

function buildScenarioDetailLines(scenario: Scenario): string[] {
	const inferredCapitalGainsTax = inferCapitalGainsTaxDisplay(
		scenario,
		scenario.timeline.startYear,
		scenario.timeline.startYear + scenario.timeline.years - 1,
	);

	return [
		`Start year: ${scenario.timeline.startYear}`,
		`Years: ${scenario.timeline.years}`,
		`Annual contribution: ${formatCurrency(scenario.timeline.annualContribution)}`,
		`Contribution timing: ${capitalize(scenario.timeline.contributionTiming)}`,
		`Dividend tax rate: ${formatPercent(scenario.tax.dividendTaxRate)}`,
		`Long-term capital gains tax: ${inferredCapitalGainsTax}`,
		`Taxes paid from account: ${formatBoolean(scenario.tax.taxesPaidFromAccount)}`,
		`Rebalance policy: ${describeRebalancePolicy(scenario.timeline.rebalanceEveryNYears)}`,
	];
}

function describeHolding(holding: Holding, security: Security, startYear: number, endYear: number): string {
	const start = holding.weight({ year: startYear, progress: 0 });
	const end = holding.weight({ year: endYear, progress: 1 });
	const weightText = Math.abs(start - end) < 0.000001
		? `weight ${formatPercent(start)}`
		: `weight ${formatPercent(start)} -> ${formatPercent(end)}`;
	const returnStart = security.annualReturn({ year: startYear, progress: 0 });
	const returnEnd = security.annualReturn({ year: endYear, progress: 1 });
	const returnText = Math.abs(returnStart - returnEnd) < 0.000001
		? formatPercent(returnStart)
		: `${formatPercent(returnStart)} -> ${formatPercent(returnEnd)}`;
	const dividendStart = security.dividendYield({ year: startYear, progress: 0 });
	const dividendEnd = security.dividendYield({ year: endYear, progress: 1 });
	const dividendText = Math.abs(dividendStart - dividendEnd) < 0.000001
		? formatPercent(dividendStart)
		: `${formatPercent(dividendStart)} -> ${formatPercent(dividendEnd)}`;

	return `${security.symbol} (${security.name}) | ${weightText} | return ${returnText} | expense ${formatPercent(security.expenseRatio)} | dividend ${dividendText} | cap gains dist ${formatPercent(security.capitalGainsDistributionYield)}`;
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

function inferCapitalGainsTaxDisplay(scenario: Scenario, startYear: number, endYear: number): string {
	const sampleGains = [1000, 10000, 100000];
	const sampleContexts = [
		{ year: startYear, progress: 0 },
		{ year: Math.floor((startYear + endYear) / 2), progress: 0.5 },
		{ year: endYear, progress: 1 },
	];

	let inferredRate: number | undefined;
	for (const context of sampleContexts) {
		for (const realizedGains of sampleGains) {
			const tax = scenario.tax.capitalGainsTax({
				year: context.year,
				progress: context.progress,
				realizedGains,
			});

			if (!Number.isFinite(tax) || tax < 0) {
				return "CUSTOM";
			}

			const rate = tax / realizedGains;
			if (!Number.isFinite(rate)) {
				return "CUSTOM";
			}

			if (inferredRate === undefined) {
				inferredRate = rate;
				continue;
			}

			if (Math.abs(rate - inferredRate) > 0.000001) {
				return "CUSTOM";
			}
		}
	}

	if (inferredRate === undefined) {
		return "CUSTOM";
	}

	return formatPercent(inferredRate);
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

export function formatCurrency(value: number): string {
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