#!/usr/bin/env node
/**
 * 前端资源自检。
 *
 * src/app.js 和 src/style.css 不经过 TypeScript 编译，改坏了不会有任何编译期提示，
 * 所以这里把「改坏了自己不知道」的几类问题都固化成检查：语法、DOM 契约、
 * 事件契约、CSP 约束、缓存版本号、以及 wrangler 的 Text 模块规则。
 *
 * 用法：npm run check:frontend   （CI 里也会跑）
 */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let failed = 0;
const ok = (name, cond, detail = '') => {
    if (cond) {
        console.log(`  ✅ ${name}`);
    } else {
        failed++;
        console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
    }
};

const appJs = read('src/app.js');
const styleCss = read('src/style.css');
const template = read('src/template.html');
const wrangler = read('wrangler.toml');

console.log('\n[1/6] src/app.js 语法');
try {
    new vm.Script(appJs, { filename: 'src/app.js' });
    ok('可以被 JS 引擎解析', true);
} catch (e) {
    ok('可以被 JS 引擎解析', false, e.message);
}

console.log('\n[2/6] src/style.css 基本结构');
{
    const open = (styleCss.match(/\{/g) || []).length;
    const close = (styleCss.match(/\}/g) || []).length;
    ok('花括号配平', open === close, `{ ${open} 个 / } ${close} 个`);
    ok('没有遗留的占位符', !styleCss.includes('TODO_MISSING'));
}

console.log('\n[3/6] DOM 契约：app.js 用到的元素 id 必须存在于 template.html');
{
    const ids = new Set();
    for (const m of appJs.matchAll(/\$\(['"]([A-Za-z0-9_-]+)['"]\)/g)) ids.add(m[1]);
    for (const m of appJs.matchAll(/getElementById\(['"]([A-Za-z0-9_-]+)['"]\)/g)) ids.add(m[1]);
    // 有些元素是 JS 自己 createElement 出来的，模板里当然没有
    const created = new Set([...appJs.matchAll(/\.id\s*=\s*['"]([A-Za-z0-9_-]+)['"]/g)].map((m) => m[1]));
    const missing = [...ids].filter((id) => !template.includes(`id="${id}"`) && !created.has(id));
    ok(`${ids.size} 个 id 全部存在（其中 ${created.size} 个由 JS 动态创建）`, missing.length === 0,
       missing.length ? '缺失: ' + missing.join(', ') : '');
}

console.log('\n[4/6] 事件契约：每个 data-action 都要有同名函数');
{
    const actions = new Set([...template.matchAll(/data-action="([^"]+)"/g)].map((m) => m[1]));
    for (const m of appJs.matchAll(/data-action="([^"]+)"/g)) actions.add(m[1]);
    const noFn = [...actions].filter(
        (a) => !new RegExp(`(^|\\n)(async\\s+)?function ${a}\\s*\\(`).test(appJs)
    );
    ok(`${actions.size} 个 action 都有函数`, noFn.length === 0, noFn.length ? '缺失: ' + noFn.join(', ') : '');
}

console.log('\n[5/6] CSP 与缓存版本');
{
    const inline = [...template.matchAll(/\son(click|error|load|change|input)\s*=/gi)].map((m) => m[0].trim());
    ok('template.html 没有内联事件属性（CSP 要求 script-src \'self\'）', inline.length === 0, inline.join(', '));

    const jsVer = (template.match(/\/app\.js\?v=(\d+)/) || [])[1];
    const cssVer = (template.match(/\/style\.css\?v=(\d+)/) || [])[1];
    ok('app.js 与 style.css 的 ?v= 都存在且一致', !!jsVer && jsVer === cssVer, `app.js=v${jsVer} style.css=v${cssVer}`);
}

console.log('\n[6/6] wrangler 的 Text 模块规则');
{
    // 自定义 [[rules]] 会覆盖内置默认规则，漏写任何一个后缀都会在打包时才报错
    for (const glob of ['**/*.html', '**/*.css', '**/app.js']) {
        ok(`规则里包含 ${glob}`, wrangler.includes(glob));
    }
    ok('规则声明了 fallthrough', /fallthrough\s*=/.test(wrangler));
}

console.log(failed === 0 ? '\n全部通过 ✅\n' : `\n有 ${failed} 项失败 ❌\n`);
process.exit(failed === 0 ? 0 : 1);
