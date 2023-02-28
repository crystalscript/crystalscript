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

import ClarityCli from './ClarityCli.js';

import {
    TestFailure,
    ClarityRuntimeError,
    TestDefinitionError
} from './test_exceptions.js';

import { safeStringify } from './ast_util.js';


export default class TestDefinition {
    constructor(line) {
        if (line) this.load(line);
    }

    load(line) {
        // fn(arg,arg,...) => ok|err|runtime-failure: expr
        var in_out_idx = line.indexOf('=>');
        var in_out = [
            line.substr(0,in_out_idx).trim(),
            line.substr(in_out_idx+2).trim()
        ];
        
        var syntax_error = false;
        if (in_out.length != 2) syntax_error = true;
        else {
            var call = in_out[0];
            var lparen = call.indexOf('(');
            var rparen = call.lastIndexOf(')');
            if (lparen<0 || rparen<0 || rparen<lparen) syntax_error = true;
            else {
                this.fn = call.substr(0, lparen);
                var args = call.substring(lparen+1, rparen).split(/\s*,\s*/);
                this.args = [];
                args.forEach(arg => {
                    if (arg.trim() != '') this.args.push(arg);
                });
                
            }

            var colon = in_out[1].indexOf(':');
            this.expect_response = in_out[1].substr(0, colon);
            if (this.expect_response == 'ok')
                this.expect_ok = 'ok';
            else if (this.expect_response == 'err')
                this.expect_ok = 'err';
            else if (this.expect_response == 'runtime-failure')
                this.expect_ok = 'runtime-failure';
            else
                syntax_error = true;
            this.expect_expr = in_out[1].substr(colon+1).trim();
            this.expected_str = in_out[1];
        }
        if (syntax_error)
            throw new TestDefinitionError(`expected test definition to be in format 'func-call(args) => [ok|err|runtime-failure]: js-expr': got ${line}`);
    }
    
    pretty_call() {
        return `(${this.fn} ${this.args.join(' ')})`;
    }

    run_test(cli, contract_name, sender_addr) {
        // cli: a ClarityCli instance
        // contract_name: full "stx-addr.contract-name" form
        // sender_addr: stacks address to make the call as
        
        var json = null;
        var got_ok = null;
        try {
            json = cli.exec_public_function(
                contract_name,
                this.fn,
                sender_addr,
                this.args
            );
            
            got_ok = json.success ? 'ok' : 'err';
            
        } catch(e) {
            if (e instanceof ClarityRuntimeError) {
                json = e.json;
                got_ok = 'runtime-failure';
            }
            else throw e;
        }
        
        var output = `${got_ok}(${safeStringify(json, null, 3)})`;

        if (got_ok != this.expect_ok)
            throw new TestFailure(`got '${got_ok}' but expected '${this.expect_ok}'. output='${output}'`);

        var eval_result = undefined;
        var val = json.val; /* ok or err */
        if (json.error) val=json.error; /* runtime-failure */;

        // save json in 'this', which is inexcessible to eval
        this.last_fn_return = json;
        
        try {
            eval_result = eval(`'use strict'; ${this.expect_expr}`);
        } catch(e) {
            throw new TestFailure(`test expr '${this.expect_expr}' has an error: ${e}\n\toutput=${output}`);
        }
        
        if (eval_result !== true)
            throw new TestFailure(`expr did not match, got ${eval_result}. output='${output}', expr='${this.expect_expr}'`);

        return {
            fn_return: this.last_fn_return,
            expect_response: this.expect_response,
            expect_expr: this.expect_expr,
            expr_result: eval_result,
        };
    }
    
};
