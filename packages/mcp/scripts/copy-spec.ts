// prepack: the model reference travels inside the package as spec/model-spec.md, copied from the repository's one copy (git-ignored here).
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const pkg = join(import.meta.dirname, '..');
mkdirSync(join(pkg, 'spec'), { recursive: true });
copyFileSync(join(pkg, '../../spec/model-spec.md'), join(pkg, 'spec/model-spec.md'));
