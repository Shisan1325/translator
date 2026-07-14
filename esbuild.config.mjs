import { build, context } from 'esbuild';
import { readFile } from 'node:fs/promises';

const { version } = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));

const metadata = `// ==UserScript==
// @name         网页翻译助手 MVP
// @namespace    https://github.com/local/translator-userscript
// @version      ${version}
// @description  高性能、模块化的网页与划词翻译工具
// @author       MiaViaU
// @license      MIT
// @homepageURL   https://github.com/MiaViaU/translator
// @downloadURL   https://raw.githubusercontent.com/MiaViaU/translator/master/dist/translator.user.js
// @updateURL     https://raw.githubusercontent.com/MiaViaU/translator/master/dist/translator.user.js
// @match        *://*/*
// @grant        GM.xmlHttpRequest
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.registerMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      edge.microsoft.com
// @connect      api-edge.cognitive.microsofttranslator.com
// @run-at       document-idle
// @noframes
// ==/UserScript==`;

const options = {
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  target: ['es2022'],
  outfile: 'dist/translator.user.js',
  banner: { js: metadata },
  legalComments: 'none',
  sourcemap: false,
  minify: false,
};

if (process.argv.includes('--watch')) {
  const buildContext = await context(options);
  await buildContext.watch();
  console.log('正在监听 src/，按 Ctrl+C 停止。');
} else {
  await build(options);
  console.log('已生成 dist/translator.user.js');
}
