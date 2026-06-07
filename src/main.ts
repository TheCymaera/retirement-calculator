import { htmlScenario, htmlStyles, printScenario, simulateScenario, validateScenario, type Security, type Scenario } from "./calculator.js";
import { cached } from "./cache.js";
import { Duration } from "./Duration.js";
import YahooFinance from "yahoo-finance2";

function lerp(start: number, end: number, t: number): number {
	return start + t * (end - start);
}

const yahooFinance = new YahooFinance();

const securityOverrides: Record<string, Partial<Security>> = {
	"VLXVX": {
		annualReturn: ({ progress }) => lerp(0.08, 0.04, progress),
		//annualReturn: ({ progress }) => lerp(0.10, 0.05, progress),
		dividendYield: ({ progress }) => lerp(0.018, 0.03, progress),
	},
};

const securities: Record<string, Security> = {};

const scenarios: Scenario[] = [
	{
		name: "Auto-Rebalancing Target Fund",
		startYear: 2026,
		years: 72 - 26 + 1,
		annualContribution: 7_500,
		contributionTiming: "start",
		dividendTaxRate: 0.30,
		longTermCapitalGainsTaxRate: 0.0,
		taxesPaidFromAccount: true,
		assumeRebalanceSalesAreLongTerm: true,
		rebalanceEveryNYears: Number.POSITIVE_INFINITY,
		holdings: [
			{ securityId: "VLXVX", weight: () => 1 },
		],
		securities,
	},
	{
		name: "Portfolio With Manual Rebalance",
		startYear: 2026,
		years: 72 - 26 + 1,
		annualContribution: 7_500,
		contributionTiming: "start",
		dividendTaxRate: 0.30,
		longTermCapitalGainsTaxRate: 0.0,
		taxesPaidFromAccount: true,
		assumeRebalanceSalesAreLongTerm: true,
		rebalanceEveryNYears: 5,
		holdings: [
			{ securityId: "VOO", weight: ({ progress }) => lerp(0.5, 0.3, progress) },
			{ securityId: "VXUS", weight: ({ progress }) => lerp(0.3, 0.15, progress) },
			{ securityId: "BND", weight: ({ progress }) => lerp(0.15, 0.35, progress) },
			{ securityId: "BNDX", weight: ({ progress }) => lerp(0.05, 0.2, progress) },
		],
		securities,
	},
];

const getCachedQuote = cached("yahoo:quote", async (symbol: string) => {
	return await yahooFinance.quote(symbol);
}).withOptions({ maxAge: Duration.days(1) });

const getCachedQuoteSummary = cached("yahoo:quoteSummary", async (symbol: string) => {
	try {
		return await yahooFinance.quoteSummary(symbol, {
			modules: ["defaultKeyStatistics", "fundProfile", "summaryDetail", "price"],
		});
	} catch (error) {
		console.warn(`Quote summary for ${symbol} produced a validation error`);
		// @ts-expect-error
		return error.result;
	}
}).withOptions({ maxAge: Duration.days(1) });

async function fetchSecuritiesInfo(symbol: string): Promise<Security> {
	const [quoteResult, quoteSummaryResult] = await Promise.all([
		getCachedQuote(symbol),
		getCachedQuoteSummary(symbol),
	]);

	const quote = quoteResult.data;
	const quoteSummary = quoteSummaryResult.data;

	const name = quote.longName ?? symbol;
	const fetchedAnnualReturn = quoteSummary.defaultKeyStatistics.fiveYearAverageReturn;
	const expenseRatio = quote.netExpenseRatio / 100;
	const dividendYield = quote.dividendYield / 100;

	return {
		symbol,
		name,
		annualReturn: () => fetchedAnnualReturn,
		expenseRatio,
		dividendYield: () => dividendYield,
		capitalGainsDistributionYield: 0,
	};
}

// fill in missing securities and fields
const allSymbols = new Set<string>();
for (const scenario of scenarios) {
	for (const holding of scenario.holdings) {
		allSymbols.add(holding.securityId);
	}
}

await Promise.all([...allSymbols].map(async (symbol) => {
	const data = await fetchSecuritiesInfo(symbol);
	Object.assign(data, securityOverrides[symbol] ?? {});
	securities[symbol] = data;

	if (!Number.isFinite(data.annualReturn({ year: 2026, progress: 0 }))) {
		throw new Error(`Missing 5-year average return for ${symbol}`);
	}
	if (!Number.isFinite(data.expenseRatio)) {
		throw new Error(`Missing expense ratio for ${symbol}`);
	}
	if (!Number.isFinite(data.dividendYield({ year: 2026, progress: 0 }))) {
		throw new Error(`Missing dividend yield for ${symbol}`);
	}
}));

for (const scenario of scenarios) {
	validateScenario(scenario);
	const rows = simulateScenario(scenario);
	printScenario(scenario, rows);

	const html = htmlScenario(scenario, rows) + htmlStyles;

	await Bun.write(`./output/${scenario.name.replace(/\s+/g, "_")}.html`, html);
}