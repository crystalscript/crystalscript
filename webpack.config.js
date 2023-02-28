import path from 'node:path';
import { fileURLToPath } from 'node:url';

const _scriptdir = path.dirname(fileURLToPath(import.meta.url));

export default (env, argv) => {
    return {
        mode: 'production',
        target: 'node',
        entry: './src/c2c.js',
        output: {
            path: path.resolve(path.join(_scriptdir, 'dist')),
            filename: 'c2c.cjs',
        },
    };
};

