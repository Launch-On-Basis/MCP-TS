import { type BasisClient } from "basis-sdk";
export interface LocalImage {
    bytes: Uint8Array;
    filename: string;
}
export declare function readLocalImage(path: string, field?: string): Promise<LocalImage>;
export declare const IMAGE_FILE_TEXT: string;
export declare function httpsLink(url: string, field: string): string;
export declare function imageFromUrl(_client: BasisClient, url: string, field?: string): Promise<{
    bytes: Uint8Array;
    filename: string;
    resized: boolean;
}>;
