#!/usr/bin/env node

// Copyright (C) 2023 Keith Woodard
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

//
// This is the Crystal Script to Clarity compiler
//

import fs from 'node:fs';
import path from 'node:path';

import compiler from './crystal-ast.cjs';
import comments_compiler from './crystal-comments.cjs';

import {
    ast_merge_comments
} from './ast_comments.js';

import {
    validate_functions,
    globalize_inner_functions
} from './ast_functions.js';

import {
    optm_remove_unreachable,
    optm_remove_nop
} from './ast_optimize.js';

import {
    determine_types
} from './ast_types.js';

import {
    validate_trait_implementations
} from './ast_traits.js';

import {
    to_clarity
} from './ast_to_clarity.js';

import {
    generate_import_file,
    merge_imports
} from './ast_import_file.js';

import {
    safeStringify,
} from './ast_util.js';

import {
    TestFailure
} from './test_exceptions.js';

import {
    process_cmdline
} from './c2c_opts.js';

import ClarityCli from './ClarityCli.js';
import run_tests from './clar_test_runner.js';




var opts = process_cmdline();

try {
    var input = fs.readFileSync(opts.src).toString();
    if (opts.run_tests) {
        var re = /\n\/\/\s*EXPECT:\s*(.*)/;
        var match = input.match(re);
        if (match) opts.testing.expect_exception = match[1];
    }
} catch(e) {
    if (opts.debug) throw e;
    console.error(''+e);
    process.exit(1);
}



//
// compile
//
if (opts.compile) {
    if (opts.debug || opts.run_tests) {
        console.log('');
        console.log('-'.repeat(opts.src.length +9));
        console.log(`compile ${opts.src}`);
        console.log('-'.repeat(opts.src.length +9));
    }
    else
        console.log(`compile ${opts.src}`);

    try {
        opts.clar_fd = fs.openSync(opts.clar_file, 'w');
        if (opts.contract_name) opts.clar_import_fd =
            fs.openSync(opts.clar_import_file, 'w');

        compile(opts, input);
        console.log(`saved: ${opts.clar_file}`);

        // handle embedded "// EXPECT: <exception>"
        if (opts.run_tests && opts.testing.expect_exception) {
            if (opts.testing.expect_exception != 'success')
            {
                throw new TestFailure(`Expecting compilation to fail with '${opts.testing.expect_exception}', but compilation succeeded`);
            }
            else {
                console.log(`SUCCESS (expected success})`);
            }
        }
        
    }
    
    catch(e) {
        if (! (e instanceof TestFailure)) {
            if (opts.run_tests && e.name == opts.testing.expect_exception) {
                console.log(`SUCCESS: ${e.name} (${e.toString().replaceAll('\n',' ')})`);
                process.exit(0);
            }
        }
        if (opts.debug) throw e;
        console.error(''+e);
        process.exit(2);
    }

    finally {
        fs.closeSync(opts.clar_fd);
        if (opts.clar_import_fd !== null) {
            var size = fs.fstatSync(opts.clar_import_fd).size;
            fs.closeSync(opts.clar_import_fd);
            if (size==0) fs.unlinkSync(opts.clar_import_file);
            else console.log(`saved: ${opts.clar_import_file}`);
        }
        else if (fs.existsSync(opts.clar_import_file))
            fs.unlinkSync(opts.clar_import_file);        
    }
}

if (opts.debug)
    console.log(fs.readFileSync(opts.clar_file).toString());


//
// check syntax
//
if (opts.syntax_check) {
    console.log('');
    console.log(`check syntax with clarity-cli`);
    try {
        var cli = new ClarityCli(
            opts.clarity_cli,
            path.join(opts.tmp_dir, 'syntax_check_db')
        );
        cli.newdb();
        var json = cli.syntax_check(opts.clar_file);
        console.log(`SUCCESS: ${safeStringify(json)}`);
    } catch(e) {
        if (opts.debug) throw e;
        console.error(''+e);
        process.exit(3);
    }
}

//
// run tests
//
if (opts.run_tests) {
    console.log('');
    console.log('run tests');
    var test_opts = {
        clarity_cli: opts.clarity_cli,
        clarity_db: path.join(opts.tmp_dir, 'test_db'),
        tmp_dir: opts.tmp_dir,
        clar_file: opts.clar_file,
        newdb: opts.testing.newdb,
        sender_addr: opts.testing.sender_addr,
        contract_name: opts.contract_name,
        debug: opts.debug
    };
    var result = run_tests(test_opts, input);
    console.log('');
    console.log(`${result.count} tests, ${result.num_failure} failures, ${result.num_success} successes`);
    process.exit(result.num_failure > 0 ? 4 : 0);
}



function compile(opts, input) {
    //
    // compile
    //
    var ast = new compiler.Parser().parse(input);
    var comments = new comments_compiler.Parser().parse(input);

    // merge comments - returns end-of-file comments
    comments = ast_merge_comments(ast, comments);

    // load and merge all 'import' statements
    merge_imports(ast, opts);

    // validate functions and get type determination order
    var func_dep_order = validate_functions(ast);

    // optimizations
    optm_remove_unreachable(ast);
    optm_remove_nop(ast);

    // calculate all types
    determine_types(opts, ast, func_dep_order);

    // validate that trait requirements are fulfilled
    validate_trait_implementations(ast);
    
    // globalize inner functions - must be done after determining types
    globalize_inner_functions(ast);

    // remove nop's
    optm_remove_nop(ast);

    // generate clarity output
    if (opts.clar_fd) {
        if (opts.contract_name)
            fs.writeFileSync(opts.clar_fd,
                             `;; contract: ${opts.contract_name}\n`);
        fs.writeFileSync(opts.clar_fd,
                         `;; generated from ${path.basename(opts.src)}\n`);
        fs.writeFileSync(opts.clar_fd, `\n`);
    }
    
    to_clarity(ast, output => {
        if (opts.clar_fd) {
            fs.writeFileSync(opts.clar_fd, output);
        }
    });

    // append end-of-file comments
    if (comments.length > 0) {
        fs.writeFileSync(opts.clar_fd, '\n');
        comments.forEach(comment => {
            fs.writeFileSync(opts.clar_fd, comment.c);
            fs.writeFileSync(opts.clar_fd, '\n');
        });
    }

    // generate import file
    if (opts.contract_name && opts.clar_import_fd !== null) {
        generate_import_file(ast, opts.contract_name, output => {
            if (opts.clar_import_fd) {
                fs.writeFileSync(opts.clar_import_fd, output);
            }
        });
    }
}

