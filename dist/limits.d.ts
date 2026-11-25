import { type Address } from "viem";
import { type BasisClient } from "basis-sdk";
export interface Spend {
    token: Address;
    raw: bigint;
}
export declare function checkSpendTotal(client: BasisClient, spends: readonly Spend[]): Promise<void>;
export declare function checkSpend(client: BasisClient, token: Address, raw: bigint): Promise<void>;
