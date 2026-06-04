import { htmlScenario, htmlStyles, printScenario, simulateScenario, validateScenario, type Security, type Scenario } from "./calculator";

const securities = {
	VLXVX: {
		symbol: "VLXVX",
		name: "Vanguard Target Retirement Fund",
		annualReturn: 0.0868,
		expenseRatio: 0.2032,
		dividendYield: 0.021,
		capitalGainsDistributionYield: 0.0,
	},
	VT: {
		symbol: "VT",
		name: "Vanguard Total World Stock ETF",
		annualReturn: 0.124,
		expenseRatio: 0.0006,
		dividendYield: 0.0159,
		capitalGainsDistributionYield: 0.0,
	},
	VOO: {
		symbol: "VOO",
		name: "Vanguard S&P 500 ETF",
		annualReturn: 0.156,
		expenseRatio: 0.0003,
		dividendYield: 0.0125,
		capitalGainsDistributionYield: 0.0,
	},
	VXUS: {
		symbol: "VXUS",
		name: "Vanguard Total International Stock ETF",
		annualReturn: 0.0851,
		expenseRatio: 0.0005,
		dividendYield: 0.027,
		capitalGainsDistributionYield: 0.0,
	},
	BND: {
		symbol: "BND",
		name: "Vanguard Total Bond Market ETF",
		annualReturn: 0.0018,
		expenseRatio: 0.0003,
		dividendYield: 0.032,
		capitalGainsDistributionYield: 0.0,
	},
	BNDX: {
		symbol: "BNDX",
		name: "Vanguard Total International Bond ETF",
		annualReturn: 0.0408,
		expenseRatio: 0.0007,
		dividendYield: 0.028,
		capitalGainsDistributionYield: 0.0,
	},
} satisfies Record<string, Security>;

const scenarios = [
	{
		name: "Auto-Rebalancing Target Fund",
		startYear: 2026,
		years: 72 - 26 + 1,
		annualContribution: 7_500,
		contributionTiming: "start",
		dividendTaxRate: 0.15,
		longTermCapitalGainsTaxRate: 0.15,
		taxesPaidFromAccount: true,
		assumeRebalanceSalesAreLongTerm: true,
		rebalanceEveryNYears: Number.POSITIVE_INFINITY,
		holdings: [
			{ securityId: securities.VLXVX.symbol, startWeight: 1, endWeight: 1 },
		],
		securities: securities,
	},
	{
		name: "Portfolio With Manual Rebalance",
		startYear: 2026,
		years: 72 - 26 + 1,
		annualContribution: 7_500,
		contributionTiming: "start",
		dividendTaxRate: 0.15,
		longTermCapitalGainsTaxRate: 0.15,
		taxesPaidFromAccount: true,
		assumeRebalanceSalesAreLongTerm: true,
		rebalanceEveryNYears: 5,
		holdings: [
			{ securityId: securities.VOO.symbol, startWeight: 0.5, endWeight: 0.3 },
			{ securityId: securities.VXUS.symbol, startWeight: 0.3, endWeight: 0.15 },
			{ securityId: securities.BND.symbol, startWeight: 0.15, endWeight: 0.35 },
			{ securityId: securities.BNDX.symbol, startWeight: 0.05, endWeight: 0.2 },
		],
		securities: securities,
	},
] satisfies Scenario[];

for (const scenario of scenarios) {
	validateScenario(scenario);
	const rows = simulateScenario(scenario);
	printScenario(scenario, rows);

	const html = htmlScenario(scenario, rows) + htmlStyles;

	// @ts-expect-error Bun types not installed
	Bun.write(`./output/${scenario.name.replace(/\s+/g, "_")}.html`, html);
}