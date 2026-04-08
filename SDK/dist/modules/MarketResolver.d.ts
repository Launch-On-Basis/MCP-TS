import { BasisClient } from '../BasisClient';
import { Address } from 'viem';
export declare class MarketResolverModule {
    private client;
    private resolverAddress;
    constructor(client: BasisClient, resolverAddress: Address);
    private _syncTx;
    private approveIfNeeded;
    /**
     * Proposes an outcome for a market.
     * Auto-approves USDB to the resolver for the PROPOSAL_BOND amount.
     * @param marketToken - prediction market token address
     * @param outcomeId - outcome index
     */
    proposeOutcome(marketToken: Address, outcomeId: number): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Disputes a proposed outcome.
     * Auto-approves USDB to the resolver for the PROPOSAL_BOND amount.
     * @param marketToken - prediction market token address
     * @param newOutcomeId - proposed alternative outcome index
     */
    dispute(marketToken: Address, newOutcomeId: number): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Casts a vote on a disputed market outcome.
     * @param marketToken - prediction market token address
     * @param outcomeId - outcome index to vote for
     */
    vote(marketToken: Address, outcomeId: number): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Stakes tokens to become a resolver voter.
     * Auto-approves the token to the resolver for MIN_STAKE_AMOUNT.
     * @param token - token contract address to stake
     */
    stake(token: Address): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Unstakes tokens, removing resolver voter status.
     * @param token - token contract address to unstake
     */
    unstake(token: Address): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Finalizes an uncontested market (proposal period expired without dispute).
     * @param marketToken - prediction market token address
     */
    finalizeUncontested(marketToken: Address): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Finalizes a disputed market after the dispute period.
     * @param marketToken - prediction market token address
     */
    finalizeMarket(marketToken: Address): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Vetoes a proposed outcome.
     * Auto-approves USDB to the resolver for the PROPOSAL_BOND amount.
     * @param marketToken - prediction market token address
     * @param proposedOutcome - outcome index being vetoed
     */
    veto(marketToken: Address, proposedOutcome: number): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Claims the bounty reward for voting correctly on a resolved market.
     * @param marketToken - prediction market token address
     */
    claimBounty(marketToken: Address): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Claims an early bounty reward for a specific dispute round.
     * @param marketToken - prediction market token address
     * @param round - dispute round number (integer)
     */
    claimEarlyBounty(marketToken: Address, round: bigint): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Returns the dispute data struct for a market.
     * @param marketToken - prediction market token address
     */
    getDisputeData(marketToken: Address): Promise<unknown>;
    /**
     * Returns whether a market has been resolved.
     * @param marketToken - prediction market token address
     */
    isResolved(marketToken: Address): Promise<boolean>;
    /**
     * Returns the final outcome of a resolved market.
     * @param marketToken - prediction market token address
     */
    getFinalOutcome(marketToken: Address): Promise<number>;
    /**
     * Returns whether a market is currently in a dispute.
     * @param marketToken - prediction market token address
     */
    isInDispute(marketToken: Address): Promise<boolean>;
    /**
     * Returns whether a market is currently in a veto period.
     * @param marketToken - prediction market token address
     */
    isInVeto(marketToken: Address): Promise<boolean>;
    /**
     * Returns the current dispute round for a market.
     * @param marketToken - prediction market token address
     */
    getCurrentRound(marketToken: Address): Promise<bigint>;
    /**
     * Returns the vote count for a specific outcome in a specific round.
     * @param marketToken - prediction market token address
     * @param round - dispute round number (integer)
     * @param outcomeId - outcome index
     */
    getVoteCount(marketToken: Address, round: bigint, outcomeId: number): Promise<bigint>;
    /**
     * Returns whether a voter has already voted in a specific round.
     * @param marketToken - prediction market token address
     * @param round - dispute round number (integer)
     * @param voter - voter wallet address
     */
    hasVoted(marketToken: Address, round: bigint, voter: Address): Promise<boolean>;
    /**
     * Returns the outcome a voter chose in a specific round.
     * @param marketToken - prediction market token address
     * @param round - dispute round number (integer)
     * @param voter - voter wallet address
     */
    getVoterChoice(marketToken: Address, round: bigint, voter: Address): Promise<number>;
    /**
     * Returns the bounty amount per correct vote for a resolved market.
     * @param marketToken - prediction market token address
     */
    getBountyPerVote(marketToken: Address): Promise<bigint>;
    /**
     * Returns whether a voter has already claimed the bounty for a market.
     * @param marketToken - prediction market token address
     * @param voter - voter wallet address
     */
    hasClaimed(marketToken: Address, voter: Address): Promise<boolean>;
    /**
     * Returns the staked amount for a voter.
     * @param voter - voter wallet address
     */
    getUserStake(voter: Address): Promise<bigint>;
    /**
     * Returns whether an address is a registered voter.
     * @param voter - voter wallet address
     */
    isVoter(voter: Address): Promise<boolean>;
    /**
     * Returns all system configuration constants.
     */
    getConstants(): Promise<{
        disputePeriod: bigint;
        proposalPeriod: bigint;
        proposalBond: bigint;
        minStakeAmount: bigint;
    }>;
}
