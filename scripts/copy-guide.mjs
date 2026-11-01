import { copyFileSync } from 'node:fs';
copyFileSync(new URL('../docs/ATAJOS.md', import.meta.url), new URL('../web/public/guia-atajos.md', import.meta.url));

copyFileSync(new URL('../docs/SHORTCUTS.md', import.meta.url), new URL('../web/public/shortcuts-guide.md', import.meta.url));
