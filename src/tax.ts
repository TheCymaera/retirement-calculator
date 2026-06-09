import { type Scenario } from "./calculator.js";

export function createFlatCapitalGainsTax(rate: number): Scenario["tax"]["capitalGainsTax"] {
	return ({ realizedGains }) => realizedGains * rate;
}

export function createAusCapitalGainsTax({ isResident }: { isResident: boolean }): Scenario["tax"]["capitalGainsTax"] {
	return ({ realizedGains }) => {
		let taxableGains = realizedGains;
		if (isResident) {
			taxableGains = realizedGains * 0.50;
		}

		let tax = 0;
		if (isResident) {
			if (taxableGains <= 18200) {
				tax = 0;
			} else if (taxableGains <= 45000) {
				tax = (taxableGains - 18200) * 0.16;
			} else if (taxableGains <= 135000) {
				tax = 4288 + (taxableGains - 45000) * 0.30;
			} else if (taxableGains <= 190000) {
				tax = 31288 + (taxableGains - 135000) * 0.37;
			} else {
				tax = 51638 + (taxableGains - 190000) * 0.45;
			}
		} else {
			if (taxableGains <= 135000) {
				tax = taxableGains * 0.30;
			} else if (taxableGains <= 190000) {
				tax = 40500 + (taxableGains - 135000) * 0.37;
			} else {
				tax = 60850 + (taxableGains - 190000) * 0.45;
			}
		}

		return tax;
	};
}