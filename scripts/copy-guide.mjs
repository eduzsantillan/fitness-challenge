import { copyFileSync } from 'node:fs';
copyFileSync(new URL('../docs/ATAJOS.md', import.meta.url), new URL('../web/public/guia-atajos.md', import.meta.url));
