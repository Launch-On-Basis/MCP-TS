import { ValidationError } from "basis-sdk";
export declare class GuidedError extends Error {
    readonly txHash?: `0x${string}` | undefined;
    constructor(message: string, txHash?: `0x${string}` | undefined);
}
export declare class NotSentError extends GuidedError {
    constructor(message: string);
}
export declare function redactUrls(text: string): string;
export declare function clean(text: string): string;
export declare function ruleText(e: ValidationError): string | null;
export interface ErrorContext {
    explorerUrl?: string;
    notLinked?: boolean;
    signInProblem?: string;
}
export declare function errorText(e: unknown, ctx?: ErrorContext | string): string;
