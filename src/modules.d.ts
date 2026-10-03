// src/modules.d.ts
// 注意：这个文件不能叫 types.d.ts —— 同目录下已有 types.ts 时，
// TypeScript 会忽略同名的 .d.ts（视为编译产物的重复声明），声明就不生效。
declare module '*.html' {
    const content: string;
    export default content;
}

declare module '*.html?raw' {
    const content: string;
    export default content;
}
