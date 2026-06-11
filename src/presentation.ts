import type { Scenario, YearRow, Holding, Security } from "./calculator.js";
import { dedent } from "./utilities/dedent.js";

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
	const tabs = `
		<ul class="tabs">
			${options.map((i, index) => 
				`<li><a href="#scenario-${index}">${escapeHtml(i.scenario.name)}</a></li>`
			).join("")}
		</ul>`;

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

	const sections = `
		<div>
			${options.map((i) => 
				`<div class="scenario" style="display: none;">${htmlScenario(i.scenario, i.rows)}</div>`
			).join("")}
		</div>
	`;

	return `${htmlStyles}${tabs}${sections}${js}`;
}

const formatGlide = (start: number, end: number, formatter: typeof formatPercent) => {
	if (Math.abs(start - end) < 0.000001) {
		return formatter(start);
	}

	return `${formatter(start)} → ${formatter(end)}`;
};

export function htmlScenario(scenario: Scenario, rows: YearRow[]): string {
	const startYear = rows[0]!.year;
	const endYear = rows[rows.length - 1]!.year;

	const holdings = scenario.holdings
		.map((holding) => {
			const security = scenario.securities[holding.securityId]!;

			const startWeight = holding.weight({ year: startYear, progress: 0 });
			const endWeight = holding.weight({ year: endYear, progress: 1 });
			const weightText = formatGlide(startWeight, endWeight, formatPercent);
			
			const returnStart = security.annualReturn({ year: startYear, progress: 0 });
			const returnEnd = security.annualReturn({ year: endYear, progress: 1 });
			const returnText = formatGlide(returnStart, returnEnd, formatPercent);

			const dividendStart = security.dividendYield({ year: startYear, progress: 0 });
			const dividendEnd = security.dividendYield({ year: endYear, progress: 1 });
			const dividendText = formatGlide(dividendStart, dividendEnd, formatPercent);
			return dedent`
				<tr>
					<td style="text-align: left;">${escapeHtml(security.symbol)}</td>
					<td style="text-align: left;">${escapeHtml(security.name)}</td>
					<td>${weightText}</td>
					<td>${returnText}</td>
					<td>${formatPercent(security.expenseRatio)}</td>
					<td>${dividendText}</td>
					<td>${formatPercent(security.capitalGainsDistributionYield)}</td>
				</tr>
			`;
		})
		.join("");

	return dedent`
		<h2>${escapeHtml(scenario.name)}</h2>
		
		<h3>Scenario Details</h3>
		<ul>
			${buildScenarioDetailLines(scenario).map((line) => `<li>${escapeHtml(line)}</li>`).join("")}
		</ul>

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
		</table>

		<table>
			<tr>
				<th>Year</th>
				<th>Ending Value</th>
				<th>Total Fees</th>
				<th>Dividend Taxes</th>
				<th>LTCG Taxes</th>
				<th>Fees This Year</th>
				<th>Dividend Tax This Year</th>
				<th>LTCG Tax This Year</th>
			</tr>
			${
				rows.map((row) => dedent`
					<tr>
						<td style="text-align: left;">${row.year}</td>
						<td>${formatCurrency(row.endingValue)}</td>
						<td>${formatCurrency(row.cumulativeFees)}</td>
						<td>${formatCurrency(row.cumulativeDividendTaxes)}</td>
						<td>${formatCurrency(row.cumulativeCapitalGainsTaxes)}</td>
						<td>${formatCurrency(row.annualFees)}</td>
						<td>${formatCurrency(row.annualDividendTaxes)}</td>
						<td>${formatCurrency(row.annualCapitalGainsTaxes)}</td>
					</tr>`
				).join("")
			}
		</table>
	`;
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