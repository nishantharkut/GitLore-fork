import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const copies = [
  ["node_modules/d3/dist/d3.min.js", "vendor/d3.min.js"],
  ["node_modules/prismjs/components/prism-core.min.js", "vendor/prism-core.min.js"],
  ["node_modules/prismjs/components/prism-markup.min.js", "vendor/prism-markup.min.js"],
  ["node_modules/prismjs/components/prism-clike.min.js", "vendor/prism-clike.min.js"],
  ["node_modules/prismjs/components/prism-javascript.min.js", "vendor/prism-javascript.min.js"],
  ["node_modules/prismjs/components/prism-typescript.min.js", "vendor/prism-typescript.min.js"],
  ["node_modules/prismjs/components/prism-json.min.js", "vendor/prism-json.min.js"],
  ["node_modules/prismjs/components/prism-bash.min.js", "vendor/prism-bash.min.js"],
  ["node_modules/prismjs/components/prism-css.min.js", "vendor/prism-css.min.js"],
  ["node_modules/prismjs/themes/prism-tomorrow.min.css", "vendor/prism-tomorrow.min.css"],
  ["node_modules/marked/lib/marked.esm.js", "vendor/marked.esm.js"],
];

for (const [from, to] of copies) {
  const src = path.join(root, from);
  const dest = path.join(root, to);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log("copied", to);
}
