import { htmlScenario, htmlStyles, printScenario, simulateScenario, validateScenario, type Security, type Scenario, htmlScenarios, formatCurrency } from "./calculator.js";
import { cached } from "./cache.js";
import { Duration } from "./Duration.js";
import YahooFinance from "yahoo-finance2";
import type { QuoteSummaryResult } from "yahoo-finance2/modules/quoteSummary";
import { createAusCapitalGainsTax, createFlatCapitalGainsTax } from "./tax.js";

function lerp(start: number, end: number, t: number): number {
	return start + t * (end - start);
}

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

const securityOverrides: Record<string, Partial<Security>> = {
	"VLXVX": {
		annualReturn: ({ progress }) => lerp(0.1025, 0.04, progress),
		dividendYield: ({ progress }) => lerp(0.018, 0.04, progress),
	},
};

const securities: Record<string, Security> = {};

// timeline
const timeline = {
	startYear: 2026,
	years: 72 - 26 + 1,
	annualContribution: 7_500,
	contributionTiming: "start",
	rebalanceEveryNYears: 5,
} satisfies Scenario["timeline"];

const autoRebalanceTimeline = {
	...timeline,
	rebalanceEveryNYears: Infinity,
} satisfies Scenario["timeline"];

// tax
const hkWithUsDomiciledTax = {
	dividendTaxRate: 0.30,
	capitalGainsTax: createFlatCapitalGainsTax(0.0),
	taxesPaidFromAccount: true,
} satisfies Scenario["tax"];

const ausWithUsDomiciledTax = {
	dividendTaxRate: 0.15,
	capitalGainsTax: createAusCapitalGainsTax({ isResident: true }),
	taxesPaidFromAccount: true,
} satisfies Scenario["tax"];

const hkWithIrelandDomiciledTax = {
	dividendTaxRate: 0.0, // 15% withholding already handled by fund
	capitalGainsTax: createFlatCapitalGainsTax(0.0),
	taxesPaidFromAccount: true,
} satisfies Scenario["tax"];

// scenarios
const autoBalancingFundHK = {
	name: "Auto-Rebalancing Target Fund via HK",
	timeline: autoRebalanceTimeline,
	tax: hkWithUsDomiciledTax,
	securities,
	holdings: [
		{ securityId: "VLXVX", weight: () => 1 },
	],
} satisfies Scenario;

const autoBalancingFundAus = {
	...autoBalancingFundHK,
	name: "Auto-Rebalancing Target Fund via Aus",
	tax: ausWithUsDomiciledTax,
} satisfies Scenario;

const usDomiciledManualRebalanceHK = {
	name: "US-Domiciled Portfolio with Manual Rebalance via HK",
	timeline,
	tax: hkWithUsDomiciledTax,
	securities,
	holdings: [
		{ securityId: "VOO", weight: ({ progress }) => lerp(0.5, 0.3, progress) },
		{ securityId: "VXUS", weight: ({ progress }) => lerp(0.3, 0.15, progress) },
		{ securityId: "BND", weight: ({ progress }) => lerp(0.15, 0.35, progress) },
		{ securityId: "BNDX", weight: ({ progress }) => lerp(0.05, 0.2, progress) },
	],
} satisfies Scenario;

const irelandDomiciledManualRebalanceHK = {
	name: "Ireland-Domiciled Portfolio with Manual Rebalance via HK",
	timeline,
	tax: hkWithIrelandDomiciledTax,
	securities,
	holdings: [
		{ securityId: "VUAA.L", weight: ({ progress }) => lerp(0.5, 0.3, progress) },
		{ securityId: "VWRA.L", weight: ({ progress }) => lerp(0.3, 0.15, progress) },
		{ securityId: "VAGU.L", weight: ({ progress }) => lerp(0.2, 0.55, progress) },
	],
} satisfies Scenario;

const scenarios: Scenario[] = [
	autoBalancingFundHK,
	autoBalancingFundAus,
	usDomiciledManualRebalanceHK,
	irelandDomiciledManualRebalanceHK,
];

const getCachedQuote = cached("yahoo:quote", async (symbol: string) => {
	return await yahooFinance.quote(symbol);
}).withOptions({ maxAge: Duration.days(Infinity) });

const getCachedQuoteSummary = cached("yahoo:quoteSummary", async (symbol: string) => {
	try {
		return await yahooFinance.quoteSummary(symbol, {
			modules: ["defaultKeyStatistics", "fundProfile", "summaryDetail", "price"],
		});
	} catch (error) {
		console.warn(`Quote summary for ${symbol} produced a validation error`);
		// @ts-expect-error
		const result = error.result as QuoteSummaryResult & { $isError?: boolean };
		if (result === undefined) throw new Error(`Failed to fetch quote summary for ${symbol}`);
		result.$isError = true;
		return result;
	}
}).withOptions({ maxAge: Duration.days(Infinity) });

async function fetchSecuritiesInfo(symbol: string): Promise<Partial<Security>> {
	const [quoteResult, quoteSummaryResult] = await Promise.all([
		getCachedQuote(symbol),
		getCachedQuoteSummary(symbol),
	]);

	const quote = quoteResult.data;
	const quoteSummary = quoteSummaryResult.data;

	const name = quote.longName ?? symbol;
	const fetchedAnnualReturn = quoteSummary.defaultKeyStatistics?.fiveYearAverageReturn ?? NaN;
	const expenseRatio = (quote.netExpenseRatio || 0) / 100;
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
	const fetched = await fetchSecuritiesInfo(symbol);
	const data = Object.assign(fetched, securityOverrides[symbol] ?? {}) as Security;
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

const results = scenarios.map(scenario => {
	validateScenario(scenario);
	const rows = simulateScenario(scenario);
	return { scenario, rows };
});

for (const { scenario, rows } of results) {
	printScenario(scenario, rows);
	const html = htmlScenario(scenario, rows) + htmlStyles;
	await Bun.write(`./output/${scenario.name.replace(/\s+/g, "_")}.html`, html);
}

console.group("Summary:")
for (const { scenario, rows } of results) {
	console.log(scenario.name + ': ' + formatCurrency(rows.at(-1)?.endingValue || 0));
}
console.groupEnd();



await Bun.write(`./output/+combined.html`, htmlScenarios(results) + htmlStyles);