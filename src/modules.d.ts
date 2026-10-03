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

// 前端资源以文本模块导入（见 wrangler.toml 的 [[rules]]）。
// 放在独立文件里就不必再写进模板字符串，反斜杠不会被吃掉，
// 也能直接对这些文件跑语法检查和格式化。
declare module '*.css' {
    const content: string;
    export default content;
}

declare module '*.js' {
    const content: string;
    export default content;
}
