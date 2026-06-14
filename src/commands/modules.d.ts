declare module 'asciichart' {
    export interface PlotConfig {
        offset?: number;
        padding?: string;
        height?: number;
        colors?: string[];
        min?: number;
        max?: number;
        symbols?: string[];
        format?: (x: number, i: number) => string;
    }

    export function plot(series: number[] | number[][], cfg?: PlotConfig): string;

    export const black: string;
    export const red: string;
    export const green: string;
    export const yellow: string;
    export const blue: string;
    export const magenta: string;
    export const cyan: string;
    export const lightgray: string;
    export const darkgray: string;
    export const white: string;
    export const reset: string;

    export default { plot, black, red, green, yellow, blue, magenta, cyan, lightgray, darkgray, white, reset };
}